import { BaseService } from "../services/BaseService";
import { ToolDefinition, ToolCall, ToolResult } from "../types";

/**
 * McpServiceListManager — central registry for all MCP services.
 *
 * Responsibilities:
 * - Register and unregister services at runtime
 * - Aggregate tool definitions across all registered services
 * - Route tool calls to the appropriate service
 */
export class McpServiceListManager {
  private services: Map<string, BaseService> = new Map();

  /**
   * Register a service. If a service with the same name already exists,
   * it is replaced.
   */
  register(service: BaseService): void {
    this.services.set(service.name, service);
  }

  /**
   * Unregister a service by name. No-op if the service is not found.
   */
  unregister(serviceName: string): void {
    this.services.delete(serviceName);
  }

  /**
   * Returns the aggregated list of tool definitions from all registered
   * services.
   */
  getToolDefinitions(): ToolDefinition[] {
    const tools: ToolDefinition[] = [];
    for (const service of this.services.values()) {
      tools.push(...service.getToolDefinitions());
    }
    return tools;
  }

  /**
   * Execute a tool call by routing it to the service that owns the tool.
   * Throws if no service handles the given tool name.
   */
  async execute(call: ToolCall): Promise<ToolResult> {
    for (const service of this.services.values()) {
      const owns = service
        .getToolDefinitions()
        .some((t) => t.name === call.toolName);
      if (owns) {
        return service.execute(call);
      }
    }
    return {
      success: false,
      output: null,
      error: `No service found for tool: ${call.toolName}`,
    };
  }

  /** Returns all currently registered services. */
  getServices(): BaseService[] {
    return Array.from(this.services.values());
  }

  /** Returns a registered service by name, or undefined. */
  getService(name: string): BaseService | undefined {
    return this.services.get(name);
  }
}
