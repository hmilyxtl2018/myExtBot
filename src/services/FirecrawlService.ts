/**
 * src/services/FirecrawlService.ts
 *
 * Web scraping and crawling service backed by the Firecrawl API.
 * Falls back to stub results when FIRECRAWL_API_KEY is not set.
 * Routes to SearchService when unavailable.
 */

import axios, { AxiosError } from "axios";
import { ToolCall, ToolDefinition, ToolResult } from "../core/types";
import { BaseService } from "./BaseService";

/** Firecrawl API v1 base URL. */
const FIRECRAWL_BASE_URL = "https://api.firecrawl.dev/v1";

/** Validates that a URL uses http:// or https://. */
function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/** Extracts a Retry-After value (in seconds) from an Axios 429 error. */
function extractRetryAfter(err: AxiosError): number | undefined {
  const raw = err.response?.headers?.["retry-after"];
  if (!raw) return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) ? seconds : undefined;
}

/**
 * FirecrawlService — web scraping and crawling service backed by the
 * Firecrawl API v1 when `FIRECRAWL_API_KEY` is set in the environment.
 * Falls back to stub results so the demo and tests work without an API key.
 *
 * Tools provided:
 *   - `scrape_webpage`       — extract clean content from a single page
 *   - `crawl_website`        — recursively crawl all pages on a site
 *   - `map_website`          — discover all URLs on a site (no content)
 *   - `extract_structured`   — AI-powered structured data extraction
 *   - `interact_webpage`     — automated browser interactions before scraping
 */
export class FirecrawlService extends BaseService {
  readonly name = "FirecrawlService";

  /** When "down" or "rate-limited", route to this service. */
  fallbackServiceName = "SearchService";

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeout: number;

  constructor(timeoutMs = 30_000) {
    super();
    this.apiKey = process.env["FIRECRAWL_API_KEY"] ?? "";
    this.baseUrl = FIRECRAWL_BASE_URL;
    this.timeout = timeoutMs;

    if (!this.apiKey) {
      console.warn(
        "[FirecrawlService] FIRECRAWL_API_KEY not set — service will return stub results",
      );
    }
  }

