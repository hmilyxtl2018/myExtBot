import { OrchestrationAdapter } from "../OrchestrationAdapter";
import type { McpServiceListManager } from "../McpServiceListManager";
import type { AgentProfile, AgentSummary } from "../types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSummary(profile: AgentProfile): AgentSummary {
  return {
    id: profile.id,
    name: profile.name,
    toolCount: 0,
    enabled: profile.enabled,
    intents: profile.intents,
    domains: profile.domains,
    orchestration: profile.orchestration,
    communication: profile.communication,
    memory: profile.memory,
    canDelegateTo: profile.canDelegateTo,
  };
}

function makeMockManager(agents: AgentProfile[]): jest.Mocked<Pick<McpServiceListManager, "listAgents" | "getAgent">> {
  return {
    listAgents: jest.fn(() => agents.map(makeSummary)),
    getAgent: jest.fn((id: string) => agents.find((a) => a.id === id)),
  } as unknown as jest.Mocked<Pick<McpServiceListManager, "listAgents" | "getAgent">>;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("OrchestrationAdapter", () => {
  describe("resolveAgentForTask", () => {
    it("returns undefined when no agents match the context", () => {
      const agent: AgentProfile = {
        id: "code-bot",
        name: "Code Bot",
        orchestration: { routing: { intents: ["coding"], domains: ["software"] } },
      };
      const mgr = makeMockManager([agent]);
      const adapter = new OrchestrationAdapter(mgr as unknown as McpServiceListManager);
      const result = adapter.resolveAgentForTask({ requiredIntents: ["cooking"] });
      expect(result).toBeUndefined();
    });

    it("routes to an agent with a matching required intent", () => {
      const agent: AgentProfile = {
        id: "research-bot",
        name: "Research Bot",
        orchestration: { routing: { intents: ["research", "search"], domains: ["science"] } },
      };
      const mgr = makeMockManager([agent]);
      const adapter = new OrchestrationAdapter(mgr as unknown as McpServiceListManager);
      const result = adapter.resolveAgentForTask({ requiredIntents: ["research"] });
      expect(result?.id).toBe("research-bot");
    });

    it("routes to an agent with a matching required domain", () => {
      const agent: AgentProfile = {
        id: "finance-bot",
        name: "Finance Bot",
        orchestration: { routing: { domains: ["finance", "economy"] } },
      };
      const mgr = makeMockManager([agent]);
      const adapter = new OrchestrationAdapter(mgr as unknown as McpServiceListManager);
      const result = adapter.resolveAgentForTask({ requiredDomains: ["finance"] });
      expect(result?.id).toBe("finance-bot");
    });

    it("selects the highest-scoring agent when multiple agents match", () => {
      const agentA: AgentProfile = {
        id: "a",
        name: "Agent A",
        orchestration: { routing: { intents: ["search"], domains: ["science"] }, priority: 1.0 },
      };
      const agentB: AgentProfile = {
        id: "b",
        name: "Agent B",
        // Both intent and domain match => higher raw score, and priority 2x
        orchestration: {
          routing: { intents: ["search"], domains: ["science"] },
          priority: 2.0,
        },
      };
      const mgr = makeMockManager([agentA, agentB]);
      const adapter = new OrchestrationAdapter(mgr as unknown as McpServiceListManager);
      const result = adapter.resolveAgentForTask({
        requiredIntents: ["search"],
        requiredDomains: ["science"],
      });
      expect(result?.id).toBe("b");
    });

    it("scores +1 when an agent intent appears in the query string", () => {
      const agent: AgentProfile = {
        id: "cooking-bot",
        name: "Cooking Bot",
        orchestration: { routing: { intents: ["recipe"] } },
      };
      const mgr = makeMockManager([agent]);
      const adapter = new OrchestrationAdapter(mgr as unknown as McpServiceListManager);
      const result = adapter.resolveAgentForTask({ query: "give me a recipe for pasta" });
      expect(result?.id).toBe("cooking-bot");
    });

    it("skips disabled agents", () => {
      const agent: AgentProfile = {
        id: "off-bot",
        name: "Off Bot",
        enabled: false,
        orchestration: { routing: { intents: ["search"] } },
      };
      const mgr = makeMockManager([agent]);
      const adapter = new OrchestrationAdapter(mgr as unknown as McpServiceListManager);
      const result = adapter.resolveAgentForTask({ requiredIntents: ["search"] });
      expect(result).toBeUndefined();
    });

    it("falls back to legacy top-level intents when orchestration.routing is absent", () => {
      const agent: AgentProfile = {
        id: "legacy-bot",
        name: "Legacy Bot",
        intents: ["translate"],
        domains: ["languages"],
      };
      const mgr = makeMockManager([agent]);
      const adapter = new OrchestrationAdapter(mgr as unknown as McpServiceListManager);
      const result = adapter.resolveAgentForTask({ requiredIntents: ["translate"] });
      expect(result?.id).toBe("legacy-bot");
    });
  });

  describe("getAgentPipelines", () => {
    it("returns empty array when agent has no pipelines", () => {
      const agent: AgentProfile = { id: "solo", name: "Solo" };
      const mgr = makeMockManager([agent]);
      const adapter = new OrchestrationAdapter(mgr as unknown as McpServiceListManager);
      expect(adapter.getAgentPipelines("solo")).toEqual([]);
    });

    it("returns the pipeline participations for a registered agent", () => {
      const agent: AgentProfile = {
        id: "pipe-bot",
        name: "Pipe Bot",
        orchestration: {
          pipelines: [{ pipelineId: "p1", stepIndexes: [0, 1], role: "executor" }],
        },
      };
      const mgr = makeMockManager([agent]);
      const adapter = new OrchestrationAdapter(mgr as unknown as McpServiceListManager);
      const pipes = adapter.getAgentPipelines("pipe-bot");
      expect(pipes).toHaveLength(1);
      expect(pipes[0].pipelineId).toBe("p1");
    });
  });

  describe("isWithinConcurrencyLimit", () => {
    it("returns true when no maxConcurrentTasks is configured", () => {
      const agent: AgentProfile = { id: "free", name: "Free" };
      const mgr = makeMockManager([agent]);
      const adapter = new OrchestrationAdapter(mgr as unknown as McpServiceListManager);
      expect(adapter.isWithinConcurrencyLimit("free", 999)).toBe(true);
    });

    it("returns true when current tasks are below the limit", () => {
      const agent: AgentProfile = {
        id: "limited",
        name: "Limited",
        orchestration: { maxConcurrentTasks: 5 },
      };
      const mgr = makeMockManager([agent]);
      const adapter = new OrchestrationAdapter(mgr as unknown as McpServiceListManager);
      expect(adapter.isWithinConcurrencyLimit("limited", 4)).toBe(true);
    });

    it("returns false when current tasks meet or exceed the limit", () => {
      const agent: AgentProfile = {
        id: "limited",
        name: "Limited",
        orchestration: { maxConcurrentTasks: 3 },
      };
      const mgr = makeMockManager([agent]);
      const adapter = new OrchestrationAdapter(mgr as unknown as McpServiceListManager);
      expect(adapter.isWithinConcurrencyLimit("limited", 3)).toBe(false);
      expect(adapter.isWithinConcurrencyLimit("limited", 10)).toBe(false);
    });
  });

  describe("getAgentsForPipeline", () => {
    it("returns agents that participate in a given pipeline", () => {
      const agentA: AgentProfile = {
        id: "a",
        name: "A",
        orchestration: { pipelines: [{ pipelineId: "p1", stepIndexes: [0], role: "coordinator" }] },
      };
      const agentB: AgentProfile = {
        id: "b",
        name: "B",
        orchestration: { pipelines: [{ pipelineId: "p2", stepIndexes: [0], role: "executor" }] },
      };
      const mgr = makeMockManager([agentA, agentB]);
      const adapter = new OrchestrationAdapter(mgr as unknown as McpServiceListManager);
      const participants = adapter.getAgentsForPipeline("p1");
      expect(participants).toHaveLength(1);
      expect(participants[0].agentId).toBe("a");
    });
  });
});
