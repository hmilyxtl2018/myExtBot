import { PluginManifest, ToolCall, ToolDefinition, ToolResult } from "../core/types";
import { BaseService } from "./BaseService";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;

/**
 * Structured error detail attached to ToolResult.error as a JSON string.
 */
export interface PluginErrorDetail {
  message: string;
  statusCode?: number;
  retryCount?: number;
  isTimeout?: boolean;
}

/**
 * PluginService is a generic McpService adapter for installed marketplace plugins.
 *
 * It wraps a `PluginManifest` and bridges the manager's `dispatch` path to the
 * plugin's actual execution logic:
 *
 * - If the manifest supplies an `executeEndpoint`, the service POSTs the tool
 *   call to that URL and returns the response as the ToolResult.
 *   - Requests use a configurable timeout (default 30 s, overridable via
 *     `manifest.timeout` or the `defaultTimeoutMs` constructor option).
 *   - Transient 5xx errors are retried up to 3 times with exponential backoff.
 *   - 4xx errors are NOT retried.
 * - Otherwise, a realistic stub response is returned so the UI and dispatch
 *   path work correctly even without a live backend.
 */
export class PluginService extends BaseService {
  private manifest: PluginManifest;
  private defaultTimeoutMs: number;

  constructor(manifest: PluginManifest, options?: { defaultTimeoutMs?: number }) {
    super();
    this.manifest = manifest;
    this.defaultTimeoutMs = options?.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
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
      return this._executeWithRetry(call);
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

  private async _executeWithRetry(call: ToolCall): Promise<ToolResult> {
    const endpoint = this.manifest.executeEndpoint!;
    const timeoutMs = this.manifest.timeout ?? this.defaultTimeoutMs;
    const body = JSON.stringify({ toolName: call.toolName, arguments: call.arguments });

    let attempt = 0;

    while (attempt < MAX_RETRIES) {
      attempt++;
      console.debug(
        `[PluginService] ${this.manifest.id} attempt ${attempt}/${MAX_RETRIES} → POST ${endpoint}`
      );

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          signal: controller.signal,
        });

        clearTimeout(timer);
        console.debug(
          `[PluginService] ${this.manifest.id} attempt ${attempt} ← HTTP ${response.status}`
        );

        if (response.ok) {
          const data = (await response.json()) as unknown;
          return { success: true, output: data };
        }

        // 4xx — client error, do not retry
        if (response.status >= 400 && response.status < 500) {
          const detail: PluginErrorDetail = {
            message: `Plugin endpoint returned HTTP ${response.status}`,
            statusCode: response.status,
            retryCount: 0,
          };
          return { success: false, error: JSON.stringify(detail) };
        }

        // 5xx — server error, retry if attempts remain
        if (attempt >= MAX_RETRIES) {
          const detail: PluginErrorDetail = {
            message: `Plugin endpoint returned HTTP ${response.status} after ${attempt} attempt(s)`,
            statusCode: response.status,
            retryCount: attempt,
          };
          return { success: false, error: JSON.stringify(detail) };
        }

        // Exponential backoff before next retry
        await this._sleep(200 * 2 ** (attempt - 1));
      } catch (err) {
        clearTimeout(timer);

        const isTimeout =
          err instanceof Error &&
          (err.name === "AbortError" || err.name === "TimeoutError");

        if (isTimeout) {
          console.debug(`[PluginService] ${this.manifest.id} attempt ${attempt} timed out`);
          if (attempt >= MAX_RETRIES) {
            const detail: PluginErrorDetail = {
              message: `Plugin endpoint timed out after ${timeoutMs} ms`,
              retryCount: attempt,
              isTimeout: true,
            };
            return { success: false, error: JSON.stringify(detail) };
          }
          // Retry on timeout
          await this._sleep(200 * 2 ** (attempt - 1));
          continue;
        }

        // Network / other error — retry
        const message = err instanceof Error ? err.message : "Unknown error";
        console.debug(`[PluginService] ${this.manifest.id} attempt ${attempt} network error: ${message}`);

        if (attempt >= MAX_RETRIES) {
          const detail: PluginErrorDetail = {
            message: `Failed to reach plugin endpoint: ${message}`,
            retryCount: attempt,
          };
          return { success: false, error: JSON.stringify(detail) };
        }

        await this._sleep(200 * 2 ** (attempt - 1));
      }
    }

    // All retry attempts exhausted — every path inside the loop returns,
    // so this line is a compiler safety net and is never reached at runtime.
    /* istanbul ignore next */
    const exhausted: PluginErrorDetail = { message: "Unexpected retry exhaustion", retryCount: MAX_RETRIES };
    return { success: false, error: JSON.stringify(exhausted) };
  }

  /** Resolves after `ms` milliseconds. Extracted for easy stubbing in tests. */
  protected _sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
