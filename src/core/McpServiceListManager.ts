/**
 * src/core/McpServiceListManager.ts
 *
 * Central registry and dispatcher for all MCP Services.
 * Integrates with HealthMonitor (M4) to provide:
 *   - Automatic health tracking on every execute()
 *   - Fallback routing when a service is "down" or "rate-limited"
 *   - Health query APIs
 */

import { McpService, ServiceResult, ServiceHealthRecord } from "./types";
import { HealthMonitor } from "./HealthMonitor";
import { BaseService } from "../services/BaseService";

/** Options passed to dispatch() or dispatchAs(). */
export interface DispatchOptions {
  /** If true, skip health checks (e.g. health-check pings themselves) */
  skipHealthCheck?: boolean;
}

export class McpServiceListManager {
  private services = new Map<string, McpService>();
  private healthMonitor = new HealthMonitor();

  // ── Registration ────────────────────────────────────────────────────────────

  /** Register a service and initialise its health record. */
  register(service: McpService): void {
    if (this.services.has(service.name)) {
      throw new Error(
        `Service "${service.name}" is already registered. Use a unique name.`
      );
    }
    this.services.set(service.name, service);
    this.healthMonitor.init(service.name);
  }

  /** Retrieve a registered service by name. */
  getService(name: string): McpService | undefined {
    return this.services.get(name);
  }

  /** List all registered service names. */
  listServices(): string[] {
    return Array.from(this.services.keys());
  }

  // ── Dispatch ─────────────────────────────────────────────────────────────────

