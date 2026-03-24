import axios from "axios";
import { ToolCall, ToolDefinition, ToolResult } from "../core/types";
import { BaseService } from "./BaseService";

/**
 * Response shape expected from the Playwright MCP server's `/call` endpoint.
 */
interface PlaywrightMcpResponse {
  success: boolean;
  output?: unknown;
  error?: string;
}

/**
 * PlaywrightService — browser-automation service backed by the
 * [Microsoft Playwright MCP server](https://github.com/microsoft/playwright-mcp)
 * when `PLAYWRIGHT_MCP_URL` is set in the environment.  Falls back to
 * descriptive stub results so the demo and tests work without a running
 * Playwright MCP server.
 *
 * Start the Playwright MCP server separately:
 * ```bash
 * npx @playwright/mcp@latest --port 8931
 * ```
 * Then set:
 * ```
 * PLAYWRIGHT_MCP_URL=http://localhost:8931
 * ```
 *
 * Tools provided:
 *   `browser_navigate`, `browser_click`, `browser_type`,
 *   `browser_snapshot`, `browser_screenshot`,
 *   `browser_go_back`, `browser_go_forward`, `browser_close`
 */
export class PlaywrightService extends BaseService {
  readonly name = "PlaywrightService";

  /** Request timeout in milliseconds (default: 30,000). */
  private readonly _timeoutMs: number;

  constructor(timeoutMs = 30_000) {
    super();
    this._timeoutMs = timeoutMs;
  }

  getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: "browser_navigate",
        description: "Navigate the browser to a URL.",
        parameters: {
          type: "object",
          properties: {
            url: { type: "string", description: "The URL to navigate to." },
          },
          required: ["url"],
        },
        estimatedCostPerCall: 0.002,
      },
      {
        name: "browser_click",
        description: "Click an element on the current page by CSS selector or accessible description.",
        parameters: {
          type: "object",
          properties: {
            selector: {
              type: "string",
              description: "CSS selector or accessible description of the element to click.",
            },
          },
          required: ["selector"],
        },
        estimatedCostPerCall: 0.002,
      },
      {
        name: "browser_type",
        description: "Type text into an input field on the current page.",
        parameters: {
          type: "object",
          properties: {
            selector: {
              type: "string",
              description: "CSS selector or accessible description of the input field.",
            },
            text: { type: "string", description: "Text to type into the field." },
          },
          required: ["selector", "text"],
        },
        estimatedCostPerCall: 0.002,
      },
      {
        name: "browser_snapshot",
        description:
          "Get a structured accessibility snapshot of the current page. " +
          "Preferred over screenshots for understanding page structure.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
        estimatedCostPerCall: 0.002,
      },
      {
        name: "browser_screenshot",
        description: "Take a screenshot of the current page. Returns a base64-encoded PNG.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
        estimatedCostPerCall: 0.002,
      },
      {
        name: "browser_go_back",
        description: "Navigate the browser back to the previous page.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
        estimatedCostPerCall: 0.002,
      },
      {
        name: "browser_go_forward",
        description: "Navigate the browser forward to the next page.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
        estimatedCostPerCall: 0.002,
      },
      {
        name: "browser_close",
        description: "Close the current browser tab or page.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
        estimatedCostPerCall: 0.002,
      },
    ];
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    const knownTools = new Set([
      "browser_navigate",
      "browser_click",
      "browser_type",
      "browser_snapshot",
      "browser_screenshot",
      "browser_go_back",
      "browser_go_forward",
      "browser_close",
    ]);

    if (!knownTools.has(call.toolName)) {
      return { success: false, error: `Unknown tool: ${call.toolName}` };
    }

    const mcpUrl = process.env["PLAYWRIGHT_MCP_URL"];
    if (mcpUrl) {
      return this._callMcpServer(mcpUrl, call);
    }

    return this._stubResult(call.toolName);
  }

  /**
   * Forwards the tool call to the Playwright MCP server's HTTP `/call` endpoint.
   */
  private async _callMcpServer(mcpUrl: string, call: ToolCall): Promise<ToolResult> {
    try {
      const { data } = await axios.post<PlaywrightMcpResponse>(
        `${mcpUrl}/call`,
        { toolName: call.toolName, arguments: call.arguments },
        {
          headers: { "Content-Type": "application/json" },
          timeout: this._timeoutMs,
        },
      );
      if (data.success) {
        return { success: true, output: data.output };
      }
      return { success: false, error: data.error ?? "Playwright MCP server returned an error." };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[PlaywrightService] MCP server call failed for "${call.toolName}":`, message);
      return { success: false, error: `PlaywrightService error: ${message}` };
    }
  }

  /**
   * Returns a descriptive stub result when no Playwright MCP server is configured.
   */
  private _stubResult(toolName: string): ToolResult {
    if (toolName === "browser_snapshot") {
      return {
        success: true,
        output: {
          snapshot:
            "[PlaywrightService stub] No PLAYWRIGHT_MCP_URL set. " +
            "Set PLAYWRIGHT_MCP_URL=http://localhost:8931 to enable real browser automation.",
          url: "about:blank",
        },
      };
    }

    return {
      success: true,
      output: {
        message:
          `[PlaywrightService stub] Tool "${toolName}" called but no PLAYWRIGHT_MCP_URL is set. ` +
          "Set PLAYWRIGHT_MCP_URL=http://localhost:8931 to enable real browser automation.",
      },
    };
  }
}
