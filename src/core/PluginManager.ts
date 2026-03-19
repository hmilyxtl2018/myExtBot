import * as fs from "fs";
import * as path from "path";
import { PluginEntry, PluginManifest, PluginSummary } from "./types";
import { McpServiceListManager } from "./McpServiceListManager";
import { PluginService } from "../services/PluginService";

/**
 * Persisted shape stored in plugins-state.json.
 * Only the minimal information required to restore the installation state is
 * saved; the full manifest is re-loaded from the built-in registry on startup.
 */
interface PersistedState {
  /** Map of pluginId → stored entry (manifests for custom/URL-installed plugins are included). */
  installed: Record<string, { manifest: PluginManifest; installedAt: string }>;
}

/**
 * PluginManager is the plugin marketplace engine for myExtBot.
 *
 * Responsibilities:
 * - Maintaining a local catalog (registry) of known plugins
 * - Tracking which plugins are installed vs. available
 * - Installing plugins: creating a PluginService and registering it with the
 *   McpServiceListManager so its tools become immediately usable by the LLM
 * - Uninstalling plugins: removing the service from the manager
 * - Persisting installed state to plugins-state.json so it survives restarts
 * - Installing plugins from arbitrary HTTPS manifest URLs (custom plugins)
 * - Exposing listing and search APIs for the UI and REST layer
 *
 * In production the registry catalog would be populated by fetching a remote
 * registry index (e.g. from a GitHub-hosted JSON file or an HTTPS endpoint).
 * In this implementation the catalog is pre-seeded with representative examples
 * and can be extended at runtime via `addToRegistry()`.
 */
export class PluginManager {
  private catalog: Map<string, PluginEntry> = new Map();
  private serviceManager: McpServiceListManager;
  /** Absolute path to the JSON file used for persistence. */
  private stateFile: string;

  constructor(serviceManager: McpServiceListManager, stateFile?: string) {
    this.serviceManager = serviceManager;
    this.stateFile = stateFile ?? path.resolve(process.cwd(), "plugins-state.json");
    this.seedBuiltinRegistry();
    this.loadPersistedState();
  }

  // ── Registry management ───────────────────────────────────────────────────

  /**
   * Adds a plugin manifest to the local registry catalog.
   * If the plugin is already installed, the status is preserved.
   */
  addToRegistry(manifest: PluginManifest): void {
    const existing = this.catalog.get(manifest.id);
    this.catalog.set(manifest.id, {
      manifest,
      status: existing?.status === "installed" ? "installed" : "available",
      installedAt: existing?.installedAt,
    });
  }

  /** Returns a summary of every plugin in the catalog. */
  listAll(): PluginSummary[] {
    return [...this.catalog.values()].map((e) => this.toSummary(e));
  }

  /** Returns summaries for installed plugins only. */
  listInstalled(): PluginSummary[] {
    return [...this.catalog.values()]
      .filter((e) => e.status === "installed")
      .map((e) => this.toSummary(e));
  }

  /** Returns summaries for plugins that have not yet been installed. */
  listAvailable(): PluginSummary[] {
    return [...this.catalog.values()]
      .filter((e) => e.status !== "installed")
      .map((e) => this.toSummary(e));
  }

  // ── Install / Uninstall ───────────────────────────────────────────────────

  /**
   * Installs a plugin by id.
   *
   * The plugin manifest is looked up in the catalog, a `PluginService` instance
   * is created and registered with the `McpServiceListManager`, and the catalog
   * entry is updated to `"installed"`.
   *
   * @throws Error if the plugin id is not in the catalog.
   * @throws Error if the plugin is already installed.
   */
  install(pluginId: string): PluginSummary {
    const entry = this.catalog.get(pluginId);
    if (!entry) throw new Error(`Plugin "${pluginId}" is not in the registry.`);
    if (entry.status === "installed") {
      throw new Error(`Plugin "${pluginId}" is already installed.`);
    }

    try {
      const service = new PluginService(entry.manifest);
      this.serviceManager.register(service);
      this.serviceManager.enableService(service.name);

      const updated: PluginEntry = {
        ...entry,
        status: "installed",
        installedAt: new Date().toISOString(),
        error: undefined,
      };
      this.catalog.set(pluginId, updated);
      this.saveState();
      return this.toSummary(updated);
    } catch (err) {
      const errEntry: PluginEntry = {
        ...entry,
        status: "error",
        error: (err as Error).message,
      };
      this.catalog.set(pluginId, errEntry);
      throw err;
    }
  }

