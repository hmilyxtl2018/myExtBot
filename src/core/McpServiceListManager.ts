import {
  AgentProfile,
  AgentSummary,
  DelegationLogEntry,
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
 * - Inter-agent communication: delegate tool calls from one agent to another
 *   with permission checking and a queryable delegation log
 */
export class McpServiceListManager {
  private services: Map<string, McpService> = new Map();
  private scenes: Map<string, Scene> = new Map();
  private agents: Map<string, AgentProfile> = new Map();

  /** Circular buffer of the last {@link DELEGATION_LOG_MAX} delegation records. */
  private delegationLog: DelegationLogEntry[] = [];
  private static readonly DELEGATION_LOG_MAX = 50;

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
   * Removes a registered service from the manager entirely.
   * Its tools will no longer be available to the LLM.
   * No-op if the service is not registered.
   * @param name - The name of the service to remove.
   */
  unregister(name: string): void {
    this.services.delete(name);
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
        canDelegateTo: agent.canDelegateTo,
        primarySkill: agent.primarySkill,
        secondarySkills: agent.secondarySkills,
        capabilities: agent.capabilities,
        constraints: agent.constraints,
        toolCount: this.getToolDefinitions(filter).length,
      };
    });
  }

  // ── Inter-agent communication ─────────────────────────────────────────────

  /**
   * Delegates a tool call from one agent to another.
   *
   * This is the foundation of multi-agent communication in myExtBot.  When
   * Agent A needs a capability it does not own (e.g. a research bot asking a
   * calendar assistant to schedule a follow-up), it delegates the tool call to
   * the appropriate agent.
   *
   * Permission model:
   * - The sending agent (`fromAgentId`) must list `toAgentId` in its
   *   `canDelegateTo` array, **or** have `canDelegateTo: ["*"]`.
   * - The receiving agent (`toAgentId`) must be able to handle the tool call
   *   (i.e. `dispatchAs(toAgentId, toolCall)` would succeed).
   *
   * Every delegation attempt (success or failure) is recorded in the
   * in-memory delegation log accessible via `getDelegationLog()`.
   *
   * @param fromAgentId - The agent initiating the delegation.
   * @param toAgentId   - The agent being asked to execute the tool.
   * @param toolCall    - The tool call to execute.
   * @returns A promise resolving to the ToolResult from the target agent.
   * @throws Error if either agent is not registered, the sender lacks
   *         delegation permission, or the target cannot handle the tool.
   */
  async delegateAs(
    fromAgentId: string,
    toAgentId: string,
    toolCall: ToolCall
  ): Promise<ToolResult> {
    const fromAgent = this.agents.get(fromAgentId);
    if (!fromAgent) {
      throw new Error(`Agent "${fromAgentId}" is not registered.`);
    }
    if (!this.agents.has(toAgentId)) {
      throw new Error(`Target agent "${toAgentId}" is not registered.`);
    }

    // Permission check: fromAgent must explicitly allow delegation to toAgent.
    const allowed = fromAgent.canDelegateTo ?? [];
    const hasPermission = allowed.includes("*") || allowed.includes(toAgentId);
    if (!hasPermission) {
      throw new Error(
        `Agent "${fromAgentId}" is not permitted to delegate to agent "${toAgentId}". ` +
          `Add "${toAgentId}" (or "*") to its canDelegateTo list.`
      );
    }

    // Execute the tool call as the target agent.
    let result: ToolResult;
    try {
      result = await this.dispatchAs(toAgentId, toolCall);
    } catch (err) {
      result = { success: false, error: (err as Error).message };
    }

    // Record in the delegation log.
    this.appendDelegationLog({
      timestamp: new Date().toISOString(),
      fromAgentId,
      toAgentId,
      toolName: toolCall.toolName,
      arguments: toolCall.arguments,
      success: result.success,
      output: result.output,
      error: result.error,
    });

    // Re-throw on failure so the caller gets a proper error response.
    if (!result.success) {
      throw new Error(result.error ?? "Delegation failed.");
    }
    return result;
  }

  /**
   * Returns the delegation log entries in reverse-chronological order
   * (most recent first), up to the last {@link DELEGATION_LOG_MAX} entries.
   */
  getDelegationLog(): DelegationLogEntry[] {
    return [...this.delegationLog].reverse();
  }

  /** Appends a log entry, evicting the oldest one when the buffer is full. */
  private appendDelegationLog(entry: DelegationLogEntry): void {
    this.delegationLog.push(entry);
    if (this.delegationLog.length > McpServiceListManager.DELEGATION_LOG_MAX) {
      this.delegationLog.shift();
    }
  }
}
