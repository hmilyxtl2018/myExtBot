import axios from "axios";
import { BaseService } from "../services/BaseService";
import { PluginManifest, ToolDefinition, ToolCall, ToolResult } from "../types";

/**
 * PluginService — wraps a PluginManifest as an McpService.
 *
 * execute() logic:
 * - If manifest.executeEndpoint exists: forward the tool call via HTTP POST.
 * - Otherwise: return a stub result { success: true, output: { message: "plugin stub" } }.
 */
export class PluginService extends BaseService {
  readonly name: string;

  constructor(private manifest: PluginManifest) {
    super();
    this.name = manifest.id;
  }

  getToolDefinitions(): ToolDefinition[] {
    return this.manifest.tools;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    if (this.manifest.executeEndpoint) {
      try {
        const response = await axios.post(this.manifest.executeEndpoint, {
          toolName: call.toolName,
          parameters: call.parameters,
        });
        return {
          success: true,
          output: response.data,
        };
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Unknown error";
        return {
          success: false,
          output: null,
          error: `Plugin execute failed: ${message}`,
        };
      }
    }

    // Stub result for plugins without a live endpoint
    return {
      success: true,
      output: {
        message: "plugin stub",
        plugin: this.manifest.id,
        tool: call.toolName,
        parameters: call.parameters,
      },
    };
  }
}