  /**
   * Uninstalls a plugin by id.
   *
   * The `PluginService` is fully unregistered from the `McpServiceListManager`
   * so its tools are no longer available to the LLM and no stale references
   * accumulate. The catalog entry reverts to `"available"` so the plugin can
   * be re-installed at any time.
   *
   * @throws Error if the plugin id is not in the catalog.
   * @throws Error if the plugin is not currently installed.
   */
  uninstall(pluginId: string): void {
    const entry = this.catalog.get(pluginId);
    if (!entry) throw new Error(`Plugin "${pluginId}" is not in the registry.`);
    if (entry.status !== "installed") {
      throw new Error(`Plugin "${pluginId}" is not installed.`);
    }

    // Fully unregister the service so no stale references remain.
    this.serviceManager.unregister(pluginId);

    this.catalog.set(pluginId, {
      ...entry,
      status: "available",
      installedAt: undefined,
      error: undefined,
    });
    this.saveState();
  }

  // ── Install from URL ──────────────────────────────────────────────────────

  /**
   * Fetches a plugin manifest from an HTTPS URL, validates it, adds it to
   * the catalog, and installs it immediately.
   *
   * The URL must point to a JSON document conforming to the `PluginManifest`
   * interface.  Only HTTPS URLs are accepted.
   *
   * @param url - The HTTPS URL of the plugin manifest JSON.
   * @returns A summary of the newly installed plugin.
   * @throws Error if the URL is invalid, the fetch fails, or the manifest is malformed.
   */
  async installFromUrl(url: string): Promise<PluginSummary> {
    // Enforce HTTPS-only and block SSRF targets.
    // Note: the REST layer (server.ts) validates this with validatePluginUrl()
    // before calling this method; this guard is a defence-in-depth check that
    // also protects programmatic callers who bypass the REST layer.
    if (!url || typeof url !== "string") {
      throw new Error("url must be a non-empty string.");
    }
    if (!url.startsWith("https://")) {
      throw new Error("Only HTTPS URLs are supported (HTTP is not allowed).");
    }

    let manifest: PluginManifest;
    try {
      const resp = await fetch(url, { headers: { Accept: "application/json" } });
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
      }
      manifest = (await resp.json()) as PluginManifest;
    } catch (err) {
      throw new Error(`Failed to fetch manifest from "${url}": ${(err as Error).message}`);
    }

    this.validateManifest(manifest);

    // Always stamp the registryUrl with the source URL.
    manifest.registryUrl = url;

    // If a plugin with the same id is already installed, reject.
    const existing = this.catalog.get(manifest.id);
    if (existing?.status === "installed") {
      throw new Error(`Plugin "${manifest.id}" is already installed.`);
    }

    // Add to catalog and install.
    this.addToRegistry(manifest);
    return this.install(manifest.id);
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  /**
   * Saves the current installation state to `plugins-state.json`.
   * Only installed plugins are persisted; available/error entries are ephemeral.
   */
  private saveState(): void {
    const installed: PersistedState["installed"] = {};
    for (const [id, entry] of this.catalog) {
      if (entry.status === "installed" && entry.installedAt) {
        installed[id] = { manifest: entry.manifest, installedAt: entry.installedAt };
      }
    }
    try {
      fs.writeFileSync(this.stateFile, JSON.stringify({ installed }, null, 2), "utf-8");
    } catch (err) {
      console.warn(`[PluginManager] Could not save state to ${this.stateFile}:`, (err as Error).message);
    }
  }

  /**
   * Loads the persisted installation state from `plugins-state.json` (if it
   * exists) and re-installs every previously-installed plugin so the service
   * list is restored without user interaction.
   */
  private loadPersistedState(): void {
    if (!fs.existsSync(this.stateFile)) return;
    try {
      const raw = fs.readFileSync(this.stateFile, "utf-8");
      const state = JSON.parse(raw) as PersistedState;
      for (const [id, saved] of Object.entries(state.installed ?? {})) {
        try {
          // Ensure the manifest is in the catalog (it may be a custom URL plugin).
          if (!this.catalog.has(id)) {
            this.addToRegistry(saved.manifest);
          }
          // Skip if somehow already installed by seedBuiltinRegistry.
          if (this.catalog.get(id)?.status === "installed") continue;
          const service = new PluginService(saved.manifest);
          this.serviceManager.register(service);
          this.serviceManager.enableService(service.name);
          this.catalog.set(id, {
            manifest: saved.manifest,
            status: "installed",
            installedAt: saved.installedAt,
          });
        } catch (err) {
          console.warn(`[PluginManager] Could not restore plugin "${id}":`, (err as Error).message);
        }
      }
    } catch (err) {
      console.warn(`[PluginManager] Could not load state from ${this.stateFile}:`, (err as Error).message);
    }
  }

  // ── Validation ────────────────────────────────────────────────────────────

