import {
  AgentContract,
  AgentLifecycleHistoryEntry,
  AgentLifecycleRecord,
  AgentPipeline,
  AgentProfile,
  AgentStatus,
  AgentSummary,
  ContractCheckResult,
  CostSummary,
  DelegationLogEntry,
  LineageGraph,
  LineageGraphSummary,
  McpService,
  PipelineRunResult,
  Scene,
  SceneSummary,
  SceneTriggerResult,
  ServiceHealthRecord,
  ToolCall,
  ToolDefinition,
  ToolResult,
  TriggerContext,
} from "./types";
import { DelegationLogWriter } from "./DelegationLogWriter";
import { AgentLifecycleManager } from "./AgentLifecycleManager";
import { HealthMonitor } from "./HealthMonitor";
import { PipelineRegistry } from "./PipelineRegistry";
import { PipelineRunner } from "./PipelineRunner";
import { ContractEnforcer } from "./ContractEnforcer";
import { CostLedger } from "./CostLedger";
import type { CostQueryFilter } from "./CostLedger";
import { AgentRouter, type AgentRouteSuggestion } from "./AgentRouter";
import { SceneTriggerEngine } from "./SceneTriggerEngine";
import { CommunicationBridge } from "./CommunicationBridge";
import { LineageGraphBuilder } from "./LineageGraphBuilder";
import { LineageExporter } from "./LineageExporter";

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
 * - Inter-agent communication (Pillar 7): delegate tool calls via CommunicationBridge
 * - SLA contract management
 * - Cost tracking
 * - Agent lifecycle management
 * - Health monitoring
 * - Pipeline management
 * - Agent routing (Pillar 6/8)
 */
export class McpServiceListManager {
  private services: Map<string, McpService> = new Map();
  private scenes: Map<string, Scene> = new Map();
  private agents: Map<string, AgentProfile> = new Map();
  private contracts: Map<string, AgentContract> = new Map();

  /** Circular buffer of the last DELEGATION_LOG_MAX delegation records. */
  private delegationLog: DelegationLogEntry[] = [];
  private static readonly DELEGATION_LOG_MAX = 50;

  private logWriter = new DelegationLogWriter();
  private lifecycleManager = new AgentLifecycleManager();
  private healthMonitor = new HealthMonitor();
  private pipelineRegistry = new PipelineRegistry();
  private pipelineRunner = new PipelineRunner(this);
  private costLedger = new CostLedger();
  private contractEnforcer = new ContractEnforcer(this.costLedger);
  private agentRouter = new AgentRouter(this);
  private triggerEngine = new SceneTriggerEngine(this);
  private lineageBuilder = new LineageGraphBuilder();
  private lineageExporter = new LineageExporter();

  /** Pillar 7: Communication Bridge for inter-agent messaging. */
  communicationBridge = new CommunicationBridge(this);

  // ── Service management ────────────────────────────────────────────────────

  /**
   * Registers a new MCP service. If a service with the same name is already
   * registered, it will be overwritten.
   */
  register(service: McpService): void {
    this.services.set(service.name, service);
    this.healthMonitor.init(service.name);
  }

  /**
   * Removes a registered service. No-op if not found.
   */
  unregister(name: string): void {
    this.services.delete(name);
  }

  /**
   * Enables a registered service by name.
   */
  enableService(name: string): void {
    const service = this.services.get(name);
    if (!service) throw new Error(`Service "${name}" is not registered.`);
    service.enabled = true;
  }

  /**
   * Disables a registered service by name.
   */
  disableService(name: string): void {
    const service = this.services.get(name);
    if (!service) throw new Error(`Service "${name}" is not registered.`);
    service.enabled = false;
  }

  /**
   * Returns all tool definitions from enabled services.
   *
   * @param filter - Optional list of service names to include.
   */
  getToolDefinitions(filter?: string[]): ToolDefinition[] {
    return [...this.services.values()]
      .filter((s) => s.enabled && (!filter || filter.includes(s.name)))
      .flatMap((s) => s.getToolDefinitions());
  }

