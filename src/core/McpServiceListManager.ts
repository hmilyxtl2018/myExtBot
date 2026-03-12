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
}
