import { PluginManifest, ToolCall, ToolDefinition, ToolResult } from "../core/types";
import { BaseService } from "./BaseService";

/** Default request timeout in milliseconds. */
const DEFAULT_TIMEOUT_MS = 30_000;

/** Default retry configuration. */
const DEFAULT_RETRY_CONFIG = { maxRetries: 3, backoffMs: 1_000 };

/** Whether debug-level request/response logging is enabled. */
const DEBUG_LOGGING = process.env.PLUGIN_SERVICE_DEBUG === "true";

/**
 * Validates that a URL uses http:// or https://.
 */
function validateEndpointUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid plugin endpoint URL: "${url}"`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `Plugin endpoint URL must use http:// or https://, got: "${url}"`
    );
  }
}

/**
 * Sleeps for the specified number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * PluginService is a generic McpService adapter for installed marketplace plugins.
 *
 * It wraps a `PluginManifest` and bridges the manager's `dispatch` path to the
 * plugin's actual execution logic:
 *
 * - If the manifest supplies an `executeEndpoint`, the service POSTs the tool
 *   call to that URL and returns the response as the ToolResult.
 *   - Timeout: configurable via `manifest.timeout` (default 30 s).
 *   - Retry: up to `manifest.retryConfig.maxRetries` attempts (default 3)
 *     with exponential backoff, only for 5xx and network errors.
 *   - 4xx errors are returned immediately without retry.
 * - Otherwise, a stub response is returned (with a `[stub]` prefix in the
 *   output note) so the UI and dispatch path work correctly without a live
 *   backend.
 */
export class PluginService extends BaseService {
  private manifest: PluginManifest;

  constructor(manifest: PluginManifest) {
    super();
    this.manifest = manifest;
  }

  get name(): string {
    return this.manifest.id;
  }

  getToolDefinitions(): ToolDefinition[] {
    return this.manifest.tools;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    const tool = this.manifest.tools.find((t) => t.name === call.toolName);
    if (!tool) {
      return { success: false, error: `Unknown tool: ${call.toolName}` };
    }

    // ── Live execution: forward to the plugin's HTTP endpoint ────────────────
    if (this.manifest.executeEndpoint) {
      // Validate the endpoint URL before attempting any network call.
      try {
        validateEndpointUrl(this.manifest.executeEndpoint);
      } catch (err) {
        return {
          success: false,
          error: (err as Error).message,
          output: { errorType: "validation", retryCount: 0 },
        };
      }

      const timeoutMs = this.manifest.timeout ?? DEFAULT_TIMEOUT_MS;
      const { maxRetries, backoffMs } =
        this.manifest.retryConfig ?? DEFAULT_RETRY_CONFIG;

      const body = JSON.stringify({
        toolName: call.toolName,
        arguments: call.arguments,
      });

      let lastError: string | undefined;
      let lastStatus: number | undefined;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (attempt > 0) {
          // Exponential backoff: backoffMs × 2^(attempt-1), e.g. 1 s, 2 s, 4 s with default backoffMs = 1000 ms
          await sleep(backoffMs * Math.pow(2, attempt - 1));
        }

        if (DEBUG_LOGGING) {
          console.log(
            `[PluginService] ${this.manifest.id} → ${call.toolName}`,
            `attempt=${attempt + 1}/${maxRetries + 1}`,
            `endpoint=${this.manifest.executeEndpoint}`
          );
        }

        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeoutMs);

          let response: Response;
          try {
            response = await fetch(this.manifest.executeEndpoint, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body,
              signal: controller.signal,
            });
          } finally {
            clearTimeout(timer);
          }

          if (DEBUG_LOGGING) {
            console.log(
              `[PluginService] ${this.manifest.id} ← HTTP ${response.status}`,
              `attempt=${attempt + 1}`
            );
          }

          // 4xx → client error, do not retry
          if (response.status >= 400 && response.status < 500) {
            return {
              success: false,
              error: `Plugin endpoint returned HTTP ${response.status}`,
              output: {
                errorType: "http_4xx",
                statusCode: response.status,
                retryCount: attempt,
              },
            };
          }

          // 5xx → server error, retry
          if (response.status >= 500) {
            lastStatus = response.status;
            lastError = `Plugin endpoint returned HTTP ${response.status}`;
            continue;
          }

          // 2xx / 3xx → success
          const data = (await response.json()) as unknown;
          return { success: true, output: data };
        } catch (err) {
          const isTimeout =
            err instanceof Error &&
            (err.name === "AbortError" || err.message.includes("aborted"));

          if (isTimeout) {
            lastError = `Plugin endpoint timed out after ${timeoutMs} ms`;
            // Timeout is treated as a transient error — retry
            if (DEBUG_LOGGING) {
              console.log(
                `[PluginService] ${this.manifest.id} timeout on attempt ${attempt + 1}`
              );
            }
          } else {
            // Network error (connection refused, DNS failure, etc.) — retry
            lastError = `Network error: ${(err as Error).message}`;
            if (DEBUG_LOGGING) {
              console.log(
                `[PluginService] ${this.manifest.id} network error on attempt ${attempt + 1}:`,
                lastError
              );
            }
          }
        }
      }

      // All attempts exhausted
      return {
        success: false,
        error: lastError ?? "Plugin execution failed after retries",
        output: {
          errorType: lastStatus !== undefined ? "http_5xx" : "network",
          statusCode: lastStatus,
          retryCount: maxRetries,
        },
      };
    }

    // ── Stub execution: return a realistic mock response ─────────────────────
    return {
      success: true,
      output: {
        plugin: this.manifest.id,
        tool: call.toolName,
        arguments: call.arguments,
        note: `[stub] Plugin "${this.manifest.name}" executed "${call.toolName}" successfully.`,
      },
    };
  }
}