  /**
   * Dispatches a tool call to the appropriate service.
   * Health checks are performed before and after execution.
   */
  async dispatch(toolCall: ToolCall): Promise<ToolResult> {
    for (const service of this.services.values()) {
      if (!service.enabled) continue;
      const owns = service.getToolDefinitions().some((t) => t.name === toolCall.toolName);
      if (!owns) continue;

      this.healthMonitor.checkRateLimitRecovery(service.name);
      if (!this.healthMonitor.isCallable(service.name)) {
        const fallbackName = (service as { fallbackServiceName?: string }).fallbackServiceName;
        const fallbackService = fallbackName ? this.services.get(fallbackName) : undefined;
        if (fallbackService?.enabled) {
          const result = await fallbackService.execute(toolCall);
          if (result.success) {
            this.healthMonitor.recordSuccess(fallbackService.name);
          } else {
            this.healthMonitor.recordFailure(fallbackService.name, result.error ?? "unknown error");
          }
          return result;
        }
        return {
          success: false,
          error: `Service "${service.name}" is currently not callable (health: ${this.healthMonitor.getRecord(service.name).health}).`,
        };
      }

      const result = await service.execute(toolCall);
      if (result.success) {
        this.healthMonitor.recordSuccess(service.name);
      } else {
        this.healthMonitor.recordFailure(service.name, result.error ?? "unknown error");
      }
      return result;
    }
    return {
      success: false,
      error: `No enabled service found that handles tool "${toolCall.toolName}".`,
    };
  }

  /**
   * Returns a summary of all registered services and their current status.
   */
  listServices(): { name: string; enabled: boolean; toolCount: number }[] {
    return [...this.services.values()].map((s) => ({
      name: s.name,
      enabled: s.enabled,
      toolCount: s.getToolDefinitions().length,
    }));
  }

  // ── Scene management ──────────────────────────────────────────────────────

  /** Register (or replace) a Scene. */
  registerScene(scene: Scene): void {
    this.scenes.set(scene.id, { ...scene });
  }

  /** Get a scene by ID. */
  getScene(sceneId: string): Scene | undefined {
    return this.scenes.get(sceneId);
  }

  /** Get all registered Scenes as an array (used by SceneTriggerEngine). */
  getScenes(): Scene[] {
    return [...this.scenes.values()];
  }

  /** Unregister (remove) a scene by ID. Returns true if it existed. */
  unregisterScene(id: string): boolean {
    return this.scenes.delete(id);
  }

  /** Update an existing scene (partial patch). */
  updateScene(id: string, patch: Partial<Omit<Scene, "id">>): void {
    const existing = this.scenes.get(id);
    if (!existing) throw new Error(`Scene "${id}" is not registered.`);
    this.scenes.set(id, { ...existing, ...patch });
  }

  /** Activate a scene (stub — can be extended to set an active scene flag). */
  activateScene(id: string): void {
    if (!this.scenes.has(id)) throw new Error(`Scene "${id}" is not registered.`);
    // Scene activation is handled at the LLM prompt level by filtering tools
  }

  /** Deactivate a scene (stub). */
  deactivateScene(id: string): void {
    if (!this.scenes.has(id)) throw new Error(`Scene "${id}" is not registered.`);
  }

  /**
   * Returns the tool definitions available in a given scene.
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

  /** Alias for unregisterScene (backward compatibility). */
  removeScene(id: string): void {
    this.scenes.delete(id);
  }

  // ── Agent management ──────────────────────────────────────────────────────

  /**
   * Registers an AgentProfile. Agents are enabled by default unless explicitly disabled.
   */
  registerAgent(agent: AgentProfile): void {
    this.agents.set(agent.id, { enabled: true, ...agent });
    this.lifecycleManager.init(agent.id);
  }

  /**
   * Updates an existing agent profile (partial update).
   */
  updateAgent(id: string, patch: Partial<Omit<AgentProfile, "id">>): void {
    const existing = this.agents.get(id);
    if (!existing) throw new Error(`Agent "${id}" is not registered.`);
    this.agents.set(id, { ...existing, ...patch });
  }

