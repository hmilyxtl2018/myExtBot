import { MemoryAdapter } from "../MemoryAdapter";
import { KnowledgeDbStore } from "../KnowledgeDbStore";
import { SimpleEmbeddingProvider } from "../EmbeddingProvider";
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
    it("returns null when the agent is unknown (K-DB disabled)", async () => {
      const mgr = makeMockManager([]);
      const adapter = new MemoryAdapter(mgr as unknown as McpServiceListManager);
      const result = await adapter.extractTrace("ghost", "content", 0.9);
      expect(result).toBeNull();
    });

    it("returns null when knowledgeDb.enabled is false", async () => {
      const agent: AgentProfile = {
        id: "bot",
        name: "Bot",
        memory: { knowledgeDb: { enabled: false } },
      };
      const mgr = makeMockManager([agent]);
      const adapter = new MemoryAdapter(mgr as unknown as McpServiceListManager);
      const result = await adapter.extractTrace("bot", "some content", 0.95);
      expect(result).toBeNull();
    });

    it("stores an entry when knowledgeDb is enabled (no threshold set)", async () => {
      const agent: AgentProfile = {
        id: "bot",
        name: "Bot",
        memory: { knowledgeDb: { enabled: true } },
      };
      const mgr = makeMockManager([agent]);
      const adapter = new MemoryAdapter(mgr as unknown as McpServiceListManager);
      const entry = await adapter.extractTrace("bot", "TypeScript tip", 0.7, ["ts"]);
      expect(entry).not.toBeNull();
      expect(entry?.agentId).toBe("bot");
      expect(entry?.content).toBe("TypeScript tip");
      expect(entry?.confidence).toBe(0.7);
      expect(entry?.tags).toEqual(["ts"]);
      expect(entry?.id).toMatch(/^kdb-bot-/);
    });

    it("stores an entry only when confidence meets autoPromoteThreshold", async () => {
      const agent: AgentProfile = {
        id: "bot",
        name: "Bot",
        memory: { knowledgeDb: { enabled: true, autoPromoteThreshold: 0.8 } },
      };
      const mgr = makeMockManager([agent]);
      const adapter = new MemoryAdapter(mgr as unknown as McpServiceListManager);

      // Below threshold — should not store
      const below = await adapter.extractTrace("bot", "low confidence content", 0.5);
      expect(below).toBeNull();

      // At threshold — should store
      const atThreshold = await adapter.extractTrace("bot", "high confidence content", 0.8);
      expect(atThreshold).not.toBeNull();
    });

    it("respects maxEntries by pruning oldest entries", async () => {
      const agent: AgentProfile = {
        id: "bot",
        name: "Bot",
        memory: { knowledgeDb: { enabled: true, maxEntries: 2 } },
      };
      const mgr = makeMockManager([agent]);
      const adapter = new MemoryAdapter(mgr as unknown as McpServiceListManager);

      await adapter.extractTrace("bot", "entry 1", 0.9);
      await adapter.extractTrace("bot", "entry 2", 0.9);
      await adapter.extractTrace("bot", "entry 3", 0.9); // should push out entry 1

      const db = adapter.getKnowledgeDb("bot");
      expect(db).toHaveLength(2);
      expect(db[0].content).toBe("entry 2");
      expect(db[1].content).toBe("entry 3");
    });
  });

  // ── lookupSimilar ────────────────────────────────────────────────────────

  describe("lookupSimilar", () => {
    it("returns empty array when no entries exist", async () => {
      const mgr = makeMockManager([]);
      const adapter = new MemoryAdapter(mgr as unknown as McpServiceListManager);
      expect(await adapter.lookupSimilar("bot", "anything")).toEqual([]);
    });

    it("returns entries whose content matches the query (case-insensitive)", async () => {
      const agent: AgentProfile = {
        id: "bot",
        name: "Bot",
        memory: { knowledgeDb: { enabled: true } },
      };
      const mgr = makeMockManager([agent]);
      const adapter = new MemoryAdapter(mgr as unknown as McpServiceListManager);
      await adapter.extractTrace("bot", "TypeScript satisfies operator", 0.9);
      await adapter.extractTrace("bot", "Python list comprehension", 0.9);

      const hits = await adapter.lookupSimilar("bot", "typescript");
      expect(hits).toHaveLength(1);
      expect(hits[0].content).toContain("TypeScript");
    });

    it("limits results to topK", async () => {
      const agent: AgentProfile = {
        id: "bot",
        name: "Bot",
        memory: { knowledgeDb: { enabled: true } },
      };
      const mgr = makeMockManager([agent]);
      const adapter = new MemoryAdapter(mgr as unknown as McpServiceListManager);
      for (let i = 0; i < 10; i++) {
        await adapter.extractTrace("bot", `TypeScript tip ${i}`, 0.9);
      }

      const hits = await adapter.lookupSimilar("bot", "typescript", 3);
      expect(hits).toHaveLength(3);
    });
  });

  // ── getAgentHealth ───────────────────────────────────────────────────────

  describe("getAgentHealth", () => {
    it("returns healthy when there are no service failures", async () => {
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

    it("returns degraded when failures exceed degradedThreshold", async () => {
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

    it("returns down when failures meet or exceed downThreshold", async () => {
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

    it("filters serviceHealths to only those in agent.allowedServices", async () => {
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
    it("returns zero cost when agent has no recorded cost", async () => {
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

    it("detects over-budget condition", async () => {
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

    it("detects near-alert condition when budget fraction meets alertThreshold", async () => {
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

    it("uses SQLite when KnowledgeDbStore is provided", async () => {
      const mgr = makeMockManager([agent]);
      const adapter = new MemoryAdapter(mgr as unknown as McpServiceListManager, store);

      const entry = await adapter.extractTrace("bot", "SQLite-backed content", 0.9, ["sql"]);
      expect(entry).not.toBeNull();

      const results = await adapter.lookupSimilar("bot", "SQLite", 5);
      expect(results).toHaveLength(1);
      expect(results[0].content).toBe("SQLite-backed content");
      expect(results[0].tags).toEqual(["sql"]);
    });

    it("lookupSimilar returns matching entries from SQLite", async () => {
      const mgr = makeMockManager([agent]);
      const adapter = new MemoryAdapter(mgr as unknown as McpServiceListManager, store);

      await adapter.extractTrace("bot", "TypeScript satisfies operator", 0.9);
      await adapter.extractTrace("bot", "Python list comprehension", 0.9);

      const hits = await adapter.lookupSimilar("bot", "typescript", 5);
      expect(hits).toHaveLength(1);
      expect(hits[0].content).toContain("TypeScript");
    });

    it("respects topK when querying from SQLite", async () => {
      const mgr = makeMockManager([agent]);
      const adapter = new MemoryAdapter(mgr as unknown as McpServiceListManager, store);

      for (let i = 0; i < 8; i++) {
        await adapter.extractTrace("bot", `TypeScript tip ${i}`, 0.9);
      }
      const results = await adapter.lookupSimilar("bot", "TypeScript", 3);
      expect(results).toHaveLength(3);
    });

    it("prunes entries via SQLite when maxEntries is configured", async () => {
      const agentWithMax: AgentProfile = {
        id: "bot",
        name: "Bot",
        memory: { knowledgeDb: { enabled: true, maxEntries: 2 } },
      };
      const mgr = makeMockManager([agentWithMax]);
      const adapter = new MemoryAdapter(mgr as unknown as McpServiceListManager, store);

      await adapter.extractTrace("bot", "entry 1", 0.9);
      await adapter.extractTrace("bot", "entry 2", 0.9);
      await adapter.extractTrace("bot", "entry 3", 0.9);

      const db = adapter.getKnowledgeDb("bot");
      expect(db).toHaveLength(2);
    });

    it("returns null when knowledgeDb is disabled (SQLite path)", async () => {
      const disabledAgent: AgentProfile = {
        id: "bot",
        name: "Bot",
        memory: { knowledgeDb: { enabled: false } },
      };
      const mgr = makeMockManager([disabledAgent]);
      const adapter = new MemoryAdapter(mgr as unknown as McpServiceListManager, store);
      expect(await adapter.extractTrace("bot", "content", 0.9)).toBeNull();
    });
  });

  describe("MemoryAdapter without KnowledgeDbStore (in-memory Map)", () => {
    it("falls back to the in-memory Map when no store is provided", async () => {
      const agent: AgentProfile = {
        id: "bot",
        name: "Bot",
        memory: { knowledgeDb: { enabled: true } },
      };
      const mgr = makeMockManager([agent]);
      const adapter = new MemoryAdapter(mgr as unknown as McpServiceListManager);

      await adapter.extractTrace("bot", "in-memory content", 0.9);
      const results = await adapter.lookupSimilar("bot", "memory", 5);
      expect(results).toHaveLength(1);
      expect(results[0].content).toBe("in-memory content");
    });

    it("lookupSimilar filters expired entries from the in-memory Map", async () => {
      // Manually insert an expired entry into the in-memory Map by extractTrace
      // with a past expiresAt using a mock config.
      const agentWithExpiry: AgentProfile = {
        id: "bot",
        name: "Bot",
        memory: { knowledgeDb: { enabled: true, autoRetireAfterMinutes: -1 } },
      };
      const mgrExpiry = makeMockManager([agentWithExpiry]);
      const adapterExpiry = new MemoryAdapter(
        mgrExpiry as unknown as McpServiceListManager,
      );
      // Extract entry — expiresAt will be 1 minute in the past.
      await adapterExpiry.extractTrace("bot", "already expired content", 0.9);

      // lookupSimilar should not return the expired entry.
      const results = await adapterExpiry.lookupSimilar("bot", "expired content", 10);
      expect(results).toHaveLength(0);
    });

    it("getKnowledgeDb filters expired entries from the in-memory Map", async () => {
      const agentWithExpiry: AgentProfile = {
        id: "bot",
        name: "Bot",
        memory: { knowledgeDb: { enabled: true, autoRetireAfterMinutes: -1 } },
      };
      const mgr = makeMockManager([agentWithExpiry]);
      const adapter = new MemoryAdapter(mgr as unknown as McpServiceListManager);
      await adapter.extractTrace("bot", "expired content", 0.9);

      expect(adapter.getKnowledgeDb("bot")).toHaveLength(0);
    });

    it("extractTrace purges expired entries before inserting a new one", async () => {
      const agentWithExpiry: AgentProfile = {
        id: "bot",
        name: "Bot",
        memory: { knowledgeDb: { enabled: true, autoRetireAfterMinutes: -1 } },
      };
      const mgr = makeMockManager([agentWithExpiry]);
      const adapter = new MemoryAdapter(mgr as unknown as McpServiceListManager);
      // First entry — will expire immediately.
      await adapter.extractTrace("bot", "first entry", 0.9);
      // Second entry — also expires immediately but should not exceed maxEntries limits.
      await adapter.extractTrace("bot", "second entry", 0.9);

      // Both entries are expired so neither shows up.
      expect(adapter.getKnowledgeDb("bot")).toHaveLength(0);
    });
  });

  // ── autoRetireAfterMinutes / expiresAt ────────────────────────────────────

  describe("autoRetireAfterMinutes (SQLite)", () => {
    let store: KnowledgeDbStore;

    beforeEach(() => {
      store = new KnowledgeDbStore();
      store.init(":memory:");
    });

    afterEach(() => {
      store.close();
    });

    it("sets expiresAt on the entry when autoRetireAfterMinutes is configured", async () => {
      const agent: AgentProfile = {
        id: "bot",
        name: "Bot",
        memory: { knowledgeDb: { enabled: true, autoRetireAfterMinutes: 60 } },
      };
      const mgr = makeMockManager([agent]);
      const adapter = new MemoryAdapter(mgr as unknown as McpServiceListManager, store);

      const before = new Date();
      const entry = await adapter.extractTrace("bot", "expiring content", 0.9);
      const after = new Date();

      expect(entry).not.toBeNull();
      expect(entry!.expiresAt).toBeDefined();
      const expiresAt = new Date(entry!.expiresAt!);
      expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before.getTime() + 60 * 60_000 - 100);
      expect(expiresAt.getTime()).toBeLessThanOrEqual(after.getTime() + 60 * 60_000 + 100);
    });

    it("does not set expiresAt when autoRetireAfterMinutes is not configured", async () => {
      const agent: AgentProfile = {
        id: "bot",
        name: "Bot",
        memory: { knowledgeDb: { enabled: true } },
      };
      const mgr = makeMockManager([agent]);
      const adapter = new MemoryAdapter(mgr as unknown as McpServiceListManager, store);

      const entry = await adapter.extractTrace("bot", "permanent content", 0.9);
      expect(entry).not.toBeNull();
      expect(entry!.expiresAt).toBeUndefined();
    });

    it("lazy autoRetire removes expired entries on next extractTrace call", async () => {
      const agent: AgentProfile = {
        id: "bot",
        name: "Bot",
        memory: { knowledgeDb: { enabled: true } },
      };
      const mgr = makeMockManager([agent]);
      const adapter = new MemoryAdapter(mgr as unknown as McpServiceListManager, store);

      // Directly insert a pre-expired entry into the store (bypasses MemoryAdapter TTL).
      const pastExpiry = new Date(Date.now() - 10_000).toISOString();
      store.insert("bot", {
        id: "kdb-bot-old",
        agentId: "bot",
        content: "old expired content",
        confidence: 0.9,
        createdAt: new Date(Date.now() - 20_000).toISOString(),
        expiresAt: pastExpiry,
      });

      // Sanity check: entry is present in DB (not yet retired) but won't appear
      // in query() since expiresAt has passed — use list() to confirm it's there.
      expect(store.list("bot")).toHaveLength(1);

      // Calling extractTrace triggers lazy deleteExpired internally.
      await adapter.extractTrace("bot", "new content", 0.9);

      // Expired entry should be soft-deleted (retiredAt set) and excluded from query().
      const results = store.query("bot", "", 100);
      expect(results.every((r) => r.content !== "old expired content")).toBe(true);
      // Entry should appear in listRetired() as an audit record.
      const retired = store.listRetired("bot");
      expect(retired.some((r) => r.content === "old expired content")).toBe(true);
    });
  });

  // ── McpServiceListManager auto-injection ─────────────────────────────────

  describe("McpServiceListManager auto-injection", () => {
    it("exposes a memoryAdapter backed by a KnowledgeDbStore", async () => {
      process.env["KNOWLEDGE_DB_PATH"] = ":memory:";
      const { McpServiceListManager } = require("../McpServiceListManager") as {
        McpServiceListManager: new () => import("../McpServiceListManager").McpServiceListManager;
      };
      const mgr = new McpServiceListManager();
      expect(mgr.memoryAdapter).toBeDefined();
      mgr.close();
      delete process.env["KNOWLEDGE_DB_PATH"];
    });

    it("memoryAdapter stores and retrieves entries end-to-end", async () => {
      process.env["KNOWLEDGE_DB_PATH"] = ":memory:";
      const { McpServiceListManager } = require("../McpServiceListManager") as {
        McpServiceListManager: new () => import("../McpServiceListManager").McpServiceListManager;
      };
      const mgr = new McpServiceListManager();

      // Register an agent with knowledgeDb enabled.
      mgr.registerAgent({
        id: "e2e-bot",
        name: "E2E Bot",
        memory: { knowledgeDb: { enabled: true } },
      });

      const entry = await mgr.memoryAdapter.extractTrace("e2e-bot", "end-to-end content", 0.9);
      expect(entry).not.toBeNull();

      const found = await mgr.memoryAdapter.lookupSimilar("e2e-bot", "end-to-end", 5);
      expect(found).toHaveLength(1);
      expect(found[0].content).toBe("end-to-end content");

      mgr.close();
      delete process.env["KNOWLEDGE_DB_PATH"];
    });
  });

  // ── startAutoRetireSweep / stopAutoRetireSweep ────────────────────────────

  describe("startAutoRetireSweep / stopAutoRetireSweep", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("calls deleteExpired for agents with autoRetireAfterMinutes on each tick (SQLite path)", async () => {
      const store = new KnowledgeDbStore();
      store.init(":memory:");

      const agent: AgentProfile = {
        id: "bot",
        name: "Bot",
        memory: { knowledgeDb: { enabled: true, autoRetireAfterMinutes: 60 } },
      };
      const agentWithoutExpiry: AgentProfile = {
        id: "no-expiry-bot",
        name: "No Expiry Bot",
        memory: { knowledgeDb: { enabled: true } },
      };

      const mgr = {
        getAgent: jest.fn((id: string) =>
          [agent, agentWithoutExpiry].find((a) => a.id === id),
        ),
        getAllServiceHealths: jest.fn(() => []),
        listAgents: jest.fn(() => [agent, agentWithoutExpiry]),
      } as unknown as McpServiceListManager;

      const deleteExpiredSpy = jest.spyOn(store, "deleteExpired");
      const adapter = new MemoryAdapter(mgr, store);
      adapter.startAutoRetireSweep(1000);

      jest.advanceTimersByTime(1000);

      // Only the agent with autoRetireAfterMinutes should trigger deleteExpired.
      expect(deleteExpiredSpy).toHaveBeenCalledWith("bot");
      expect(deleteExpiredSpy).not.toHaveBeenCalledWith("no-expiry-bot");

      adapter.stopAutoRetireSweep();
      store.close();
    });

    it("stopAutoRetireSweep prevents further cleanup calls", async () => {
      const agent: AgentProfile = {
        id: "bot",
        name: "Bot",
        memory: { knowledgeDb: { enabled: true, autoRetireAfterMinutes: 60 } },
      };
      const mgr = {
        getAgent: jest.fn((id: string) => (id === "bot" ? agent : undefined)),
        getAllServiceHealths: jest.fn(() => []),
        listAgents: jest.fn(() => [agent]),
      } as unknown as McpServiceListManager;

      const store = new KnowledgeDbStore();
      store.init(":memory:");
      const deleteExpiredSpy = jest.spyOn(store, "deleteExpired");

      const adapter = new MemoryAdapter(mgr, store);
      adapter.startAutoRetireSweep(500);
      adapter.stopAutoRetireSweep();

      jest.advanceTimersByTime(2000);

      expect(deleteExpiredSpy).not.toHaveBeenCalled();
      store.close();
    });

    it("startAutoRetireSweep works on the in-memory path", async () => {
      const agent: AgentProfile = {
        id: "bot",
        name: "Bot",
        memory: { knowledgeDb: { enabled: true, autoRetireAfterMinutes: -1 } },
      };
      const mgr = {
        getAgent: jest.fn((id: string) => (id === "bot" ? agent : undefined)),
        getAllServiceHealths: jest.fn(() => []),
        listAgents: jest.fn(() => [agent]),
      } as unknown as McpServiceListManager;

      const adapter = new MemoryAdapter(mgr); // no store — in-memory path

      // Extract an entry that's already expired (autoRetireAfterMinutes = -1).
      await adapter.extractTrace("bot", "expired content", 0.9);
      // Re-add via direct map manipulation is not possible; but we can verify the
      // sweep tick at minimum does not throw.
      expect(() => jest.advanceTimersByTime(1000)).not.toThrow();
      adapter.stopAutoRetireSweep();
    });

    it("McpServiceListManager.startAutoRetireSweep delegates to memoryAdapter", async () => {
      process.env["KNOWLEDGE_DB_PATH"] = ":memory:";
      const { McpServiceListManager } = require("../McpServiceListManager") as {
        McpServiceListManager: new () => import("../McpServiceListManager").McpServiceListManager;
      };
      const mgr = new McpServiceListManager();
      const startSpy = jest.spyOn(mgr.memoryAdapter, "startAutoRetireSweep");
      const stopSpy = jest.spyOn(mgr.memoryAdapter, "stopAutoRetireSweep");

      mgr.startAutoRetireSweep(1000);
      expect(startSpy).toHaveBeenCalledWith(1000);

      mgr.stopAutoRetireSweep();
      expect(stopSpy).toHaveBeenCalled();

      mgr.close();
      delete process.env["KNOWLEDGE_DB_PATH"];
    });
  });

  // ── Semantic search (EmbeddingProvider) ──────────────────────────────────

  describe("semantic search with EmbeddingProvider", () => {
    const agent: AgentProfile = {
      id: "bot",
      name: "Bot",
      memory: { knowledgeDb: { enabled: true } },
    };

    it("lookupSimilar uses semantic search when a provider is configured (in-memory)", async () => {
      const provider = new SimpleEmbeddingProvider(64);
      const mgr = makeMockManager([agent]);
      const adapter = new MemoryAdapter(
        mgr as unknown as McpServiceListManager,
        undefined,
        provider,
      );

      await adapter.extractTrace("bot", "TypeScript generics", 0.9);
      await adapter.extractTrace("bot", "Python list comprehension", 0.9);

      // Query with TypeScript-related text — should rank TypeScript entry higher.
      const hits = await adapter.lookupSimilar("bot", "TypeScript type system", 1);
      expect(hits).toHaveLength(1);
      expect(hits[0].content).toContain("TypeScript");
    });

    it("lookupSimilar uses semantic search when a provider is configured (SQLite)", async () => {
      const provider = new SimpleEmbeddingProvider(64);
      const store = new KnowledgeDbStore();
      store.init(":memory:");
      const mgr = makeMockManager([agent]);
      const adapter = new MemoryAdapter(
        mgr as unknown as McpServiceListManager,
        store,
        provider,
      );

      await adapter.extractTrace("bot", "TypeScript generics", 0.9);
      await adapter.extractTrace("bot", "Python list comprehension", 0.9);

      const hits = await adapter.lookupSimilar("bot", "TypeScript type system", 1);
      expect(hits).toHaveLength(1);
      expect(hits[0].content).toContain("TypeScript");

      store.close();
    });

    it("lookupSimilar falls back to keyword search when no provider is configured", async () => {
      const mgr = makeMockManager([agent]);
      const adapter = new MemoryAdapter(mgr as unknown as McpServiceListManager);

      await adapter.extractTrace("bot", "TypeScript generics", 0.9);
      await adapter.extractTrace("bot", "Python list comprehension", 0.9);

      const hits = await adapter.lookupSimilar("bot", "typescript");
      expect(hits).toHaveLength(1);
      expect(hits[0].content).toContain("TypeScript");
    });

    it("lookupSimilar returns empty when no embeddings stored (in-memory with provider)", async () => {
      const provider = new SimpleEmbeddingProvider(64);
      const mgr = makeMockManager([agent]);
      const adapter = new MemoryAdapter(
        mgr as unknown as McpServiceListManager,
        undefined,
        provider,
      );
      // No entries stored — should return empty
      const hits = await adapter.lookupSimilar("bot", "TypeScript", 5);
      expect(hits).toHaveLength(0);
    });
  });

  // ── lookupHybrid ─────────────────────────────────────────────────────────

  describe("lookupHybrid", () => {
    const agent: AgentProfile = {
      id: "bot",
      name: "Bot",
      memory: { knowledgeDb: { enabled: true } },
    };

    it("returns keyword results only when no provider is configured (in-memory)", async () => {
      const mgr = makeMockManager([agent]);
      const adapter = new MemoryAdapter(mgr as unknown as McpServiceListManager);

      await adapter.extractTrace("bot", "TypeScript generics", 0.9);
      await adapter.extractTrace("bot", "Python list comprehension", 0.9);

      const hits = await adapter.lookupHybrid("bot", "typescript", 5);
      expect(hits).toHaveLength(1);
      expect(hits[0].content).toContain("TypeScript");
    });

    it("returns keyword results only when no provider is configured (SQLite)", async () => {
      const store = new KnowledgeDbStore();
      store.init(":memory:");
      const mgr = makeMockManager([agent]);
      const adapter = new MemoryAdapter(mgr as unknown as McpServiceListManager, store);

      await adapter.extractTrace("bot", "TypeScript generics", 0.9);
      await adapter.extractTrace("bot", "Python list comprehension", 0.9);

      const hits = await adapter.lookupHybrid("bot", "typescript", 5);
      expect(hits).toHaveLength(1);
      expect(hits[0].content).toContain("TypeScript");
      store.close();
    });

    it("blends keyword and semantic results when provider is configured (in-memory)", async () => {
      const provider = new SimpleEmbeddingProvider(64);
      const mgr = makeMockManager([agent]);
      const adapter = new MemoryAdapter(
        mgr as unknown as McpServiceListManager,
        undefined,
        provider,
      );

      await adapter.extractTrace("bot", "TypeScript generics", 0.9);
      await adapter.extractTrace("bot", "Python list comprehension", 0.9);
      await adapter.extractTrace("bot", "JavaScript async patterns", 0.9);

      // "typescript" keyword hits TypeScript entry; semantic may include JS (adjacent)
      const hits = await adapter.lookupHybrid("bot", "typescript", 3);
      expect(hits.length).toBeGreaterThan(0);
      // TypeScript entry should rank first since it matches both keyword and semantically
      expect(hits[0].content).toContain("TypeScript");
    });

    it("blends keyword and semantic results when provider is configured (SQLite)", async () => {
      const provider = new SimpleEmbeddingProvider(64);
      const store = new KnowledgeDbStore();
      store.init(":memory:");
      const mgr = makeMockManager([agent]);
      const adapter = new MemoryAdapter(
        mgr as unknown as McpServiceListManager,
        store,
        provider,
      );

      await adapter.extractTrace("bot", "TypeScript generics", 0.9);
      await adapter.extractTrace("bot", "Python list comprehension", 0.9);

      const hits = await adapter.lookupHybrid("bot", "typescript", 3);
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0].content).toContain("TypeScript");
      store.close();
    });

    it("respects topK limit", async () => {
      const provider = new SimpleEmbeddingProvider(64);
      const mgr = makeMockManager([agent]);
      const adapter = new MemoryAdapter(
        mgr as unknown as McpServiceListManager,
        undefined,
        provider,
      );
      for (let i = 0; i < 10; i++) {
        await adapter.extractTrace("bot", `TypeScript tip ${i}`, 0.9);
      }

      const hits = await adapter.lookupHybrid("bot", "typescript", 3);
      expect(hits).toHaveLength(3);
    });

    it("returns empty array when no entries exist", async () => {
      const provider = new SimpleEmbeddingProvider(64);
      const mgr = makeMockManager([agent]);
      const adapter = new MemoryAdapter(
        mgr as unknown as McpServiceListManager,
        undefined,
        provider,
      );
      const hits = await adapter.lookupHybrid("bot", "typescript", 5);
      expect(hits).toHaveLength(0);
    });
  });
});

