import { PluginManifest, ToolCall, ToolDefinition, ToolResult } from "../core/types";
import { BaseService } from "./BaseService";

/**
 * PluginService is a generic McpService adapter for installed marketplace plugins.
 *
 * It wraps a `PluginManifest` and bridges the manager's `dispatch` path to the
 * plugin's actual execution logic:
 *
 * - If the manifest supplies an `executeEndpoint`, the service POSTs the tool
 *   call to that URL and returns the response as the ToolResult.
 * - Otherwise, a realistic stub response is returned so the UI and dispatch
 *   path work correctly even without a live backend.
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
      try {
        const response = await fetch(this.manifest.executeEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ toolName: call.toolName, arguments: call.arguments }),
        });
        if (!response.ok) {
          return {
            success: false,
            error: `Plugin endpoint returned HTTP ${response.status}`,
          };
        }
        const data = (await response.json()) as unknown;
        return { success: true, output: data };
      } catch (err) {
        return {
          success: false,
          error: `Failed to reach plugin endpoint: ${(err as Error).message}`,
        };
      }
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