  /** Remove an agent profile by ID. Returns true if it existed. */
  unregisterAgent(id: string): boolean {
    return this.agents.delete(id);
  }

  /** Alias for unregisterAgent (backward compatibility). */
  removeAgent(id: string): void {
    this.agents.delete(id);
  }

  /** Retrieve the full AgentProfile by ID. */
  getAgent(id: string): AgentProfile | undefined {
    return this.agents.get(id);
  }

  /**
   * Resolves the allowed service names for an agent.
   *
   * Resolution order:
   * 1. agent.allowedServices (if set)
   * 2. agent.sceneId → scene.serviceNames
   * 3. undefined (all services allowed)
   */
  private resolveAgentServiceNames(agent: AgentProfile): string[] | undefined {
    if (agent.allowedServices && agent.allowedServices.length > 0) {
      return agent.allowedServices;
    }
    if (agent.sceneId) {
      const scene = this.scenes.get(agent.sceneId);
      if (scene) return scene.serviceNames;
    }
    return undefined;
  }

  /**
   * Returns the tool definitions available to a specific agent.
   */
  getToolDefinitionsForAgent(agentId: string): ToolDefinition[] {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error(`Agent "${agentId}" is not registered.`);
    const filter = this.resolveAgentServiceNames(agent);
    return this.getToolDefinitions(filter);
  }

  /**
   * Dispatches a tool call on behalf of a specific agent.
   * Respects lifecycle state, health checks, and SLA contracts.
   */
  async dispatchAs(agentId: string, toolCall: ToolCall): Promise<ToolResult> {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error(`Agent "${agentId}" is not registered.`);

    // Lifecycle guard
    if (!this.lifecycleManager.isCallable(agentId)) {
      const lifecycle = this.lifecycleManager.getRecord(agentId);
      throw new Error(
        `Agent "${agentId}" is not callable: current status is "${lifecycle.status}".` +
          (lifecycle.reason ? ` Reason: ${lifecycle.reason}` : "")
      );
    }
    this.lifecycleManager.markBusy(agentId);

    const contract = this.contracts.get(agentId);
    const allowedServiceNames = this.resolveAgentServiceNames(agent);

    const executeCall = async (): Promise<ToolResult> => {
      for (const service of this.services.values()) {
        if (!service.enabled) continue;
        if (allowedServiceNames && !allowedServiceNames.includes(service.name)) continue;
        const owns = service.getToolDefinitions().some((t) => t.name === toolCall.toolName);
        if (!owns) continue;

        this.healthMonitor.checkRateLimitRecovery(service.name);
        if (!this.healthMonitor.isCallable(service.name)) {
          const fallbackName = (service as { fallbackServiceName?: string }).fallbackServiceName;
          const fallbackService = fallbackName ? this.services.get(fallbackName) : undefined;
          if (
            fallbackService?.enabled &&
            (!allowedServiceNames || allowedServiceNames.includes(fallbackService.name))
          ) {
            const result = await fallbackService.execute(toolCall);
            if (result.success) {
              this.healthMonitor.recordSuccess(fallbackService.name);
            } else {
              this.healthMonitor.recordFailure(fallbackService.name, result.error ?? "unknown error");
            }
            return result;
          }
          return {
            success: false,
            error: `Service "${service.name}" is currently not callable (health: ${this.healthMonitor.getRecord(service.name).health}).`,
          };
        }

        const result = await service.execute(toolCall);
        if (result.success) {
          this.healthMonitor.recordSuccess(service.name);
        } else {
          this.healthMonitor.recordFailure(service.name, result.error ?? "unknown error");
        }
        return result;
      }
      return {
        success: false,
        error: `Agent "${agentId}" cannot call tool "${toolCall.toolName}": no enabled service handles it.`,
      };
    };

    try {
      if (contract) {
        let fallbackExecute: (() => Promise<ToolResult>) | undefined;
        if (contract.fallback?.agentId) {
          const fallbackAgentId = contract.fallback.agentId;
          fallbackExecute = () => this.dispatchAs(fallbackAgentId, toolCall);
        }
        return await this.contractEnforcer.enforce(contract, agentId, toolCall.toolName, executeCall, fallbackExecute);
      }
      return await executeCall();
    } finally {
      this.lifecycleManager.markTaskComplete(agentId);
    }
  }

