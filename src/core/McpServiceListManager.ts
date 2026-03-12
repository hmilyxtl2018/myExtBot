import {
  McpService,
  AgentProfile,
  ToolCallRequest,
  ToolResult,
  DelegationLogEntry,
  PluginManifest,
  AgentStatus,
  AgentLifecycleRecord,
  AgentLifecycleHistoryEntry,
} from "./types";
import { AgentLifecycleManager } from "./AgentLifecycleManager";

export class McpServiceListManager {
  private services = new Map<string, McpService>();
  private agents = new Map<string, AgentProfile>();
  private delegationLog: DelegationLogEntry[] = [];
  private lifecycleManager = new AgentLifecycleManager();

  // ─── Service registration ───────────────────────────────────────────────────

  registerService(service: McpService): void {
    this.services.set(service.id, service);
  }

  getService(serviceId: string): McpService | undefined {
    return this.services.get(serviceId);
  }

  getAllServices(): McpService[] {
    return Array.from(this.services.values());
  }

  // ─── Agent registration ─────────────────────────────────────────────────────

  registerAgent(agent: AgentProfile): void {
    this.agents.set(agent.id, agent);
    this.lifecycleManager.init(agent.id);
  }

  getAgent(agentId: string): AgentProfile | undefined {
    return this.agents.get(agentId);
  }

  getAllAgents(): AgentProfile[] {
    return Array.from(this.agents.values());
  }

  // ─── Dispatch ───────────────────────────────────────────────────────────────

  /**
   * Dispatch a tool call as a specific agent.
   * Checks agent lifecycle before executing and manages busy state.
   */
  async dispatchAs(agentId: string, request: ToolCallRequest): Promise<ToolResult> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent "${agentId}" not found.`);
    }

    // Lifecycle guard: reject calls for sleeping/retired/initializing agents
    const lifecycle = this.lifecycleManager.getRecord(agentId);
    if (!this.lifecycleManager.isCallable(agentId)) {
      throw new Error(
        `Agent "${agentId}" is not callable: current status is "${lifecycle.status}". ` +
          (lifecycle.reason ? `Reason: ${lifecycle.reason}` : "")
      );
    }

    // Find the service that provides the requested tool
    const service = this.findServiceForTool(agent, request.toolName);
    if (!service) {
      throw new Error(
        `Tool "${request.toolName}" not found in agent "${agentId}"'s allowed services.`
      );
    }

    // Mark agent as busy before executing
    this.lifecycleManager.markBusy(agentId);

    try {
      const result = await service.call(request);
      return result;
    } finally {
      // Always release the busy mark, even on error
      this.lifecycleManager.markTaskComplete(agentId);
    }
  }

  /**
   * Delegate a tool call from one agent to another.
   */
  async delegateAs(
    fromAgentId: string,
    toAgentId: string,
    request: ToolCallRequest
  ): Promise<ToolResult> {
    const fromAgent = this.agents.get(fromAgentId);
    if (!fromAgent) {
      throw new Error(`Delegating agent "${fromAgentId}" not found.`);
    }

    const canDelegate =
      fromAgent.canDelegateTo?.includes("*") ||
      fromAgent.canDelegateTo?.includes(toAgentId);
    if (!canDelegate) {
      throw new Error(
        `Agent "${fromAgentId}" is not allowed to delegate to "${toAgentId}".`
      );
    }

    const start = Date.now();
    let result: ToolResult | undefined;

    try {
      result = await this.dispatchAs(toAgentId, request);
      return result;
    } finally {
      this.delegationLog.push({
        timestamp: new Date().toISOString(),
        fromAgent: fromAgentId,
        toAgent: toAgentId,
        toolName: request.toolName,
        arguments: request.arguments,
        result,
        durationMs: Date.now() - start,
      });
    }
  }

  // ─── Plugin support ─────────────────────────────────────────────────────────

  installPlugin(manifest: PluginManifest): void {
    for (const service of manifest.services) {
      this.registerService(service);
    }
  }

  // ─── Delegation log ─────────────────────────────────────────────────────────

  getDelegationLog(): DelegationLogEntry[] {
    return [...this.delegationLog];
  }

  // ─── Lifecycle management ────────────────────────────────────────────────────

  getAgentStatus(agentId: string): AgentLifecycleRecord {
    return this.lifecycleManager.getRecord(agentId);
  }

  getAllAgentStatuses(): AgentLifecycleRecord[] {
    return this.lifecycleManager.getAllRecords();
  }

  transitionAgentStatus(
    agentId: string,
    newStatus: AgentStatus,
    reason?: string
  ): void {
    this.lifecycleManager.transition(agentId, newStatus, reason, "manual");
  }

  getAgentLifecycleHistory(
    agentId: string,
    limit?: number
  ): AgentLifecycleHistoryEntry[] {
    return this.lifecycleManager.getHistory(agentId, limit);
  }

  getAllAgentLifecycleHistory(limit?: number): AgentLifecycleHistoryEntry[] {
    return this.lifecycleManager.getAllHistory(limit);
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private findServiceForTool(
    agent: AgentProfile,
    toolName: string
  ): McpService | undefined {
    for (const serviceId of agent.allowedServices) {
      const service = this.services.get(serviceId);
      if (service && service.tools.some((t) => t.name === toolName)) {
        return service;
      }
    }
    return undefined;
  }
}