  /** Returns all 5 tool definitions for this service. */
  getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: "scrape_webpage",
        description:
          "Extract clean content from a single webpage in multiple formats (markdown, HTML, JSON, screenshot, links).",
        parameters: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "The webpage URL to scrape.",
            },
            formats: {
              type: "string",
              description:
                'Output formats as a JSON array. Options: "markdown", "json", "html", "screenshot", "links". Default: ["markdown"].',
              default: '["markdown"]',
            },
            onlyMainContent: {
              type: "string",
              description:
                'Extract only the main content, excluding navigation and ads. "true" or "false". Default: "true".',
              default: "true",
            },
            includeTags: {
              type: "string",
              description: "JSON array of HTML tags to include in the output.",
            },
            excludeTags: {
              type: "string",
              description: "JSON array of HTML tags to exclude from the output.",
            },
          },
          required: ["url"],
        },
        estimatedCostPerCall: 0.002,
      },
      {
        name: "crawl_website",
        description:
          "Recursively crawl an entire website and extract content from all reachable pages.",
        parameters: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "Starting URL for the crawl.",
            },
            maxDepth: {
              type: "number",
              description: "Maximum crawl depth (default: 2, max: 5).",
              default: 2,
            },
            limit: {
              type: "number",
              description: "Maximum number of pages to crawl (default: 10).",
              default: 10,
            },
            includePaths: {
              type: "string",
              description: "JSON array of URL path patterns to include.",
            },
            excludePaths: {
              type: "string",
              description: "JSON array of URL path patterns to exclude.",
            },
            formats: {
              type: "string",
              description:
                'Output formats as a JSON array. Options: "markdown", "json", "html". Default: ["markdown"].',
              default: '["markdown"]',
            },
            allowBackwardLinks: {
              type: "string",
              description:
                'Allow crawling URLs that are higher in the URL hierarchy. "true" or "false". Default: "false".',
              default: "false",
            },
            allowExternalLinks: {
              type: "string",
              description:
                'Allow crawling links that point to external domains. "true" or "false". Default: "false".',
              default: "false",
            },
          },
          required: ["url"],
        },
        estimatedCostPerCall: 0.01,
      },
      {
        name: "map_website",
        description:
          "Quickly discover and list all URLs on a website without extracting page content.",
        parameters: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "Website URL to map.",
            },
            search: {
              type: "string",
              description: "Filter discovered URLs by this search term.",
            },
            ignoreSitemap: {
              type: "string",
              description:
                'Ignore the sitemap and rely solely on link discovery. "true" or "false". Default: "false".',
              default: "false",
            },
            includeSubdomains: {
              type: "string",
              description:
                'Include subdomains in the URL map. "true" or "false". Default: "false".',
              default: "false",
            },
            limit: {
              type: "number",
              description: "Maximum number of URLs to return (default: 5000).",
              default: 5000,
            },
          },
          required: ["url"],
        },
        estimatedCostPerCall: 0.005,
      },
      {
        name: "extract_structured",
        description:
          "Use AI to extract structured data from a webpage according to a JSON schema or a natural-language prompt.",
        parameters: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "The webpage URL to extract data from.",
            },
            schema: {
              type: "string",
              description:
                'JSON string defining the extraction schema. Example: {"type":"object","properties":{"title":{"type":"string"},"price":{"type":"number"}}}',
            },
            prompt: {
              type: "string",
              description:
                "Natural-language extraction instructions (alternative to schema).",
            },
            systemPrompt: {
              type: "string",
              description: "System-level instructions for the AI extractor.",
            },
          },
          required: ["url"],
        },
        estimatedCostPerCall: 0.008,
      },
      {
        name: "interact_webpage",
        description:
          "Perform automated browser interactions (click, scroll, wait, input) on a webpage before scraping its content.",
        parameters: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "The webpage URL to interact with.",
            },
            actions: {
              type: "string",
              description:
                'JSON array of actions to perform in sequence. Each action is one of: {"type":"wait","milliseconds":N}, {"type":"click","selector":"CSS"}, {"type":"scroll","direction":"up"|"down","amount":N}, {"type":"input","selector":"CSS","value":"text"}.',
            },
            formats: {
              type: "string",
              description:
                'Output formats after interaction as a JSON array. Default: ["markdown"].',
              default: '["markdown"]',
            },
          },
          required: ["url", "actions"],
        },
        estimatedCostPerCall: 0.015,
      },
    ];
  }

  /**
   * Routes an incoming tool call to the appropriate private handler.
   */
  async execute(call: ToolCall): Promise<ToolResult> {
    const args = call.arguments as Record<string, unknown>;

    switch (call.toolName) {
      case "scrape_webpage":
        return this._scrapeWebpage(args);
      case "crawl_website":
        return this._crawlWebsite(args);
      case "map_website":
        return this._mapWebsite(args);
      case "extract_structured":
        return this._extractStructured(args);
      case "interact_webpage":
        return this._interactWebpage(args);
      default:
        return { success: false, error: `Unknown tool: ${call.toolName}` };
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /** Extracts clean content from a single webpage. */
  private async _scrapeWebpage(args: Record<string, unknown>): Promise<ToolResult> {
    const url = args["url"] as string;
    if (!isValidUrl(url)) {
      return { success: false, error: `Invalid URL: "${url}"` };
    }

    if (!this.apiKey) {
      return this._stubResult("scrape_webpage", args);
    }

    const formats = this._parseJsonArray(args["formats"] as string | undefined, ["markdown"]);
    const onlyMainContent = (args["onlyMainContent"] as string | undefined) !== "false";
    const includeTags = this._parseJsonArray(args["includeTags"] as string | undefined);
    const excludeTags = this._parseJsonArray(args["excludeTags"] as string | undefined);

    const body: Record<string, unknown> = { url, formats, onlyMainContent };
    if (includeTags.length) body["includeTags"] = includeTags;
    if (excludeTags.length) body["excludeTags"] = excludeTags;

    try {
      const { data } = await axios.post<unknown>(
        `${this.baseUrl}/scrape`,
        body,
        this._requestConfig(),
      );
      return { success: true, output: data };
    } catch (err) {
      return this._handleAxiosError("scrape_webpage", err);
    }
  }

  /** Recursively crawls all pages on a website. */
  private async _crawlWebsite(args: Record<string, unknown>): Promise<ToolResult> {
    const url = args["url"] as string;
    if (!isValidUrl(url)) {
      return { success: false, error: `Invalid URL: "${url}"` };
    }

    if (!this.apiKey) {
      return this._stubResult("crawl_website", args);
    }

    const maxDepth = Math.min((args["maxDepth"] as number | undefined) ?? 2, 5);
    const limit = (args["limit"] as number | undefined) ?? 10;
    const formats = this._parseJsonArray(args["formats"] as string | undefined, ["markdown"]);
    const includePaths = this._parseJsonArray(args["includePaths"] as string | undefined);
    const excludePaths = this._parseJsonArray(args["excludePaths"] as string | undefined);
    const allowBackwardLinks = (args["allowBackwardLinks"] as string | undefined) === "true";
    const allowExternalLinks = (args["allowExternalLinks"] as string | undefined) === "true";

    const body: Record<string, unknown> = {
      url,
      maxDepth,
      limit,
      formats,
      allowBackwardLinks,
      allowExternalLinks,
    };
    if (includePaths.length) body["includePaths"] = includePaths;
    if (excludePaths.length) body["excludePaths"] = excludePaths;

    try {
      const { data } = await axios.post<unknown>(
        `${this.baseUrl}/crawl`,
        body,
        this._requestConfig(),
      );
      return { success: true, output: data };
    } catch (err) {
      return this._handleAxiosError("crawl_website", err);
    }
  }

  /** Discovers all URLs on a website without extracting content. */
  private async _mapWebsite(args: Record<string, unknown>): Promise<ToolResult> {
    const url = args["url"] as string;
    if (!isValidUrl(url)) {
      return { success: false, error: `Invalid URL: "${url}"` };
    }

    if (!this.apiKey) {
      return this._stubResult("map_website", args);
    }

    const body: Record<string, unknown> = {
      url,
      ignoreSitemap: (args["ignoreSitemap"] as string | undefined) === "true",
      includeSubdomains: (args["includeSubdomains"] as string | undefined) === "true",
      limit: (args["limit"] as number | undefined) ?? 5000,
    };
    if (args["search"]) body["search"] = args["search"];

    try {
      const { data } = await axios.post<unknown>(
        `${this.baseUrl}/map`,
        body,
        this._requestConfig(),
      );
      return { success: true, output: data };
    } catch (err) {
      return this._handleAxiosError("map_website", err);
    }
  }

  /** Uses AI to extract structured data from a webpage. */
  private async _extractStructured(args: Record<string, unknown>): Promise<ToolResult> {
    const url = args["url"] as string;
    if (!isValidUrl(url)) {
      return { success: false, error: `Invalid URL: "${url}"` };
    }

    if (!this.apiKey) {
      return this._stubResult("extract_structured", args);
    }

    const body: Record<string, unknown> = { url };

    if (args["schema"]) {
      try {
        body["schema"] = JSON.parse(args["schema"] as string);
      } catch {
        return { success: false, error: 'Invalid JSON in "schema" parameter.' };
      }
    }
    if (args["prompt"]) body["prompt"] = args["prompt"];
    if (args["systemPrompt"]) body["systemPrompt"] = args["systemPrompt"];

    try {
      const { data } = await axios.post<unknown>(
        `${this.baseUrl}/extract`,
        body,
        this._requestConfig(),
      );
      return { success: true, output: data };
    } catch (err) {
      return this._handleAxiosError("extract_structured", err);
    }
  }

  /** Performs browser interactions on a webpage and then scrapes it. */
  private async _interactWebpage(args: Record<string, unknown>): Promise<ToolResult> {
    const url = args["url"] as string;
    if (!isValidUrl(url)) {
      return { success: false, error: `Invalid URL: "${url}"` };
    }

    let actions: unknown[];
    try {
      actions = JSON.parse(args["actions"] as string) as unknown[];
      if (!Array.isArray(actions)) throw new Error("actions must be an array");
    } catch {
      return { success: false, error: 'Invalid JSON in "actions" parameter — expected an array.' };
    }

    if (!this.apiKey) {
      return this._stubResult("interact_webpage", args);
    }

    const formats = this._parseJsonArray(args["formats"] as string | undefined, ["markdown"]);

    const body: Record<string, unknown> = { url, actions, formats };

    try {
      const { data } = await axios.post<unknown>(
        `${this.baseUrl}/scrape`,
        body,
        this._requestConfig(),
      );
      return { success: true, output: data };
    } catch (err) {
      return this._handleAxiosError("interact_webpage", err);
    }
  }

  // ── Utilities ───────────────────────────────────────────────────────────────

  /** Builds the shared axios request configuration. */
  private _requestConfig() {
    return {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      timeout: this.timeout,
    };
  }

  /**
   * Parses a JSON-encoded string array.
   * Returns `defaultValue` when the input is absent or fails to parse.
   */
  private _parseJsonArray(raw: string | undefined, defaultValue: string[] = []): string[] {
    if (!raw) return defaultValue;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) return parsed as string[];
    } catch {
      // fall through to default
    }
    return defaultValue;
  }

  /**
   * Converts an Axios error into a structured ToolResult with a descriptive
   * error message.  Handles 401, 403, 404, 429, and network timeouts.
   */
  private _handleAxiosError(toolName: string, err: unknown): ToolResult {
    if (axios.isAxiosError(err)) {
      const axiosErr = err as AxiosError;
      const status = axiosErr.response?.status;

      if (status === 401 || status === 403) {
        return {
          success: false,
          error: `[FirecrawlService/${toolName}] Authentication failed (${status}). Check FIRECRAWL_API_KEY.`,
        };
      }
      if (status === 429) {
        const retryAfter = extractRetryAfter(axiosErr);
        const suffix =
          retryAfter != null
            ? ` Retry after ${retryAfter} ${retryAfter === 1 ? "second" : "seconds"}.`
            : "";
        return {
          success: false,
          error: `[FirecrawlService/${toolName}] Rate limit exceeded (429).${suffix}`,
        };
      }
      if (status === 404) {
        return {
          success: false,
          error: `[FirecrawlService/${toolName}] Resource not found (404).`,
        };
      }
      if (axiosErr.code === "ECONNABORTED" || axiosErr.message.toLowerCase().includes("timeout")) {
        return {
          success: false,
          error: `[FirecrawlService/${toolName}] Request timed out after ${this.timeout}ms.`,
        };
      }

      const message = axiosErr.response?.statusText ?? axiosErr.message;
      return {
        success: false,
        error: `[FirecrawlService/${toolName}] API error (${status ?? "network"}): ${message}`,
      };
    }

    return {
      success: false,
      error: `[FirecrawlService/${toolName}] Unexpected error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  /**
   * Returns a stub ToolResult for demo and testing use when the API key is
   * absent.  Each tool gets a realistic-looking placeholder response.
   */
  private _stubResult(toolName: string, args: Record<string, unknown>): ToolResult {
    const url = args["url"] as string;

    switch (toolName) {
      case "scrape_webpage":
        return {
          success: true,
          output: {
            stub: true,
            url,
            markdown: `# Stub scrape result for ${url}\n\nThis is placeholder content returned because FIRECRAWL_API_KEY is not set.`,
            metadata: { title: "Stub Page", statusCode: 200 },
          },
        };

      case "crawl_website":
        return {
          success: true,
          output: {
            stub: true,
            url,
            status: "completed",
            total: 1,
            data: [
              {
                url,
                markdown: `# Stub crawl result for ${url}\n\nPlaceholder — set FIRECRAWL_API_KEY to enable real crawling.`,
              },
            ],
          },
        };

      case "map_website":
        return {
          success: true,
          output: {
            stub: true,
            url,
            links: [`${url}/about`, `${url}/contact`, `${url}/sitemap.xml`],
          },
        };

      case "extract_structured":
        return {
          success: true,
          output: {
            stub: true,
            url,
            data: { message: "Stub extraction — set FIRECRAWL_API_KEY to enable real extraction." },
          },
        };

      case "interact_webpage":
        return {
          success: true,
          output: {
            stub: true,
            url,
            markdown: `# Stub interaction result for ${url}\n\nPlaceholder — set FIRECRAWL_API_KEY to enable real browser interactions.`,
          },
        };

      default:
        return { success: true, output: { stub: true, toolName, args } };
    }
  }
}