  /**
   * Returns lightweight summaries of all registered agents.
   * Includes Pillar 6–9 fields.
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
        enabled: agent.enabled,
        toolCount: this.getToolDefinitions(filter).length,
        // Pillar 5-6
        systemPrompt: agent.systemPrompt,
        intents: agent.intents,
        languages: agent.languages,
        responseStyle: agent.responseStyle,
        domains: agent.domains,
        // Pillar 7-9
        communication: agent.communication,
        orchestration: agent.orchestration,
        memory: agent.memory,
      };
    });
  }

  // ── Inter-agent communication (Pillar 7) ─────────────────────────────────

  /**
   * Delegates a tool call from one agent to another.
   * Uses CommunicationBridge to validate permissions and route the message.
   *
   * Permission model:
   * - fromAgent must list toAgentId in canDelegateTo or communication.delegationTargets
   * - toAgent must be able to handle the tool call
   *
   * Every delegation attempt is recorded in the in-memory delegation log.
   */
  async delegateAs(
    fromAgentId: string,
    toAgentId: string,
    toolCall: ToolCall
  ): Promise<ToolResult> {
    const fromAgent = this.agents.get(fromAgentId);
    if (!fromAgent) {
      return { success: false, error: `Agent "${fromAgentId}" is not registered.` };
    }
    if (!this.agents.has(toAgentId)) {
      return { success: false, error: `Target agent "${toAgentId}" is not registered.` };
    }

    // Use CommunicationBridge for permission check and execution
    const { allowed, result } = await this.communicationBridge.send(
      fromAgentId,
      toAgentId,
      toolCall,
      "delegation"
    );

    if (!allowed) {
      // Fall back to direct permission check for backward compatibility
      const canDelegate =
        fromAgent.canDelegateTo?.includes("*") ||
        fromAgent.canDelegateTo?.includes(toAgentId);
      if (!canDelegate) {
        const entry: DelegationLogEntry = {
          timestamp: new Date().toISOString(),
          fromAgentId,
          toAgentId,
          toolName: toolCall.toolName,
          arguments: toolCall.arguments,
          success: false,
          error: `Agent "${fromAgentId}" is not permitted to delegate to "${toAgentId}".`,
        };
        this.appendDelegationLog(entry);
        void this.logWriter.append(entry);
        return { success: false, error: entry.error };
      }

      // canDelegateTo allows it but CommunicationBridge didn't — run directly
      const directResult: ToolResult = await this.dispatchAs(toAgentId, toolCall).catch((err: unknown) => ({
        success: false as const,
        output: undefined,
        error: (err as Error).message,
      }));
      const entry: DelegationLogEntry = {
        timestamp: new Date().toISOString(),
        fromAgentId,
        toAgentId,
        toolName: toolCall.toolName,
        arguments: toolCall.arguments,
        success: directResult.success,
        output: directResult.output,
        error: directResult.error,
      };
      this.appendDelegationLog(entry);
      void this.logWriter.append(entry);
      return directResult;
    }

    const finalResult = result ?? { success: false, error: "No result from bridge" };
    const entry: DelegationLogEntry = {
      timestamp: new Date().toISOString(),
      fromAgentId,
      toAgentId,
      toolName: toolCall.toolName,
      arguments: toolCall.arguments,
      success: finalResult.success,
      output: finalResult.output,
      error: finalResult.error,
    };
    this.appendDelegationLog(entry);
    void this.logWriter.append(entry);
    return finalResult;
  }

  // ── SLA Contract management ───────────────────────────────────────────────

  /** Register (or replace) an SLA contract for a specific agent. */
  registerContract(contract: AgentContract): void {
    this.contracts.set(contract.agentId, contract);
  }

