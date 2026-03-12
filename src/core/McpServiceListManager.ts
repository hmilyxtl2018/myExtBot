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
  }
}
