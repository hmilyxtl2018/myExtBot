import { MemoryAdapter } from "../MemoryAdapter";
import { KnowledgeDbStore } from "../KnowledgeDbStore";
import type { McpServiceListManager } from "../McpServiceListManager";
import type { AgentProfile, CostSummary, ServiceHealthRecord } from "../types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMockManager(
  agents: AgentProfile[],
  serviceHealths: ServiceHealthRecord[] = []
): jest.Mocked<Pick<McpServiceListManager, "getAgent" | "getAllServiceHealths">> {
  return {
    getAgent: jest.fn((id: string) => agents.find((a) => a.id === id)),
    getAllServiceHealths: jest.fn(() => serviceHealths),
  } as unknown as jest.Mocked<Pick<McpServiceListManager, "getAgent" | "getAllServiceHealths">>;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("MemoryAdapter", () => {
  // ── extractTrace / K-DB stub ─────────────────────────────────────────────

  describe("extractTrace", () => {
    it("returns null when the agent is unknown (K-DB disabled)", () => {
      const mgr = makeMockManager([]);
      const adapter = new MemoryAdapter(mgr as unknown as McpServiceListManager);
      const result = adapter.extractTrace("ghost", "content", 0.9);
      expect(result).toBeNull();
    });

    it("returns null when knowledgeDb.enabled is false", () => {
      const agent: AgentProfile = {
        id: "bot",
        name: "Bot",
        memory: { knowledgeDb: { enabled: false } },
      };
      const mgr = makeMockManager([agent]);
      const adapter = new MemoryAdapter(mgr as unknown as McpServiceListManager);
      const result = adapter.extractTrace("bot", "some content", 0.95);
      expect(result).toBeNull();
    });

    it("stores an entry when knowledgeDb is enabled (no threshold set)", () => {
      const agent: AgentProfile = {
        id: "bot",
        name: "Bot",
        memory: { knowledgeDb: { enabled: true } },
      };
      const mgr = makeMockManager([agent]);
      const adapter = new MemoryAdapter(mgr as unknown as McpServiceListManager);
      const entry = adapter.extractTrace("bot", "TypeScript tip", 0.7, ["ts"]);
      expect(entry).not.toBeNull();
      expect(entry?.agentId).toBe("bot");
      expect(entry?.content).toBe("TypeScript tip");
      expect(entry?.confidence).toBe(0.7);
      expect(entry?.tags).toEqual(["ts"]);
      expect(entry?.id).toMatch(/^kdb-bot-/);
    });

    it("stores an entry only when confidence meets autoPromoteThreshold", () => {
      const agent: AgentProfile = {
        id: "bot",
        name: "Bot",
        memory: { knowledgeDb: { enabled: true, autoPromoteThreshold: 0.8 } },
      };
      const mgr = makeMockManager([agent]);
      const adapter = new MemoryAdapter(mgr as unknown as McpServiceListManager);

      // Below threshold — should not store
      const below = adapter.extractTrace("bot", "low confidence content", 0.5);
      expect(below).toBeNull();

      // At threshold — should store
      const atThreshold = adapter.extractTrace("bot", "high confidence content", 0.8);
      expect(atThreshold).not.toBeNull();
    });

    it("respects maxEntries by pruning oldest entries", () => {
      const agent: AgentProfile = {
        id: "bot",
        name: "Bot",
        memory: { knowledgeDb: { enabled: true, maxEntries: 2 } },
      };
      const mgr = makeMockManager([agent]);
      const adapter = new MemoryAdapter(mgr as unknown as McpServiceListManager);

      adapter.extractTrace("bot", "entry 1", 0.9);
      adapter.extractTrace("bot", "entry 2", 0.9);
      adapter.extractTrace("bot", "entry 3", 0.9); // should push out entry 1

      const db = adapter.getKnowledgeDb("bot");
      expect(db).toHaveLength(2);
      expect(db[0].content).toBe("entry 2");
      expect(db[1].content).toBe("entry 3");
    });
  });

  // ── lookupSimilar ────────────────────────────────────────────────────────

  describe("lookupSimilar", () => {
    it("returns empty array when no entries exist", () => {
      const mgr = makeMockManager([]);
      const adapter = new MemoryAdapter(mgr as unknown as McpServiceListManager);
      expect(adapter.lookupSimilar("bot", "anything")).toEqual([]);
    });

    it("returns entries whose content matches the query (case-insensitive)", () => {
      const agent: AgentProfile = {
        id: "bot",
        name: "Bot",
        memory: { knowledgeDb: { enabled: true } },
      };
      const mgr = makeMockManager([agent]);
      const adapter = new MemoryAdapter(mgr as unknown as McpServiceListManager);
      adapter.extractTrace("bot", "TypeScript satisfies operator", 0.9);
      adapter.extractTrace("bot", "Python list comprehension", 0.9);

      const hits = adapter.lookupSimilar("bot", "typescript");
      expect(hits).toHaveLength(1);
      expect(hits[0].content).toContain("TypeScript");
    });

    it("limits results to topK", () => {
      const agent: AgentProfile = {
        id: "bot",
        name: "Bot",
        memory: { knowledgeDb: { enabled: true } },
      };
      const mgr = makeMockManager([agent]);
      const adapter = new MemoryAdapter(mgr as unknown as McpServiceListManager);
      for (let i = 0; i < 10; i++) {
        adapter.extractTrace("bot", `TypeScript tip ${i}`, 0.9);
      }

      const hits = adapter.lookupSimilar("bot", "typescript", 3);
      expect(hits).toHaveLength(3);
    });
  });

  // ── getAgentHealth ───────────────────────────────────────────────────────

  describe("getAgentHealth", () => {
    it("returns healthy when there are no service failures", () => {
      const agent: AgentProfile = {
        id: "bot",
        name: "Bot",
        allowedServices: ["ServiceA"],
        memory: { healthMonitoring: { enabled: true } },
      };
      const healthRecords: ServiceHealthRecord[] = [
        {
          serviceName: "ServiceA",
          health: "healthy",
          consecutiveFailures: 0,
          lastCheckedAt: new Date().toISOString(),
          totalCalls: 10,
          totalSuccesses: 10,
          successRate: 1,
        },
      ];
      const mgr = makeMockManager([agent], healthRecords);
      const adapter = new MemoryAdapter(mgr as unknown as McpServiceListManager);
      const summary = adapter.getAgentHealth("bot");
      expect(summary.status).toBe("healthy");
      expect(summary.consecutiveFailures).toBe(0);
    });

    it("returns degraded when failures exceed degradedThreshold", () => {
      const agent: AgentProfile = {
        id: "bot",
        name: "Bot",
        allowedServices: ["ServiceA"],
        memory: { healthMonitoring: { enabled: true, degradedThreshold: 3, downThreshold: 5 } },
      };
      const healthRecords: ServiceHealthRecord[] = [
        {
          serviceName: "ServiceA",
          health: "degraded",
          consecutiveFailures: 4,
          lastCheckedAt: new Date().toISOString(),
          totalCalls: 10,
          totalSuccesses: 6,
          successRate: 0.6,
        },
      ];
      const mgr = makeMockManager([agent], healthRecords);
      const adapter = new MemoryAdapter(mgr as unknown as McpServiceListManager);
      const summary = adapter.getAgentHealth("bot");
      expect(summary.status).toBe("degraded");
    });

    it("returns down when failures meet or exceed downThreshold", () => {
      const agent: AgentProfile = {
        id: "bot",
        name: "Bot",
        allowedServices: ["ServiceA"],
        memory: { healthMonitoring: { enabled: true, degradedThreshold: 3, downThreshold: 5 } },
      };
      const healthRecords: ServiceHealthRecord[] = [
        {
          serviceName: "ServiceA",
          health: "down",
          consecutiveFailures: 5,
          lastCheckedAt: new Date().toISOString(),
          totalCalls: 10,
          totalSuccesses: 5,
          successRate: 0.5,
        },
      ];
      const mgr = makeMockManager([agent], healthRecords);
      const adapter = new MemoryAdapter(mgr as unknown as McpServiceListManager);
      const summary = adapter.getAgentHealth("bot");
      expect(summary.status).toBe("down");
    });

    it("filters serviceHealths to only those in agent.allowedServices", () => {
      const agent: AgentProfile = {
        id: "bot",
        name: "Bot",
        allowedServices: ["ServiceA"],
      };
      const healthRecords: ServiceHealthRecord[] = [
        {
          serviceName: "ServiceA",
          health: "healthy",
          consecutiveFailures: 0,
          lastCheckedAt: new Date().toISOString(),
          totalCalls: 5,
          totalSuccesses: 5,
          successRate: 1,
        },
        {
          serviceName: "ServiceB",
          health: "down",
          consecutiveFailures: 10,
          lastCheckedAt: new Date().toISOString(),
          totalCalls: 5,
          totalSuccesses: 0,
          successRate: 0,
        },
      ];
      const mgr = makeMockManager([agent], healthRecords);
      const adapter = new MemoryAdapter(mgr as unknown as McpServiceListManager);
      const summary = adapter.getAgentHealth("bot");
      // ServiceB is not in allowedServices so failures should not count
      expect(summary.status).toBe("healthy");
    });
  });

  // ── getAgentCostSummary ──────────────────────────────────────────────────

  describe("getAgentCostSummary", () => {
    it("returns zero cost when agent has no recorded cost", () => {
      const agent: AgentProfile = {
        id: "bot",
        name: "Bot",
        memory: { costTracking: { enabled: true, dailyBudget: 10 } },
      };
      const mgr = makeMockManager([agent]);
      const adapter = new MemoryAdapter(mgr as unknown as McpServiceListManager);
      const costSummary: CostSummary = {
        totalCost: 0,
        totalCalls: 0,
        successfulCalls: 0,
        byAgent: {},
        byTool: {},
        byService: {},
        dateRange: { start: "2026-01-01", end: "2026-01-02" },
      };
      const result = adapter.getAgentCostSummary("bot", costSummary);
      expect(result.totalCost).toBe(0);
      expect(result.isOverBudget).toBe(false);
    });

    it("detects over-budget condition", () => {
      const agent: AgentProfile = {
        id: "bot",
        name: "Bot",
        memory: { costTracking: { enabled: true, dailyBudget: 5 } },
      };
      const mgr = makeMockManager([agent]);
      const adapter = new MemoryAdapter(mgr as unknown as McpServiceListManager);
      const costSummary: CostSummary = {
        totalCost: 7,
        totalCalls: 5,
        successfulCalls: 5,
        byAgent: { bot: { cost: 7, calls: 5 } },
        byTool: {},
        byService: {},
        dateRange: { start: "2026-01-01", end: "2026-01-02" },
      };
      const result = adapter.getAgentCostSummary("bot", costSummary);
      expect(result.isOverBudget).toBe(true);
      expect(result.totalCost).toBe(7);
    });

    it("detects near-alert condition when budget fraction meets alertThreshold", () => {
      const agent: AgentProfile = {
        id: "bot",
        name: "Bot",
        memory: { costTracking: { enabled: true, dailyBudget: 10, alertThreshold: 0.8 } },
      };
      const mgr = makeMockManager([agent]);
      const adapter = new MemoryAdapter(mgr as unknown as McpServiceListManager);
      const costSummary: CostSummary = {
        totalCost: 8,
        totalCalls: 5,
        successfulCalls: 5,
        byAgent: { bot: { cost: 8, calls: 5 } },
        byTool: {},
        byService: {},
        dateRange: { start: "2026-01-01", end: "2026-01-02" },
      };
      const result = adapter.getAgentCostSummary("bot", costSummary);
      expect(result.isNearAlert).toBe(true);
      expect(result.isOverBudget).toBe(false);
    });
  });

  // ── KnowledgeDbStore integration ──────────────────────────────────────────

  describe("MemoryAdapter with KnowledgeDbStore (SQLite)", () => {
    let store: KnowledgeDbStore;
    const agent: AgentProfile = {
      id: "bot",
      name: "Bot",
      memory: { knowledgeDb: { enabled: true } },
    };

    beforeEach(() => {
      store = new KnowledgeDbStore();
      store.init(":memory:");
    });

    afterEach(() => {
      store.close();
    });

    it("uses SQLite when KnowledgeDbStore is provided", () => {
      const mgr = makeMockManager([agent]);
      const adapter = new MemoryAdapter(mgr as unknown as McpServiceListManager, store);

      const entry = adapter.extractTrace("bot", "SQLite-backed content", 0.9, ["sql"]);
      expect(entry).not.toBeNull();

      const results = adapter.lookupSimilar("bot", "SQLite", 5);
      expect(results).toHaveLength(1);
      expect(results[0].content).toBe("SQLite-backed content");
      expect(results[0].tags).toEqual(["sql"]);
    });

    it("lookupSimilar returns matching entries from SQLite", () => {
      const mgr = makeMockManager([agent]);
      const adapter = new MemoryAdapter(mgr as unknown as McpServiceListManager, store);

      adapter.extractTrace("bot", "TypeScript satisfies operator", 0.9);
      adapter.extractTrace("bot", "Python list comprehension", 0.9);

      const hits = adapter.lookupSimilar("bot", "typescript", 5);
      expect(hits).toHaveLength(1);
      expect(hits[0].content).toContain("TypeScript");
    });

    it("respects topK when querying from SQLite", () => {
      const mgr = makeMockManager([agent]);
      const adapter = new MemoryAdapter(mgr as unknown as McpServiceListManager, store);

      for (let i = 0; i < 8; i++) {
        adapter.extractTrace("bot", `TypeScript tip ${i}`, 0.9);
      }
      const results = adapter.lookupSimilar("bot", "TypeScript", 3);
      expect(results).toHaveLength(3);
    });

    it("prunes entries via SQLite when maxEntries is configured", () => {
      const agentWithMax: AgentProfile = {
        id: "bot",
        name: "Bot",
        memory: { knowledgeDb: { enabled: true, maxEntries: 2 } },
      };
      const mgr = makeMockManager([agentWithMax]);
      const adapter = new MemoryAdapter(mgr as unknown as McpServiceListManager, store);

      adapter.extractTrace("bot", "entry 1", 0.9);
      adapter.extractTrace("bot", "entry 2", 0.9);
      adapter.extractTrace("bot", "entry 3", 0.9);

      const db = adapter.getKnowledgeDb("bot");
      expect(db).toHaveLength(2);
    });

    it("returns null when knowledgeDb is disabled (SQLite path)", () => {
      const disabledAgent: AgentProfile = {
        id: "bot",
        name: "Bot",
        memory: { knowledgeDb: { enabled: false } },
      };
      const mgr = makeMockManager([disabledAgent]);
      const adapter = new MemoryAdapter(mgr as unknown as McpServiceListManager, store);
      expect(adapter.extractTrace("bot", "content", 0.9)).toBeNull();
    });
  });

  describe("MemoryAdapter without KnowledgeDbStore (in-memory Map)", () => {
    it("falls back to the in-memory Map when no store is provided", () => {
      const agent: AgentProfile = {
        id: "bot",
        name: "Bot",
        memory: { knowledgeDb: { enabled: true } },
      };
      const mgr = makeMockManager([agent]);
      const adapter = new MemoryAdapter(mgr as unknown as McpServiceListManager);

      adapter.extractTrace("bot", "in-memory content", 0.9);
      const results = adapter.lookupSimilar("bot", "memory", 5);
      expect(results).toHaveLength(1);
      expect(results[0].content).toBe("in-memory content");
    });
  });
});