  /** Get the SLA contract for a specific agent, or undefined if none. */
  getContract(agentId: string): AgentContract | undefined {
    return this.contracts.get(agentId);
  }

  /** Remove the SLA contract for a specific agent. */
  removeContract(agentId: string): boolean {
    return this.contracts.delete(agentId);
  }

  /** List all registered SLA contracts. */
  listContracts(): AgentContract[] {
    return [...this.contracts.values()];
  }

  /**
   * Enforce the SLA contract for an agent then dispatch the tool call.
   * Equivalent to dispatchAs but ensures a contract is applied even if not
   * registered (uses the default no-contract path).
   */
  async enforceAndDispatch(agentId: string, toolCall: ToolCall): Promise<ToolResult> {
    return this.dispatchAs(agentId, toolCall);
  }

  /** Pre-check whether a tool call would be allowed under the agent's contract. */
  checkContract(agentId: string, toolName: string): ContractCheckResult {
    const contract = this.contracts.get(agentId);
    if (!contract) return { allowed: true };
    return this.contractEnforcer.preCheck(contract, agentId, toolName);
  }

  // ── Delegation log ────────────────────────────────────────────────────────

  /**
   * Returns the delegation log entries in reverse-chronological order.
   */
  getDelegationLog(): DelegationLogEntry[] {
    return [...this.delegationLog].reverse();
  }

  /**
   * Export the delegation log as a JSON string.
   */
  exportDelegationLog(): string {
    return JSON.stringify(this.getDelegationLog(), null, 2);
  }

  private appendDelegationLog(entry: DelegationLogEntry): void {
    this.delegationLog.push(entry);
    if (this.delegationLog.length > McpServiceListManager.DELEGATION_LOG_MAX) {
      this.delegationLog.shift();
    }
  }

  // ── Agent lifecycle (M10) ─────────────────────────────────────────────────

  getAgentLifecycleStatus(agentId: string): AgentLifecycleRecord {
    return this.lifecycleManager.getRecord(agentId);
  }

  /** Alias for getAgentLifecycleStatus. */
  getAgentStatus(agentId: string): AgentLifecycleRecord {
    return this.lifecycleManager.getRecord(agentId);
  }

  getAllAgentStatuses(): AgentLifecycleRecord[] {
    return this.lifecycleManager.getAllRecords();
  }

  transitionAgentStatus(agentId: string, newStatus: AgentStatus, reason?: string): void {
    this.lifecycleManager.transition(agentId, newStatus, reason, "manual");
  }

  getAgentLifecycleHistory(agentId: string, limit?: number): AgentLifecycleHistoryEntry[] {
    return this.lifecycleManager.getHistory(agentId, limit);
  }

  getAllAgentLifecycleHistory(limit?: number): AgentLifecycleHistoryEntry[] {
    return this.lifecycleManager.getAllHistory(limit);
  }

  // ── Health monitoring (M4) ────────────────────────────────────────────────

  /** Get the health record for a specific service. */
  getServiceHealth(serviceName: string): ServiceHealthRecord {
    return this.healthMonitor.getRecord(serviceName);
  }

  /** Get health records for all registered services. */
  getAllServiceHealths(): ServiceHealthRecord[] {
    return this.healthMonitor.getAllRecords();
  }

  /**
   * Manually reset a service's health to "healthy" (ops/admin use).
   * Returns the updated record.
   */
  resetServiceHealth(serviceName: string): ServiceHealthRecord {
    this.healthMonitor.resetToHealthy(serviceName);
    return this.healthMonitor.getRecord(serviceName);
  }

  // ── Pipeline management ───────────────────────────────────────────────────

  registerPipeline(pipeline: AgentPipeline): void {
    this.pipelineRegistry.register(pipeline);
  }

  getPipeline(id: string): AgentPipeline | undefined {
    return this.pipelineRegistry.get(id);
  }

  listPipelines(): AgentPipeline[] {
    return this.pipelineRegistry.list();
  }

  unregisterPipeline(id: string): boolean {
    return this.pipelineRegistry.unregister(id);
  }

