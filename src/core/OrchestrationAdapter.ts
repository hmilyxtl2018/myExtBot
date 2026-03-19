import type { McpServiceListManager } from "./McpServiceListManager";
import type { AgentProfile, PipelineParticipation, RoutingConfig } from "./types";

export interface TaskContext {
  query?: string;
  pipelineId?: string;
  requiredIntents?: string[];
  requiredDomains?: string[];
}

export class OrchestrationAdapter {
  constructor(private readonly manager: McpServiceListManager) {}

  /**
   * Resolve the best agent for a task, considering routing config, priority, and concurrency.
   *
   * Scoring algorithm (per agent):
   *  - +3 for each required intent that matches `orchestration.routing.intents` (or `intents`)
   *  - +2 for each required domain that matches `orchestration.routing.domains` (or `domains`)
   *  - +1 for each routing intent that appears as a substring of `context.query`
   *  - The raw score is then multiplied by `orchestration.priority` (default 1.0)
   *
   * The agent with the highest weighted score is returned; undefined if no agent scores > 0.
   */
  resolveAgentForTask(context: TaskContext): AgentProfile | undefined {
    const agents = this.manager.listAgents();

    const scored = agents
      .filter((a) => a.enabled !== false)
      .map((a) => {
        let score = 0;
        const routing: RoutingConfig = a.orchestration?.routing ?? {
          intents: a.intents,
          domains: a.domains,
          languages: a.languages,
          // Cast to the union type since AgentProfile uses the same type
          responseStyle: a.responseStyle as RoutingConfig["responseStyle"],
        };

        // Intent matching (+3 each)
        if (context.requiredIntents) {
          for (const intent of context.requiredIntents) {
            if (routing.intents?.includes(intent)) score += 3;
          }
        }
        // Domain matching (+2 each)
        if (context.requiredDomains) {
          for (const domain of context.requiredDomains) {
            if (routing.domains?.includes(domain)) score += 2;
          }
        }
        // Query matching (+1 each)
        if (context.query) {
          const q = context.query.toLowerCase();
          for (const intent of routing.intents ?? []) {
            if (q.includes(intent.toLowerCase())) score += 1;
          }
        }

        // Priority weight (Pillar 8)
        const priority = a.orchestration?.priority ?? 1.0;
        score *= priority;

        return { agent: a, score };
      });

    const best = scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)[0];

    if (!best) return undefined;
    return this.manager.getAgent(best.agent.id);
  }

  /**
   * Get all pipelines that an agent participates in.
   */
  getAgentPipelines(agentId: string): PipelineParticipation[] {
    const agent = this.manager.getAgent(agentId);
    return agent?.orchestration?.pipelines ?? [];
  }

  /**
   * Get all agents that participate in a given pipeline.
   */
  getAgentsForPipeline(pipelineId: string): Array<{ agentId: string; participation: PipelineParticipation }> {
    return this.manager.listAgents()
      .filter((a) => a.orchestration?.pipelines?.some((p) => p.pipelineId === pipelineId))
      .map((a) => ({
        agentId: a.id,
        participation: a.orchestration!.pipelines!.find((p) => p.pipelineId === pipelineId)!,
      }));
  }

  /**
   * Check whether an agent is within its concurrency limit.
   */
  isWithinConcurrencyLimit(agentId: string, currentTaskCount: number): boolean {
    const agent = this.manager.getAgent(agentId);
    const maxTasks = agent?.orchestration?.maxConcurrentTasks;
    if (maxTasks === undefined) return true;
    return currentTaskCount < maxTasks;
  }
}
