import { AgentContract, ToolCall, ToolDefinition, ToolResult } from "./types";
import { BaseService } from "../services/BaseService";
import { ContractEnforcer } from "./ContractEnforcer";
import { CostLedger } from "./CostLedger";

/**
 * Scene definition — a named collection of services made available to an agent.
 */
export interface Scene {
  id: string;
  name: string;
  description: string;
  serviceNames: string[];
}

/**
 * McpServiceListManager — orchestrates services, agents and SLA contracts.
 *
 * Key responsibilities:
 *  - Register/unregister services
 *  - Register scenes (named service subsets)
 *  - Dispatch tool calls as a specific agent, enforcing SLA contracts when present
 *  - Manage AgentContract lifecycle (register / get / remove / list)
 */
export class McpServiceListManager {
  private services = new Map<string, BaseService>();
  private scenes = new Map<string, Scene>();
  private contracts = new Map<string, AgentContract>();
  private costLedger = new CostLedger();
  private contractEnforcer = new ContractEnforcer(this.costLedger);

  // ── Service management ────────────────────────────────────────────────────

  /** Register a service. Overwrites any previously registered service with the same name. */
  register(service: BaseService): void {
    this.services.set(service.name, service);
  }

  /** Unregister a service by name. */
  unregister(serviceName: string): boolean {
    return this.services.delete(serviceName);
  }

  /** List all registered service names. */
  listServices(): string[] {
    return [...this.services.keys()];
  }

  /** Get all tool definitions across all registered services. */
  getAllToolDefinitions(): ToolDefinition[] {
    const defs: ToolDefinition[] = [];
    for (const svc of this.services.values()) {
      defs.push(...svc.getToolDefinitions());
    }
    return defs;
  }

  // ── Scene management ──────────────────────────────────────────────────────

  /** Register a scene. */
  registerScene(scene: Scene): void {
    this.scenes.set(scene.id, scene);
  }

  /** Get a scene by ID. */
  getScene(sceneId: string): Scene | undefined {
    return this.scenes.get(sceneId);
  }

  /** List all registered scenes. */
  listScenes(): Scene[] {
    return [...this.scenes.values()];
  }

  // ── Contract management ───────────────────────────────────────────────────

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

  // ── Dispatch ──────────────────────────────────────────────────────────────

  /**
   * Dispatch a tool call as a specific agent.
   *
   * - If the agent has a registered SLA contract, the call is wrapped in
   *   `contractEnforcer.enforce()` for timeout/cost/rate-limit protection.
   * - Otherwise the call is executed directly (original behaviour).
   */
  async dispatchAs(agentId: string, toolCall: ToolCall): Promise<ToolResult> {
    const contract = this.contracts.get(agentId);

    const execute = () => this.executeToolCall(toolCall);

    if (!contract) {
      return execute();
    }

    // Build fallback executor if a fallback agentId is configured
    let fallbackExecute: (() => Promise<ToolResult>) | undefined;
    if (contract.fallback?.agentId) {
      const fallbackAgentId = contract.fallback.agentId;
      fallbackExecute = () => this.executeToolCall(toolCall, fallbackAgentId);
    }

    return this.contractEnforcer.enforce(
      contract,
      agentId,
      toolCall.toolName,
      execute,
      fallbackExecute
    );
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  /**
   * Find the service that owns a given tool and execute the call.
   * If agentId is provided, the scene-based service restriction would be applied here
   * (stub: currently all services are searched).
   */
  private async executeToolCall(
    toolCall: ToolCall,
    _agentId?: string
  ): Promise<ToolResult> {
    for (const svc of this.services.values()) {
      const hasTool = svc
        .getToolDefinitions()
        .some((d) => d.name === toolCall.toolName);
      if (hasTool) {
        return svc.execute(toolCall);
      }
    }
    return {
      success: false,
      error: `No service found for tool "${toolCall.toolName}"`,
    };
  }

  /** Expose CostLedger for external inspection. */
  getCostLedger(): CostLedger {
    return this.costLedger;
  }

  /** Expose ContractEnforcer for pre-check operations. */
  getContractEnforcer(): ContractEnforcer {
    return this.contractEnforcer;
  }
}