  async runPipeline(
    pipelineId: string,
    initialInput?: Record<string, unknown>
  ): Promise<PipelineRunResult> {
    const pipeline = this.pipelineRegistry.get(pipelineId);
    if (!pipeline) {
      const now = new Date().toISOString();
      return {
        pipelineId,
        startedAt: now,
        completedAt: now,
        success: false,
        stepResults: [],
        error: `Pipeline "${pipelineId}" not found`,
      };
    }
    return this.pipelineRunner.run(pipeline, initialInput);
  }

  // ── Agent routing (Pillar 6/8) ────────────────────────────────────────────

  /**
   * Recommend Agents for the given natural-language query.
   */
  routeAgent(query: string, topN?: number): AgentRouteSuggestion[] {
    return this.agentRouter.route(query, topN);
  }

  /**
   * Return the ID of the single best-matching Agent, or undefined.
   */
  bestAgentForQuery(query: string): string | undefined {
    return this.agentRouter.bestMatch(query);
  }

  // ── Scene trigger evaluation ──────────────────────────────────────────────

  /**
   * Evaluate all scene triggers against the given context and return ranked results.
   */
  evaluateSceneTriggers(context: TriggerContext): SceneTriggerResult[] {
    return this.triggerEngine.evaluate(context);
  }

  /**
   * Return the ID of the best-matching Scene for the given context, or undefined.
   */
  bestSceneForContext(context: TriggerContext): string | undefined {
    return this.triggerEngine.bestScene(context);
  }

  // ── Cost ledger ───────────────────────────────────────────────────────────

  /** Expose CostLedger for external inspection. */
  getCostLedger(): CostLedger {
    return this.costLedger;
  }

  /** Get cost summary report, optionally filtered. */
  getCostSummary(filter?: CostQueryFilter): CostSummary {
    return this.costLedger.summarize(filter);
  }

  // ── Contract enforcer ──────────────────────────────────────────────────────

  /** Expose ContractEnforcer for pre-check operations. */
  getContractEnforcer(): ContractEnforcer {
    return this.contractEnforcer;
  }

  // ── Lineage graph ──────────────────────────────────────────────────────────

  /** Build a lineage graph from the in-memory delegation log. */
  buildLineageGraph(options?: { startTime?: string; endTime?: string }): LineageGraph {
    if (options?.startTime && options?.endTime) {
      return this.lineageBuilder.buildForTimeRange(
        this.delegationLog,
        options.startTime,
        options.endTime
      );
    }
    return this.lineageBuilder.build(this.delegationLog);
  }

  /** Export the lineage graph in Mermaid format. */
  exportLineageMermaid(options?: { startTime?: string; endTime?: string }): string {
    return this.lineageExporter.toMermaid(this.buildLineageGraph(options));
  }

  /** Export the lineage graph in DOT format. */
  exportLineageDOT(options?: { startTime?: string; endTime?: string }): string {
    return this.lineageExporter.toDOT(this.buildLineageGraph(options));
  }

  /** Get a summary of the lineage graph. */
  getLineageSummary(): LineageGraphSummary {
    const graph = this.buildLineageGraph();
    const agentNodes = graph.nodes.filter((n) => n.type === "agent").map((n) => n.agentId ?? n.label);
    const toolNodes = graph.nodes.filter((n) => n.type === "tool").map((n) => n.toolName ?? n.label);
    const timestamps = this.delegationLog.map((e) => e.timestamp).sort();
    const earliest = timestamps[0] ?? new Date().toISOString();
    const latest = timestamps[timestamps.length - 1] ?? new Date().toISOString();
    return {
      totalNodes: graph.nodeCount,
      totalEdges: graph.edgeCount,
      agentNodes,
      toolNodes,
      successRate: graph.successRate,
      timeRange: { earliest, latest },
    };
  }

  // ── Backward-compat aliases ────────────────────────────────────────────────

  /** Alias for evaluateSceneTriggers (backward compatibility). */
  autoDetectScene(context: TriggerContext): SceneTriggerResult[] {
    return this.triggerEngine.evaluate(context);
  }
}
