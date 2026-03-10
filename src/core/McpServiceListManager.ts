import {
  AgentProfile,
  AgentSummary,
  McpService,
  Scene,
  SceneSummary,
  ToolCall,
  ToolDefinition,
  ToolResult,
} from "./types";

/**
 * McpServiceListManager is the single source of truth for all MCP services and
 * the tools they expose to the LLM.
 *
 * Responsibilities:
 * - Service registration and discovery
 * - Exposing a unified tool definitions list to the LLM
 * - Routing LLM tool_call responses to the correct service
 * - Dynamic enable/disable of services at runtime
 * - Scene management: group services by use-case
 * - Agent management: restrict tool access per named LLM persona
 */
export class McpServiceListManager {
  private services: Map<string, McpService> = new Map();
  private scenes: Map<string, Scene> = new Map();
  private agents: Map<string, AgentProfile> = new Map();

  // ── Service management ────────────────────────────────────────────────────

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

  // ── Scene management ──────────────────────────────────────────────────────

  /**
   * Registers a Scene.  A scene groups services by use-case so the LLM can be
   * given only the tools relevant to the current user intent.
   * @param scene - The scene definition to register.
   */
  registerScene(scene: Scene): void {
    this.scenes.set(scene.id, { ...scene });
  }

  /**
   * Updates an existing scene.
   * @throws Error if the scene id is not registered.
   */
  updateScene(id: string, patch: Partial<Omit<Scene, "id">>): void {
    const existing = this.scenes.get(id);
    if (!existing) throw new Error(`Scene "${id}" is not registered.`);
    this.scenes.set(id, { ...existing, ...patch });
  }

  /** Removes a scene by id. */
  removeScene(id: string): void {
    this.scenes.delete(id);
  }

  /**
   * Returns the tool definitions available in a given scene.
   * Only enabled services that are listed in the scene's `serviceNames` are
   * included.
   * @param sceneId - The id of the scene to query.
   * @throws Error if the scene is not registered.
   */
  getToolDefinitionsForScene(sceneId: string): ToolDefinition[] {
    const scene = this.scenes.get(sceneId);
    if (!scene) throw new Error(`Scene "${sceneId}" is not registered.`);
    return this.getToolDefinitions(scene.serviceNames);
  }

  /**
   * Returns summaries of all registered scenes including a live tool count.
   */
  listScenes(): SceneSummary[] {
    return [...this.scenes.values()].map((scene) => ({
      id: scene.id,
      name: scene.name,
      description: scene.description,
      serviceNames: scene.serviceNames,
      toolCount: this.getToolDefinitions(scene.serviceNames).length,
    }));
  }

  // ── Agent management ──────────────────────────────────────────────────────

  /**
   * Registers an AgentProfile.  An agent is a named LLM persona with a specific
   * restricted set of tools.
   * @param agent - The agent profile to register.
   */
  registerAgent(agent: AgentProfile): void {
    this.agents.set(agent.id, { ...agent });
  }

  /**
   * Updates an existing agent profile.
   * @throws Error if the agent id is not registered.
   */
  updateAgent(id: string, patch: Partial<Omit<AgentProfile, "id">>): void {
    const existing = this.agents.get(id);
    if (!existing) throw new Error(`Agent "${id}" is not registered.`);
    this.agents.set(id, { ...existing, ...patch });
  }

  /** Removes an agent profile by id. */
  removeAgent(id: string): void {
    this.agents.delete(id);
  }

  /**
   * Resolves the allowed service names for an agent.
   *
   * Resolution order:
   * 1. If the agent has `allowedServices`, those are used directly.
   * 2. Else if the agent has a `sceneId`, the scene's `serviceNames` are used.
   * 3. Otherwise all registered services are allowed.
   */
  private resolveAgentServiceNames(agent: AgentProfile): string[] | undefined {
    if (agent.allowedServices && agent.allowedServices.length > 0) {
      return agent.allowedServices;
    }
    if (agent.sceneId) {
      const scene = this.scenes.get(agent.sceneId);
      if (scene) return scene.serviceNames;
    }
    return undefined; // all services
  }

  /**
   * Returns the tool definitions available to a specific agent.
   * Only enabled services that the agent is permitted to use are included.
   * @param agentId - The id of the agent.
   * @throws Error if the agent is not registered.
   */
  getToolDefinitionsForAgent(agentId: string): ToolDefinition[] {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error(`Agent "${agentId}" is not registered.`);
    const filter = this.resolveAgentServiceNames(agent);
    return this.getToolDefinitions(filter);
  }

  /**
   * Dispatches a tool call on behalf of a specific agent.
   * The call is only routed if the agent is permitted to use the owning service.
   * @param agentId - The id of the acting agent.
   * @param toolCall - The tool invocation from the LLM.
   * @throws Error if the agent is not registered, or if the tool is not in the
   *         agent's allowed set.
   */
  async dispatchAs(agentId: string, toolCall: ToolCall): Promise<ToolResult> {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error(`Agent "${agentId}" is not registered.`);

    const allowedServiceNames = this.resolveAgentServiceNames(agent);

    for (const service of this.services.values()) {
      if (!service.enabled) continue;
      if (allowedServiceNames && !allowedServiceNames.includes(service.name)) continue;
      const owns = service
        .getToolDefinitions()
        .some((t) => t.name === toolCall.toolName);
      if (owns) {
        return service.execute(toolCall);
      }
    }
    throw new Error(
      `Agent "${agentId}" is not permitted to call tool "${toolCall.toolName}", ` +
        `or no enabled service handles it.`
    );
  }

  /**
   * Returns summaries of all registered agents including a live tool count.
   */
  listAgents(): AgentSummary[] {
    return [...this.agents.values()].map((agent) => {
      const filter = this.resolveAgentServiceNames(agent);
      return {
        id: agent.id,
        name: agent.name,
        description: agent.description,
        sceneId: agent.sceneId,
        allowedServices: agent.allowedServices,
        toolCount: this.getToolDefinitions(filter).length,
      };
    });
  }
}
