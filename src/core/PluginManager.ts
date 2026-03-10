import { PluginEntry, PluginManifest, PluginStatus, PluginSummary } from "./types";
import { McpServiceListManager } from "./McpServiceListManager";
import { PluginService } from "../services/PluginService";

/**
 * PluginManager is the plugin marketplace engine for myExtBot.
 *
 * Responsibilities:
 * - Maintaining a local catalog (registry) of known plugins
 * - Tracking which plugins are installed vs. available
 * - Installing plugins: creating a PluginService and registering it with the
 *   McpServiceListManager so its tools become immediately usable by the LLM
 * - Uninstalling plugins: removing the service from the manager
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

  constructor(serviceManager: McpServiceListManager) {
    this.serviceManager = serviceManager;
    this.seedBuiltinRegistry();
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
