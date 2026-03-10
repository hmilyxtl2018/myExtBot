import { McpService, ToolCall, ToolDefinition, ToolResult } from "./types";

/**
 * McpServiceListManager is the single source of truth for all MCP services and
 * the tools they expose to the LLM.
 *
 * Responsibilities:
 * - Service registration and discovery
 * - Exposing a unified tool definitions list to the LLM
 * - Routing LLM tool_call responses to the correct service
 * - Dynamic enable/disable of services at runtime
 */
export class McpServiceListManager {
  private services: Map<string, McpService> = new Map();

  /**
   * Registers a new MCP service with the manager.
   * If a service with the same name is already registered, it will be overwritten.
   * @param service - The MCP service instance to register.
   */
  register(service: McpService): void {
    this.services.set(service.name, service);
  }

  /**
   * Enables a registered service by name, making its tools available to the LLM.
   * @param name - The name of the service to enable.
   * @throws Error if no service with the given name is registered.
   */
  enableService(name: string): void {
    const service = this.services.get(name);
    if (!service) {
      throw new Error(`Service "${name}" is not registered.`);
    }
    service.enabled = true;
  }

  /**
   * Disables a registered service by name, hiding its tools from the LLM.
   * @param name - The name of the service to disable.
   * @throws Error if no service with the given name is registered.
   */
  disableService(name: string): void {
    const service = this.services.get(name);
    if (!service) {
      throw new Error(`Service "${name}" is not registered.`);
    }
    service.enabled = false;
  }

  /**
   * Returns all tool definitions from enabled services.
   * This is the list you pass to the LLM so it knows what tools are available.
   *
   * @param filter - Optional list of service names to include. If omitted, all
   *                 enabled services are included.
   * @returns An array of ToolDefinition objects ready to be sent to the LLM.
   */
  getToolDefinitions(filter?: string[]): ToolDefinition[] {
    return [...this.services.values()]
      .filter((s) => s.enabled && (!filter || filter.includes(s.name)))
      .flatMap((s) => s.getToolDefinitions());
  }

  /**
   * Dispatches a tool call from the LLM to the appropriate service for execution.
   * The service is identified by looking up which registered service owns a tool
   * with the matching name.
   *
   * @param toolCall - The tool invocation received from the LLM.
   * @returns A promise resolving to the ToolResult from the owning service.
   * @throws Error if no enabled service owns a tool with the given name.
   */
  async dispatch(toolCall: ToolCall): Promise<ToolResult> {
    for (const service of this.services.values()) {
      if (!service.enabled) continue;
      const owns = service
        .getToolDefinitions()
        .some((t) => t.name === toolCall.toolName);
      if (owns) {
        return service.execute(toolCall);
      }
    }
    throw new Error(
      `No enabled service found that handles tool "${toolCall.toolName}".`
    );
  }

  /**
   * Returns a summary of all registered services and their current status.
   * Useful for debugging and monitoring.
   *
   * @returns An array of objects describing each service's name, enabled state,
   *          and the number of tools it provides.
   */
  listServices(): { name: string; enabled: boolean; toolCount: number }[] {
    return [...this.services.values()].map((s) => ({
      name: s.name,
      enabled: s.enabled,
      toolCount: s.getToolDefinitions().length,
    }));
  }
}