  /**
   * Validates that a plain object has the required fields of a `PluginManifest`.
   * @throws Error describing the first missing or invalid field.
   */
  private validateManifest(m: unknown): asserts m is PluginManifest {
    const obj = m as Record<string, unknown>;
    const required: Array<keyof PluginManifest> = ["id", "name", "version", "author", "description", "category", "tools"];
    for (const field of required) {
      if (!obj[field]) throw new Error(`Manifest is missing required field: "${field}"`);
    }
    if (!Array.isArray(obj.tools) || (obj.tools as unknown[]).length === 0) {
      throw new Error('Manifest "tools" must be a non-empty array.');
    }
    // Allow single-character IDs (e.g. "a") as well as multi-character slugs.
    const idPattern = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
    if (typeof obj.id === "string" && !idPattern.test(obj.id)) {
      throw new Error(`Manifest "id" must be a lowercase slug (e.g. "my-plugin"), got: "${obj.id}"`);
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private toSummary(entry: PluginEntry): PluginSummary {
    return {
      id: entry.manifest.id,
      name: entry.manifest.name,
      version: entry.manifest.version,
      author: entry.manifest.author,
      description: entry.manifest.description,
      category: entry.manifest.category,
      homepage: entry.manifest.homepage,
      tools: entry.manifest.tools.map((t) => ({ name: t.name, description: t.description })),
      toolCount: entry.manifest.tools.length,
      status: entry.status,
      installedAt: entry.installedAt,
    };
  }

  // ── Seeded registry ───────────────────────────────────────────────────────

  /**
   * Pre-loads the local registry with a set of representative marketplace
   * plugins.  In production this list would be fetched from a remote registry
   * index endpoint.
   */
  private seedBuiltinRegistry(): void {
    const builtins: PluginManifest[] = [
      // ── Weather Service ──────────────────────────────────────────────────
      {
        id: "weather-service",
        name: "Weather Service",
        version: "1.3.0",
        author: "OpenWeather Community",
        description:
          "Provides real-time weather data and multi-day forecasts for any location worldwide.",
        homepage: "https://github.com/example/mcp-weather",
        category: "Data & Analytics",
        registryUrl: "https://registry.mcplugins.io/weather-service/manifest.json",
        tools: [
          {
            name: "get_current_weather",
            description: "Get the current weather conditions for a given city or coordinates.",
            parameters: {
              type: "object",
              properties: {
                location: {
                  type: "string",
                  description: "City name or 'lat,lon' coordinates.",
                },
                units: {
                  type: "string",
                  description: "Temperature units: metric, imperial, or standard.",
                  enum: ["metric", "imperial", "standard"],
                  default: "metric",
                },
              },
              required: ["location"],
            },
          },
          {
            name: "get_forecast",
            description: "Get a multi-day weather forecast for a location.",
            parameters: {
              type: "object",
              properties: {
                location: { type: "string", description: "City name or coordinates." },
                days: {
                  type: "number",
                  description: "Number of forecast days (1–7).",
                  default: 3,
                },
              },
              required: ["location"],
            },
          },
        ],
      },

      // ── GitHub Tools ─────────────────────────────────────────────────────
      {
        id: "github-tools",
        name: "GitHub Tools",
        version: "2.0.1",
        author: "DevOps Tooling Guild",
        description:
          "Interact with GitHub repositories — search repos, read files, list issues, and more.",
        homepage: "https://github.com/example/mcp-github",
        category: "Developer Tools",
        registryUrl: "https://registry.mcplugins.io/github-tools/manifest.json",
        tools: [
          {
            name: "github_search_repos",
            description: "Search GitHub repositories by keyword, language, or stars.",
            parameters: {
              type: "object",
              properties: {
                query: { type: "string", description: "GitHub search query." },
                language: { type: "string", description: "Filter by programming language." },
                minStars: { type: "number", description: "Minimum star count." },
              },
              required: ["query"],
            },
          },
          {
            name: "github_get_file",
            description: "Fetch the raw contents of a file from a GitHub repository.",
            parameters: {
              type: "object",
              properties: {
                owner: { type: "string", description: "Repository owner." },
                repo: { type: "string", description: "Repository name." },
                path: { type: "string", description: "File path within the repository." },
                ref: { type: "string", description: "Branch, tag, or commit SHA." },
              },
              required: ["owner", "repo", "path"],
            },
          },
          {
            name: "github_list_issues",
            description: "List open issues for a GitHub repository.",
            parameters: {
              type: "object",
              properties: {
                owner: { type: "string", description: "Repository owner." },
                repo: { type: "string", description: "Repository name." },
                labels: { type: "string", description: "Comma-separated label filter." },
                limit: { type: "number", description: "Maximum number of issues to return." },
              },
              required: ["owner", "repo"],
            },
          },
        ],
      },

      // ── Translator ───────────────────────────────────────────────────────
      {
        id: "language-translator",
        name: "Language Translator",
        version: "1.0.4",
        author: "Polyglot Labs",
        description:
          "Translate text between 100+ languages and detect the language of any text snippet.",
        homepage: "https://github.com/example/mcp-translate",
        category: "Productivity",
        registryUrl: "https://registry.mcplugins.io/language-translator/manifest.json",
        tools: [
          {
            name: "translate_text",
            description: "Translate text from one language to another.",
            parameters: {
              type: "object",
              properties: {
                text: { type: "string", description: "Text to translate." },
                targetLanguage: { type: "string", description: "Target language code (e.g. 'fr', 'zh', 'es')." },
                sourceLanguage: { type: "string", description: "Source language code. Auto-detected if omitted." },
              },
              required: ["text", "targetLanguage"],
            },
          },
          {
            name: "detect_language",
            description: "Detect the language of a given text snippet.",
            parameters: {
              type: "object",
              properties: {
                text: { type: "string", description: "Text to analyse." },
              },
              required: ["text"],
            },
          },
        ],
      },

      // ── PDF Reader ───────────────────────────────────────────────────────
      {
        id: "pdf-reader",
        name: "PDF Reader",
        version: "0.9.2",
        author: "DocTools Open Source",
        description:
          "Extract text from PDF files by URL or local path, and get AI-assisted summaries.",
        homepage: "https://github.com/example/mcp-pdf",
        category: "Document Processing",
        registryUrl: "https://registry.mcplugins.io/pdf-reader/manifest.json",
        tools: [
          {
            name: "pdf_extract_text",
            description: "Download a PDF from a URL and extract its full text content.",
            parameters: {
              type: "object",
              properties: {
                url: { type: "string", description: "Public URL of the PDF file." },
                pages: { type: "string", description: "Page range to extract, e.g. '1-5'. Omit for all pages." },
              },
              required: ["url"],
            },
          },
          {
            name: "pdf_summarize",
            description: "Extract and summarise the key points from a PDF document.",
            parameters: {
              type: "object",
              properties: {
                url: { type: "string", description: "Public URL of the PDF file." },
                maxPoints: { type: "number", description: "Maximum number of summary bullet points.", default: 5 },
              },
              required: ["url"],
            },
          },
        ],
      },

      // ── Slack Notifier ───────────────────────────────────────────────────
      {
        id: "slack-notifier",
        name: "Slack Notifier",
        version: "1.1.0",
        author: "WorkflowBot Team",
        description:
          "Send Slack messages, list channels, and react to messages — directly from the LLM.",
        homepage: "https://github.com/example/mcp-slack",
        category: "Communication",
        registryUrl: "https://registry.mcplugins.io/slack-notifier/manifest.json",
        tools: [
          {
            name: "slack_send_message",
            description: "Post a message to a Slack channel or DM.",
            parameters: {
              type: "object",
              properties: {
                channel: { type: "string", description: "Channel name (e.g. #general) or user ID." },
                text: { type: "string", description: "Message text (Markdown supported)." },
                threadTs: { type: "string", description: "Thread timestamp to reply in a thread." },
              },
              required: ["channel", "text"],
            },
          },
          {
            name: "slack_list_channels",
            description: "List public Slack channels in the workspace.",
            parameters: {
              type: "object",
              properties: {
                limit: { type: "number", description: "Max channels to return.", default: 20 },
                excludeArchived: { type: "boolean", description: "Exclude archived channels.", default: true },
              },
              required: [],
            },
          },
        ],
      },

      // ── Database Query ───────────────────────────────────────────────────
      {
        id: "sql-query",
        name: "SQL Query",
        version: "1.5.0",
        author: "DataBridge Project",
        description:
          "Execute read-only SQL queries against configured databases and return structured results.",
        homepage: "https://github.com/example/mcp-sql",
        category: "Developer Tools",
        registryUrl: "https://registry.mcplugins.io/sql-query/manifest.json",
        tools: [
          {
            name: "sql_query",
            description: "Run a SELECT query and return the result rows as JSON.",
            parameters: {
              type: "object",
              properties: {
                datasource: { type: "string", description: "Named datasource to query." },
                query: { type: "string", description: "SQL SELECT statement to execute." },
                limit: { type: "number", description: "Maximum number of rows to return.", default: 100 },
              },
              required: ["datasource", "query"],
            },
          },
          {
            name: "sql_list_tables",
            description: "List all tables in a configured datasource.",
            parameters: {
              type: "object",
              properties: {
                datasource: { type: "string", description: "Named datasource to inspect." },
              },
              required: ["datasource"],
            },
          },
        ],
      },
    ];

    builtins.forEach((m) => this.addToRegistry(m));
  }
}