  /**
   * Dispatch a call to the named service.
   * Health checks are performed before execution:
   *   1. checkRateLimitRecovery — auto-recover from expired rate-limit
   *   2. isCallable — if false, route to fallback or return error
   * Results are recorded in HealthMonitor after execution.
   */
  async dispatch(
    serviceName: string,
    payload: unknown,
    options: DispatchOptions = {}
  ): Promise<ServiceResult> {
    const service = this.services.get(serviceName);
    if (!service) {
      return { success: false, error: `Service "${serviceName}" not found.` };
    }

    if (!options.skipHealthCheck) {
      // 1. Check if rate-limit window has passed
      this.healthMonitor.checkRateLimitRecovery(serviceName);

      // 2. Check if service is callable
      if (!this.healthMonitor.isCallable(serviceName)) {
        const record = this.healthMonitor.getRecord(serviceName);
        const fallbackName = (service as BaseService).fallbackServiceName;

        if (fallbackName) {
          console.warn(
            `[HealthMonitor] Service "${serviceName}" is ${record.health}. ` +
              `Routing to fallback "${fallbackName}".`
          );
          return this.dispatch(fallbackName, payload, options);
        }

        return {
          success: false,
          error: `Service "${serviceName}" is ${record.health}, no fallback available.`,
        };
      }
    }

    // 3. Execute
    let result: ServiceResult;
    try {
      result = await service.execute(payload);
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : String(err);
      this.healthMonitor.recordFailure(serviceName, errorMessage);
      return { success: false, error: errorMessage };
    }

    // 4. Record health outcome
    if (result.success) {
      this.healthMonitor.recordSuccess(serviceName);
    } else {
      const errorMsg = result.error ?? "Unknown error";
      this.healthMonitor.recordFailure(
        serviceName,
        errorMsg,
        result.retryAfterSeconds
      );
    }

import {
  AgentPipeline,
  AgentProfile,
  DelegationLog,
  DelegationRequest,
  McpService,
  PipelineRunResult,
  ServiceResult,
} from "./types";
import { PipelineRegistry } from "./PipelineRegistry";
import { PipelineRunner } from "./PipelineRunner";

let _logIdCounter = 0;
function nextLogId(): string {
  return `log-${Date.now()}-${++_logIdCounter}`;
}

/**
 * McpServiceListManager — central hub for agents, services, and pipelines.
 *
 * Responsibilities:
 *  - Register / query agents (AgentProfile)
 *  - Register / query services (McpService)
 *  - Dispatch tool calls on behalf of an agent (dispatchAs)
 *  - Maintain an in-memory DelegationLog
 *  - Register / run Multi-Agent Pipelines (M3)
 */
export class McpServiceListManager {
  private agents = new Map<string, AgentProfile>();
  private services = new Map<string, McpService>();
  private delegationLogs: DelegationLog[] = [];

  private pipelineRegistry = new PipelineRegistry();
  private pipelineRunner = new PipelineRunner(this);

  // ── Agent management ────────────────────────────────────────────────────────

  registerAgent(agent: AgentProfile): void {
    this.agents.set(agent.id, agent);
  }

  getAgent(id: string): AgentProfile | undefined {
    return this.agents.get(id);
  }

  listAgents(): AgentProfile[] {
    return Array.from(this.agents.values());
  }

  // ── Service management ──────────────────────────────────────────────────────

  registerService(service: McpService): void {
    this.services.set(service.id, service);
  }

  getService(id: string): McpService | undefined {
    return this.services.get(id);
  }

  listServices(): McpService[] {
    return Array.from(this.services.values());
  }

  // ── Delegation ──────────────────────────────────────────────────────────────

  /**
   * Dispatch a tool call on behalf of the given agent.
   *
   * The method finds a registered service that exposes the requested tool and
   * that the agent is allowed to use.  Every call is recorded in the
   * DelegationLog (fromAgentId is the calling agent; when called from a
   * pipeline the caller uses "pipeline:{pipelineId}").
   */
  async dispatchAs(
    agentId: string,
    request: DelegationRequest
  ): Promise<ServiceResult> {
    const agent = this.agents.get(agentId);
    const startedAt = new Date().toISOString();
    const logId = nextLogId();
    const startMs = Date.now();

    const logEntry: DelegationLog = {
      id: logId,
      fromAgentId: agentId,
      toAgentId: agentId,
      toolName: request.toolName,
      arguments: request.arguments,
      startedAt,
    };

    // Resolve the service that owns the requested tool
    const service = this.resolveService(agent, request.toolName);

    if (!service) {
      const error = `No accessible service found for tool "${request.toolName}" and agent "${agentId}"`;
      logEntry.result = { success: false, error };
      logEntry.completedAt = new Date().toISOString();
      logEntry.durationMs = Date.now() - startMs;
      this.delegationLogs.push(logEntry);
      return { success: false, error };
    }

    logEntry.toAgentId = service.id;

    try {
      const result = await service.call(request.toolName, request.arguments);
      logEntry.result = result;
      logEntry.completedAt = new Date().toISOString();
      logEntry.durationMs = Date.now() - startMs;
      this.delegationLogs.push(logEntry);
      return result;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logEntry.result = { success: false, error };
      logEntry.completedAt = new Date().toISOString();
      logEntry.durationMs = Date.now() - startMs;
      this.delegationLogs.push(logEntry);
      return { success: false, error };
    }
  }

  /**
   * Delegate a task from one agent to another (single-hop delegation).
import { randomUUID } from "crypto";
import {
  DelegationLogEntry,
  LineageGraph,
  LineageGraphSummary,
  ToolCall,
  ToolDefinition,
  ToolResult,
} from "./types";
import { LineageExporter } from "./LineageExporter";
import { LineageGraphBuilder } from "./LineageGraphBuilder";

/**
 * BaseService — abstract base for all MCP services.
 */
export abstract class BaseService {
  abstract readonly name: string;
  abstract getToolDefinitions(): ToolDefinition[];
  abstract execute(call: ToolCall): Promise<ToolResult>;
}

/**
 * McpServiceListManager — manages a collection of BaseService instances,
 * handles agent delegation, logs every delegation, and provides lineage graph
 * building/exporting capabilities.
 */
export class McpServiceListManager {
  private services = new Map<string, BaseService>();
  private delegationLog: DelegationLogEntry[] = [];

  private lineageBuilder = new LineageGraphBuilder();
  private lineageExporter = new LineageExporter();

  // ── Service registration ─────────────────────────────────────────────────

  register(service: BaseService): void {
    this.services.set(service.name, service);
  }

  getService(name: string): BaseService | undefined {
    return this.services.get(name);
  }

  listServices(): string[] {
    return [...this.services.keys()];
  }

  // ── Agent delegation ─────────────────────────────────────────────────────

  /**
   * Delegate a tool call from fromAgentId to toAgentId.
   * The result and metadata are automatically logged to delegationLog.
import { SceneTriggerEngine } from "./SceneTriggerEngine";
import type { Scene, SceneTriggerResult, TriggerContext } from "./types";

/**
 * McpServiceListManager — manages the registry of Scenes and exposes
 * scene-lookup and trigger-evaluation capabilities.
 */
export class McpServiceListManager {
  private scenes: Map<string, Scene> = new Map();
  private triggerEngine = new SceneTriggerEngine(this);

  // ─── Scene registry ────────────────────────────────────────────────────────

  /**
   * Registers (or replaces) a Scene in the manager.
   * The Scene may optionally include trigger conditions.
   */
  registerScene(scene: Scene): void {
    this.scenes.set(scene.id, scene);
  }

  /** Returns a Scene by ID, or undefined if not found. */
  getScene(id: string): Scene | undefined {
    return this.scenes.get(id);
  }

  /** Returns all registered Scenes as an array. */
  getScenes(): Scene[] {
    return Array.from(this.scenes.values());
  }

  /** Removes a Scene from the registry. Returns true if it existed. */
  removeScene(id: string): boolean {
    return this.scenes.delete(id);
  }

  // ─── Trigger evaluation ────────────────────────────────────────────────────

  /**
   * Evaluates all registered Scenes against the provided context and returns
   * a ranked list of recommendations (descending score).
   */
  autoDetectScene(context: TriggerContext): SceneTriggerResult[] {
    return this.triggerEngine.evaluate(context);
  }

  /**
   * Returns the ID of the best-matching Scene for the given context,
   * or undefined if no Scene matches.
   */
  bestSceneForContext(context: TriggerContext): string | undefined {
    return this.triggerEngine.bestScene(context);
/**
 * McpServiceListManager — Central registry for Agents and their tool services.
 *
 * M6 additions:
 *  - listAgents() now includes all AgentProfile persona/intent fields in the summary
 *  - routeAgent()        — delegates to AgentRouter.route()
 *  - bestAgentForQuery() — delegates to AgentRouter.bestMatch()
 */

import type {
  AgentProfile,
  AgentSummary,
  DelegationLogEntry,
  ToolCall,
  ToolResult,
} from "./types";
import { AgentRouter, type AgentRouteSuggestion } from "./AgentRouter";

export class McpServiceListManager {
  private readonly agents = new Map<string, AgentProfile>();
  private readonly delegationLog: DelegationLogEntry[] = [];
  private readonly agentRouter: AgentRouter;

  constructor() {
    this.agentRouter = new AgentRouter(this);
  }

  // ── Agent Registration ─────────────────────────────────────────────────────

  /**
   * Register a new Agent profile.
   * Agents are enabled by default unless `enabled: false` is explicitly set.
   */
  registerAgent(profile: AgentProfile): void {
    const normalised: AgentProfile = {
      enabled: true,
      ...profile,
    };
    this.agents.set(profile.id, normalised);
  }

  /**
   * Update an existing Agent's profile fields (partial update).
   * Returns true when the agent was found and updated, false otherwise.
   */
  updateAgent(id: string, partial: Partial<AgentProfile>): boolean {
    const existing = this.agents.get(id);
    if (!existing) return false;
    this.agents.set(id, { ...existing, ...partial });
    return true;
  }

  /** Remove an Agent from the registry. */
  unregisterAgent(id: string): boolean {
    return this.agents.delete(id);
  }

  /** Retrieve the full AgentProfile by ID. */
  getAgent(id: string): AgentProfile | undefined {
    return this.agents.get(id);
  }

  // ── Listing ────────────────────────────────────────────────────────────────

  /**
   * Returns lightweight summaries of all registered agents.
   * All M6 persona/intent fields are included so callers can display them.
   */
  listAgents(): AgentSummary[] {
    return Array.from(this.agents.values()).map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description,
      sceneId: a.sceneId,
      primarySkill: a.primarySkill,
      capabilities: a.capabilities,
      enabled: a.enabled,
      toolCount: a.capabilities?.length ?? 0,
      // M6 fields
      systemPrompt: a.systemPrompt,
      intents: a.intents,
      languages: a.languages,
      responseStyle: a.responseStyle,
      domains: a.domains,
    }));
  }

  // ── Delegation ─────────────────────────────────────────────────────────────

  /**
   * Delegate a tool call from one agent to another.
   * The delegation is recorded in the in-memory log.
   */
  delegateAs(
    fromAgentId: string,
    toAgentId: string,
    toolCall: ToolCall
  ): ToolResult {
import {
  AgentProfile,
  AgentSummary,
  AgentLifecycleRecord,
  AgentLifecycleHistoryEntry,
  AgentStatus,
  DelegationLogEntry,
  McpService,
  Scene,
  SceneSummary,
  ServiceHealthRecord,
  ToolCall,
  ToolDefinition,
  ToolResult,
  AgentPipeline,
  PipelineRunResult,
} from "./types";
import { DelegationLogWriter } from "./DelegationLogWriter";
import { AgentLifecycleManager } from "./AgentLifecycleManager";
import { HealthMonitor } from "./HealthMonitor";
import { PipelineRegistry } from "./PipelineRegistry";
import { PipelineRunner } from "./PipelineRunner";

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

  /** Persists delegation log entries to disk. */
  private logWriter = new DelegationLogWriter();

  /** Manages agent lifecycle state machine. */
  private lifecycleManager = new AgentLifecycleManager();

  /** Monitors real-time health of registered services. */
  private healthMonitor = new HealthMonitor();
  private pipelineRegistry = new PipelineRegistry();
  private pipelineRunner = new PipelineRunner(this);

  // ── Service management ────────────────────────────────────────────────────

  /**
   * Registers a new MCP service with the manager.
   * If a service with the same name is already registered, it will be overwritten.
   * @param service - The MCP service instance to register.
   */
  register(service: McpService): void {
    this.services.set(service.name, service);
    this.healthMonitor.init(service.name);
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
        this.healthMonitor.checkRateLimitRecovery(service.name);
        if (!this.healthMonitor.isCallable(service.name)) {
          const fallbackName = (service as { fallbackServiceName?: string }).fallbackServiceName;
          const fallbackService = fallbackName ? this.services.get(fallbackName) : undefined;
          if (fallbackService && fallbackService.enabled) {
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
    this.lifecycleManager.init(agent.id);
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

    // Lifecycle guard
    if (!this.lifecycleManager.isCallable(agentId)) {
      const lifecycle = this.lifecycleManager.getRecord(agentId);
      throw new Error(
        `Agent "${agentId}" is not callable: current status is "${lifecycle.status}".` +
          (lifecycle.reason ? ` Reason: ${lifecycle.reason}` : "")
      );
    }
    this.lifecycleManager.markBusy(agentId);

    const allowedServiceNames = this.resolveAgentServiceNames(agent);

    try {
      for (const service of this.services.values()) {
        if (!service.enabled) continue;
        if (allowedServiceNames && !allowedServiceNames.includes(service.name)) continue;
        const owns = service
          .getToolDefinitions()
          .some((t) => t.name === toolCall.toolName);
        if (owns) {
          this.healthMonitor.checkRateLimitRecovery(service.name);
          if (!this.healthMonitor.isCallable(service.name)) {
            const fallbackName = (service as { fallbackServiceName?: string }).fallbackServiceName;
            const fallbackService = fallbackName ? this.services.get(fallbackName) : undefined;
            if (fallbackService && fallbackService.enabled &&
                (!allowedServiceNames || allowedServiceNames.includes(fallbackService.name))) {
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
      }
      throw new Error(
        `Agent "${agentId}" is not permitted to call tool "${toolCall.toolName}", ` +
          `or no enabled service handles it.`
      );
    } finally {
      this.lifecycleManager.markTaskComplete(agentId);
    }
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
    request: DelegationRequest
  ): Promise<ServiceResult> {
    const fromAgent = this.agents.get(fromAgentId);
    if (!fromAgent) {
      return { success: false, error: `Agent "${fromAgentId}" not found` };
    }

    const allowed =
      fromAgent.canDelegateTo?.includes("*") ||
      fromAgent.canDelegateTo?.includes(toAgentId);

    if (!allowed) {
      return {
        success: false,
        error: `Agent "${fromAgentId}" is not allowed to delegate to "${toAgentId}"`,
      };
    }

    return this.dispatchAs(toAgentId, request);
  }

  getDelegationLogs(): DelegationLog[] {
    return [...this.delegationLogs];
  }

  // ── Pipeline management (M3) ────────────────────────────────────────────────
    call: ToolCall
  ): Promise<ToolResult> {
    const service = this.services.get(toAgentId);

    const start = Date.now();
    let result: ToolResult;

    if (!service) {
      result = { success: false, error: `Service not found: ${toAgentId}` };
    } else {
      try {
        result = await service.execute(call);
      } catch (err) {
        result = { success: false, error: (err as Error).message };
      }
    }

    const durationMs = Date.now() - start;

    const entry: DelegationLogEntry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      fromAgentId,
      toAgentId,
      toolName: call.toolName,
      arguments: call.arguments,
      success: result.success,
      error: result.error,
      durationMs,
    };

    this.delegationLog.push(entry);
    return result;
  }

  // ── Delegation log access ────────────────────────────────────────────────

  getDelegationLog(): readonly DelegationLogEntry[] {
    return this.delegationLog;
  }

  clearDelegationLog(): void {
    this.delegationLog = [];
  }

  // ── Lineage graph ────────────────────────────────────────────────────────

  /**
   * Build a lineage graph from the in-memory delegation log.
   * Optionally filter by time range.
   */
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

  /**
   * Export the lineage graph in Mermaid format.
   */
  exportLineageMermaid(options?: { startTime?: string; endTime?: string }): string {
    const graph = this.buildLineageGraph(options);
    return this.lineageExporter.toMermaid(graph);
  }

  /**
   * Export the lineage graph in JSON format.
   */
  exportLineageJSON(options?: { startTime?: string; endTime?: string }): string {
    const graph = this.buildLineageGraph(options);
    return this.lineageExporter.toJSON(graph);
  }

  /**
   * Export the lineage graph in DOT format.
   */
  exportLineageDOT(options?: { startTime?: string; endTime?: string }): string {
    const graph = this.buildLineageGraph(options);
    return this.lineageExporter.toDOT(graph);
  }

  /**
   * Get a summary of the lineage graph.
   */
  getLineageSummary(): LineageGraphSummary {
    const graph = this.buildLineageGraph();
    const agentNodes = graph.nodes
      .filter((n) => n.type === "agent")
      .map((n) => n.agentId ?? n.label);
    const toolNodes = graph.nodes
      .filter((n) => n.type === "tool")
      .map((n) => n.toolName ?? n.label);

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
    const entry: DelegationLogEntry = {
      timestamp: new Date().toISOString(),
      fromAgentId,
      toAgentId,
      toolName: toolCall.name,
      arguments: toolCall.arguments,
      success: false,
    };

    try {
      // Stub execution — in a real system this would call the service layer.
      const output = { message: `[stub] ${toAgentId}.${toolCall.name} executed` };
      entry.success = true;
      entry.output = output;
      this.delegationLog.push(entry);
      return { success: true, output };
    } catch (err) {
      entry.error = err instanceof Error ? err.message : String(err);
      this.delegationLog.push(entry);
      return { success: false, error: entry.error };
    }
  }

  /** Read the in-memory delegation log. */
  getDelegationLog(): Readonly<DelegationLogEntry[]> {
    return this.delegationLog;
  }

  // ── M6: Agent Routing ──────────────────────────────────────────────────────

  /**
   * Recommend the best-fit Agents for the given natural-language query.
   *
   * @param query User input.
   * @param topN  Number of suggestions to return (default 3).
   */
  routeAgent(query: string, topN?: number): AgentRouteSuggestion[] {
    return this.agentRouter.route(query, topN);
  }

  /**
   * Return the ID of the single best-matching Agent, or undefined when no
   * agent scores above 0 for the query.
   */
  bestAgentForQuery(query: string): string | undefined {
    return this.agentRouter.bestMatch(query);
      toolName: toolCall.toolName,
      arguments: toolCall.arguments,
      success: result.success,
      output: result.output,
      error: result.error,
    };
    this.appendDelegationLog(entry);
    // Persist to disk asynchronously; failure must not affect the return value.
    void this.logWriter.append(entry);

    // Re-throw on failure so the caller gets a proper error response.
    if (!result.success) {
      throw new Error(result.error ?? "Delegation failed.");
    }
    return result;
  }

  /**
   * Dispatch a call on behalf of (as) a specific agent identity.
   * Delegates to dispatch() after logging the agent context.
   */
  async dispatchAs(
    agentId: string,
    serviceName: string,
    payload: unknown,
    options: DispatchOptions = {}
  ): Promise<ServiceResult> {
    console.log(
      `[McpServiceListManager] Agent "${agentId}" dispatching to "${serviceName}"`
    );
    return this.dispatch(serviceName, payload, options);
  }

  // ── Health API ───────────────────────────────────────────────────────────────
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

  // ─── Lifecycle management (M10) ──────────────────────────────────────────────

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

  // ─── Health monitoring (M4) ───────────────────────────────────────────────

  /** Get the health record for a specific service. */
  getServiceHealth(serviceName: string): ServiceHealthRecord {
    return this.healthMonitor.getRecord(serviceName);
  }

  /** Get health records for all registered services. */
  getAllServiceHealths(): ServiceHealthRecord[] {
    return this.healthMonitor.getAllRecords();
  }

  /**
   * Manually reset a service's health to "healthy" (ops / admin use).
   * Manually reset a service's health to "healthy" (ops/admin use).
   * Returns the updated record.
   */
  resetServiceHealth(serviceName: string): ServiceHealthRecord {
    this.healthMonitor.resetToHealthy(serviceName);
    return this.healthMonitor.getRecord(serviceName);
  // ── Pipeline management ───────────────────────────────────────────────────────

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

  // ── Internal helpers ────────────────────────────────────────────────────────

  /**
   * Find a service that:
   *  1. Exposes the requested tool
   *  2. Is in the agent's allowedServices list (or agent has no restriction)
   *
   * If agent is undefined (e.g., pipeline virtual agent), any service with the
   * tool is accepted.
   */
  private resolveService(
    agent: AgentProfile | undefined,
    toolName: string
  ): McpService | undefined {
    for (const service of this.services.values()) {
      const hasTool = service.tools.some((t) => t.name === toolName);
      if (!hasTool) continue;

      if (!agent || !agent.allowedServices || agent.allowedServices.length === 0) {
        return service;
      }

      if (agent.allowedServices.includes(service.id)) {
        return service;
      }
    }
    return undefined;
  }
      throw new Error(`Pipeline "${pipelineId}" is not registered.`);
    }
    return this.pipelineRunner.run(pipeline, initialInput);
  }
}
