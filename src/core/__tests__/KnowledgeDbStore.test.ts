import { KnowledgeDbStore } from "../KnowledgeDbStore";
import type { KnowledgeEntry } from "../MemoryAdapter";

function makeEntry(
  agentId: string,
  content: string,
  confidence = 0.9,
  tags?: string[],
  createdAt?: string,
): KnowledgeEntry {
  return {
    id: `kdb-${agentId}-${Date.now()}`,
    agentId,
    content,
    confidence,
    createdAt: createdAt ?? new Date().toISOString(),
    tags,
  };
}

describe("KnowledgeDbStore", () => {
  let store: KnowledgeDbStore;

  beforeEach(() => {
    store = new KnowledgeDbStore();
    store.init(":memory:");
  });

  afterEach(() => {
    store.close();
  });

  // ── init ──────────────────────────────────────────────────────────────────

  describe("init", () => {
    it("creates the knowledge_entries table", () => {
      // If the table was not created, the query below would throw.
      expect(() => store.query("agent1", "", 10)).not.toThrow();
    });

    it("returns an empty array when the table is empty", () => {
      const results = store.query("agent1", "anything", 10);
      expect(results).toEqual([]);
    });

    it("rejects paths containing path-traversal sequences", () => {
      const bad = new KnowledgeDbStore();
      expect(() => bad.init("../evil.db")).toThrow(/Invalid database path/);
      expect(() => bad.init("data/../../etc/passwd")).toThrow(/Invalid database path/);
    });
  });

  // ── insert / query round-trip ─────────────────────────────────────────────

  describe("insert + query", () => {
    it("inserts an entry and retrieves it", () => {
      const entry = makeEntry("agent1", "TypeScript satisfies operator", 0.85, ["ts"]);
      store.insert("agent1", entry);

      const results = store.query("agent1", "TypeScript", 10);
      expect(results).toHaveLength(1);
      expect(results[0].content).toBe("TypeScript satisfies operator");
      expect(results[0].agentId).toBe("agent1");
      expect(results[0].confidence).toBeCloseTo(0.85);
      expect(results[0].tags).toEqual(["ts"]);
    });

    it("preserves createdAt timestamp", () => {
      const ts = "2026-01-15T10:00:00.000Z";
      const entry = makeEntry("agent1", "some content", 0.9, undefined, ts);
      store.insert("agent1", entry);

      const results = store.query("agent1", "some", 10);
      expect(results[0].createdAt).toBe(ts);
    });

    it("returns an entry with generated id containing agentId", () => {
      store.insert("agent1", makeEntry("agent1", "content", 0.9));
      const results = store.query("agent1", "content", 10);
      expect(results[0].id).toMatch(/^kdb-agent1-/);
    });
  });

  // ── keyword search ────────────────────────────────────────────────────────

  describe("keyword search", () => {
    beforeEach(() => {
      store.insert("agent1", makeEntry("agent1", "TypeScript satisfies operator", 0.9));
      store.insert("agent1", makeEntry("agent1", "Python list comprehension", 0.8));
      store.insert("agent1", makeEntry("agent1", "JavaScript async await", 0.7));
    });

    it("returns only matching entries (case-insensitive)", () => {
      const results = store.query("agent1", "typescript", 10);
      expect(results).toHaveLength(1);
      expect(results[0].content).toContain("TypeScript");
    });

    it("returns empty array when no entries match", () => {
      const results = store.query("agent1", "Rust", 10);
      expect(results).toEqual([]);
    });

    it("returns all matching entries when keyword is empty string", () => {
      const results = store.query("agent1", "", 100);
      expect(results).toHaveLength(3);
    });
  });

  // ── topK limit ────────────────────────────────────────────────────────────

  describe("topK limit", () => {
    it("limits results to topK", () => {
      for (let i = 0; i < 10; i++) {
        store.insert("agent1", makeEntry("agent1", `TypeScript tip ${i}`, 0.9));
      }
      const results = store.query("agent1", "TypeScript", 3);
      expect(results).toHaveLength(3);
    });

    it("returns fewer than topK if fewer matches exist", () => {
      store.insert("agent1", makeEntry("agent1", "TypeScript tip", 0.9));
      const results = store.query("agent1", "TypeScript", 5);
      expect(results).toHaveLength(1);
    });
  });

  // ── prune ─────────────────────────────────────────────────────────────────

  describe("prune", () => {
    it("keeps only the most recent maxEntries entries", () => {
      // Insert with distinct timestamps so ordering is deterministic
      store.insert("agent1", makeEntry("agent1", "entry 1", 0.9, undefined, "2026-01-01T00:00:01.000Z"));
      store.insert("agent1", makeEntry("agent1", "entry 2", 0.9, undefined, "2026-01-01T00:00:02.000Z"));
      store.insert("agent1", makeEntry("agent1", "entry 3", 0.9, undefined, "2026-01-01T00:00:03.000Z"));

      store.prune("agent1", 2);

      const results = store.query("agent1", "", 100);
      expect(results).toHaveLength(2);
      const contents = results.map((r) => r.content);
      expect(contents).not.toContain("entry 1");
      expect(contents).toContain("entry 2");
      expect(contents).toContain("entry 3");
    });

    it("does nothing when count is below maxEntries", () => {
      store.insert("agent1", makeEntry("agent1", "entry 1", 0.9));
      store.prune("agent1", 5);
      expect(store.query("agent1", "", 100)).toHaveLength(1);
    });
  });

  // ── agent isolation ───────────────────────────────────────────────────────

  describe("agent isolation", () => {
    it("multiple agents do not interfere with each other", () => {
      store.insert("agent1", makeEntry("agent1", "Agent 1 content", 0.9));
      store.insert("agent2", makeEntry("agent2", "Agent 2 content", 0.9));

      const results1 = store.query("agent1", "", 10);
      const results2 = store.query("agent2", "", 10);

      expect(results1).toHaveLength(1);
      expect(results1[0].agentId).toBe("agent1");

      expect(results2).toHaveLength(1);
      expect(results2[0].agentId).toBe("agent2");
    });

    it("prune for one agent does not affect another", () => {
      store.insert("agent1", makeEntry("agent1", "a1 entry 1", 0.9, undefined, "2026-01-01T00:00:01.000Z"));
      store.insert("agent1", makeEntry("agent1", "a1 entry 2", 0.9, undefined, "2026-01-01T00:00:02.000Z"));
      store.insert("agent1", makeEntry("agent1", "a1 entry 3", 0.9, undefined, "2026-01-01T00:00:03.000Z"));
      store.insert("agent2", makeEntry("agent2", "a2 entry 1", 0.9));

      store.prune("agent1", 2);

      expect(store.query("agent1", "", 100)).toHaveLength(2);
      expect(store.query("agent2", "", 100)).toHaveLength(1);
    });
  });

  // ── ordering ──────────────────────────────────────────────────────────────

  describe("result ordering", () => {
    it("orders results by score DESC", () => {
      store.insert("agent1", makeEntry("agent1", "low score entry", 0.5, undefined, "2026-01-01T00:00:01.000Z"));
      store.insert("agent1", makeEntry("agent1", "high score entry", 0.95, undefined, "2026-01-01T00:00:01.000Z"));
      store.insert("agent1", makeEntry("agent1", "mid score entry", 0.75, undefined, "2026-01-01T00:00:01.000Z"));

      const results = store.query("agent1", "", 10);
      expect(results[0].content).toBe("high score entry");
      expect(results[2].content).toBe("low score entry");
    });
  });

  // ── expiresAt persistence ─────────────────────────────────────────────────

  describe("expiresAt", () => {
    it("persists expiresAt when provided", () => {
      const expires = "2026-12-31T23:59:59.000Z";
      const entry: import("../MemoryAdapter").KnowledgeEntry = {
        id: "kdb-agent1-1",
        agentId: "agent1",
        content: "expiring content",
        confidence: 0.9,
        createdAt: new Date().toISOString(),
        expiresAt: expires,
      };
      store.insert("agent1", entry);

      const results = store.query("agent1", "expiring", 10);
      expect(results[0].expiresAt).toBe(expires);
    });

    it("expiresAt is undefined when not set", () => {
      store.insert("agent1", makeEntry("agent1", "no expiry", 0.9));
      const results = store.query("agent1", "no expiry", 10);
      expect(results[0].expiresAt).toBeUndefined();
    });
  });

  // ── deleteExpired ─────────────────────────────────────────────────────────

  describe("deleteExpired", () => {
    it("soft-deletes entries whose expiresAt is in the past (sets retiredAt)", () => {
      const past = new Date(Date.now() - 60_000).toISOString();
      const future = new Date(Date.now() + 60_000).toISOString();

      const expiredEntry: import("../MemoryAdapter").KnowledgeEntry = {
        id: "kdb-agent1-1",
        agentId: "agent1",
        content: "expired entry",
        confidence: 0.9,
        createdAt: new Date().toISOString(),
        expiresAt: past,
      };
      const activeEntry: import("../MemoryAdapter").KnowledgeEntry = {
        id: "kdb-agent1-2",
        agentId: "agent1",
        content: "active entry",
        confidence: 0.9,
        createdAt: new Date().toISOString(),
        expiresAt: future,
      };
      store.insert("agent1", expiredEntry);
      store.insert("agent1", activeEntry);

      store.deleteExpired("agent1");

      // Expired entry excluded from query results.
      const results = store.query("agent1", "", 10);
      expect(results).toHaveLength(1);
      expect(results[0].content).toBe("active entry");

      // Expired entry visible via listRetired().
      const retired = store.listRetired("agent1");
      expect(retired).toHaveLength(1);
      expect(retired[0].content).toBe("expired entry");
      expect(retired[0].retiredAt).toBeDefined();
    });

    it("does not soft-delete entries without expiresAt", () => {
      store.insert("agent1", makeEntry("agent1", "permanent entry", 0.9));
      store.deleteExpired("agent1");
      expect(store.query("agent1", "", 10)).toHaveLength(1);
      expect(store.listRetired("agent1")).toHaveLength(0);
    });

    it("soft-deletes expired entries across all agents when no agentId given", () => {
      const past = new Date(Date.now() - 60_000).toISOString();

      const e1: import("../MemoryAdapter").KnowledgeEntry = {
        id: "kdb-a1-1", agentId: "a1", content: "a1 expired",
        confidence: 0.9, createdAt: new Date().toISOString(), expiresAt: past,
      };
      const e2: import("../MemoryAdapter").KnowledgeEntry = {
        id: "kdb-a2-1", agentId: "a2", content: "a2 expired",
        confidence: 0.9, createdAt: new Date().toISOString(), expiresAt: past,
      };
      store.insert("a1", e1);
      store.insert("a2", e2);

      store.deleteExpired();

      expect(store.query("a1", "", 10)).toHaveLength(0);
      expect(store.query("a2", "", 10)).toHaveLength(0);
      expect(store.listRetired("a1")).toHaveLength(1);
      expect(store.listRetired("a2")).toHaveLength(1);
    });
  });

  // ── list ──────────────────────────────────────────────────────────────────

  describe("list", () => {
    it("returns all active entries for a specific agent", () => {
      store.insert("agent1", makeEntry("agent1", "entry A", 0.9));
      store.insert("agent1", makeEntry("agent1", "entry B", 0.8));
      store.insert("agent2", makeEntry("agent2", "entry C", 0.7));

      const results = store.list("agent1");
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.agentId === "agent1")).toBe(true);
    });

    it("returns active entries for all agents when no agentId given", () => {
      store.insert("agent1", makeEntry("agent1", "entry A", 0.9));
      store.insert("agent2", makeEntry("agent2", "entry B", 0.8));

      const results = store.list();
      expect(results).toHaveLength(2);
    });

    it("returns empty array when no entries exist", () => {
      expect(store.list("agent1")).toEqual([]);
      expect(store.list()).toEqual([]);
    });

    it("excludes retired entries by default", () => {
      const past = new Date(Date.now() - 60_000).toISOString();
      const expiredEntry: import("../MemoryAdapter").KnowledgeEntry = {
        id: "kdb-agent1-1",
        agentId: "agent1",
        content: "expired entry",
        confidence: 0.9,
        createdAt: new Date().toISOString(),
        expiresAt: past,
      };
      store.insert("agent1", expiredEntry);
      store.insert("agent1", makeEntry("agent1", "active entry", 0.9));
      store.deleteExpired("agent1");

      expect(store.list("agent1")).toHaveLength(1);
      expect(store.list("agent1")[0].content).toBe("active entry");
    });

    it("includes retired entries when includeRetired is true", () => {
      const past = new Date(Date.now() - 60_000).toISOString();
      const expiredEntry: import("../MemoryAdapter").KnowledgeEntry = {
        id: "kdb-agent1-1",
        agentId: "agent1",
        content: "expired entry",
        confidence: 0.9,
        createdAt: new Date().toISOString(),
        expiresAt: past,
      };
      store.insert("agent1", expiredEntry);
      store.insert("agent1", makeEntry("agent1", "active entry", 0.9));
      store.deleteExpired("agent1");

      expect(store.list("agent1", { includeRetired: true })).toHaveLength(2);
    });
  });

  // ── listRetired ───────────────────────────────────────────────────────────

  describe("listRetired", () => {
    it("returns only retired entries for a specific agent", () => {
      const past = new Date(Date.now() - 60_000).toISOString();
      const expiredEntry: import("../MemoryAdapter").KnowledgeEntry = {
        id: "kdb-agent1-exp",
        agentId: "agent1",
        content: "expired content",
        confidence: 0.9,
        createdAt: new Date().toISOString(),
        expiresAt: past,
      };
      store.insert("agent1", expiredEntry);
      store.insert("agent1", makeEntry("agent1", "active content", 0.9));
      store.deleteExpired("agent1");

      const retired = store.listRetired("agent1");
      expect(retired).toHaveLength(1);
      expect(retired[0].content).toBe("expired content");
      expect(retired[0].retiredAt).toBeDefined();
    });

    it("returns empty array when no retired entries exist", () => {
      store.insert("agent1", makeEntry("agent1", "permanent", 0.9));
      expect(store.listRetired("agent1")).toHaveLength(0);
    });

    it("returns retired entries across all agents when no agentId given", () => {
      const past = new Date(Date.now() - 60_000).toISOString();
      const e1: import("../MemoryAdapter").KnowledgeEntry = {
        id: "kdb-a1-1", agentId: "a1", content: "a1 retired",
        confidence: 0.9, createdAt: new Date().toISOString(), expiresAt: past,
      };
      const e2: import("../MemoryAdapter").KnowledgeEntry = {
        id: "kdb-a2-1", agentId: "a2", content: "a2 retired",
        confidence: 0.9, createdAt: new Date().toISOString(), expiresAt: past,
      };
      store.insert("a1", e1);
      store.insert("a2", e2);
      store.deleteExpired();

      const retired = store.listRetired();
      expect(retired).toHaveLength(2);
    });
  });

  // ── purgeRetired ──────────────────────────────────────────────────────────

  describe("purgeRetired", () => {
    it("permanently removes all retired entries when no cutoff is given", () => {
      const past = new Date(Date.now() - 60_000).toISOString();
      const expiredEntry: import("../MemoryAdapter").KnowledgeEntry = {
        id: "kdb-agent1-1",
        agentId: "agent1",
        content: "will be purged",
        confidence: 0.9,
        createdAt: new Date().toISOString(),
        expiresAt: past,
      };
      store.insert("agent1", expiredEntry);
      store.deleteExpired("agent1");

      expect(store.listRetired("agent1")).toHaveLength(1);

      const count = store.purgeRetired();
      expect(count).toBe(1);
      expect(store.listRetired("agent1")).toHaveLength(0);
    });

    it("only removes retired entries older than olderThanDays", () => {
      const past = new Date(Date.now() - 3 * 86_400_000).toISOString(); // 3 days ago
      const expiredEntry: import("../MemoryAdapter").KnowledgeEntry = {
        id: "kdb-agent1-1",
        agentId: "agent1",
        content: "old retired entry",
        confidence: 0.9,
        createdAt: new Date().toISOString(),
        expiresAt: past,
      };
      store.insert("agent1", expiredEntry);
      store.deleteExpired("agent1");

      // Purge entries retired more than 7 days ago — our entry is ~0 days old, so it should survive.
      const count = store.purgeRetired(7);
      expect(count).toBe(0);
      expect(store.listRetired("agent1")).toHaveLength(1);

      // Purge entries retired more than 0 days ago — our entry should be removed.
      const count2 = store.purgeRetired(0);
      expect(count2).toBe(1);
      expect(store.listRetired("agent1")).toHaveLength(0);
    });

    it("returns 0 when there are no retired entries", () => {
      store.insert("agent1", makeEntry("agent1", "permanent", 0.9));
      expect(store.purgeRetired()).toBe(0);
    });
  });

  // ── embedding / semantic search ───────────────────────────────────────────

  describe("insertWithEmbedding + searchSemantic", () => {
    it("insertWithEmbedding stores an entry retrievable by searchSemantic", () => {
      const entry = makeEntry("agent1", "TypeScript generics", 0.9);
      const embedding = [1, 0, 0, 0];
      store.insertWithEmbedding("agent1", entry, embedding);

      const results = store.searchSemantic("agent1", [1, 0, 0, 0], 5);
      expect(results).toHaveLength(1);
      expect(results[0].content).toBe("TypeScript generics");
    });

    it("searchSemantic returns empty when no entries have embeddings", () => {
      store.insert("agent1", makeEntry("agent1", "no embedding", 0.9));
      const results = store.searchSemantic("agent1", [1, 0], 5);
      expect(results).toHaveLength(0);
    });

    it("searchSemantic ranks closer vectors higher", () => {
      const close = makeEntry("agent1", "close entry", 0.9);
      const far = makeEntry("agent1", "far entry", 0.9);

      // close entry is similar to the query [1, 0]; far entry is orthogonal
      store.insertWithEmbedding("agent1", close, [1, 0]);
      store.insertWithEmbedding("agent1", far, [0, 1]);

      const results = store.searchSemantic("agent1", [1, 0], 5);
      expect(results[0].content).toBe("close entry");
      expect(results[1].content).toBe("far entry");
    });

    it("searchSemantic respects topK limit", () => {
      for (let i = 0; i < 5; i++) {
        store.insertWithEmbedding(
          "agent1",
          makeEntry("agent1", `entry ${i}`, 0.9),
          [i + 1, 0],
        );
      }
      const results = store.searchSemantic("agent1", [1, 0], 3);
      expect(results).toHaveLength(3);
    });

    it("searchSemantic excludes retired entries", () => {
      const past = new Date(Date.now() - 60_000).toISOString();
      const expiredEntry: import("../MemoryAdapter").KnowledgeEntry = {
        id: "kdb-agent1-exp",
        agentId: "agent1",
        content: "retired entry",
        confidence: 0.9,
        createdAt: new Date().toISOString(),
        expiresAt: past,
      };
      store.insertWithEmbedding("agent1", expiredEntry, [1, 0]);
      store.deleteExpired("agent1");

      const results = store.searchSemantic("agent1", [1, 0], 5);
      expect(results).toHaveLength(0);
    });

    it("searchSemantic excludes expired entries", () => {
      const past = new Date(Date.now() - 60_000).toISOString();
      const expiredEntry: import("../MemoryAdapter").KnowledgeEntry = {
        id: "kdb-agent1-exp",
        agentId: "agent1",
        content: "expired embedding entry",
        confidence: 0.9,
        createdAt: new Date().toISOString(),
        expiresAt: past,
      };
      store.insertWithEmbedding("agent1", expiredEntry, [1, 0]);
      // Do NOT call deleteExpired — entry is not retired but is expired

      const results = store.searchSemantic("agent1", [1, 0], 5);
      expect(results).toHaveLength(0);
    });

    it("insert() optionally accepts an embedding (same as insertWithEmbedding)", () => {
      const entry = makeEntry("agent1", "entry via insert", 0.9);
      store.insert("agent1", entry, [1, 0, 0]);

      const results = store.searchSemantic("agent1", [1, 0, 0], 5);
      expect(results).toHaveLength(1);
      expect(results[0].content).toBe("entry via insert");
    });

    it("insert() without embedding is backwards compatible (entry absent from searchSemantic)", () => {
      store.insert("agent1", makeEntry("agent1", "legacy entry", 0.9));
      const results = store.searchSemantic("agent1", [1, 0], 5);
      expect(results).toHaveLength(0);
    });

    it("searchSemantic is isolated per agent", () => {
      store.insertWithEmbedding("agent1", makeEntry("agent1", "a1 content", 0.9), [1, 0]);
      store.insertWithEmbedding("agent2", makeEntry("agent2", "a2 content", 0.9), [1, 0]);

      expect(store.searchSemantic("agent1", [1, 0], 5).every((r) => r.agentId === "agent1")).toBe(true);
      expect(store.searchSemantic("agent2", [1, 0], 5).every((r) => r.agentId === "agent2")).toBe(true);
    });
  });

  // ── searchSemanticWithScores ──────────────────────────────────────────────

  describe("searchSemanticWithScores", () => {
    it("returns entries with their cosine-similarity scores", () => {
      store.insertWithEmbedding("agent1", makeEntry("agent1", "entry A", 0.9), [1, 0]);
      store.insertWithEmbedding("agent1", makeEntry("agent1", "entry B", 0.9), [0, 1]);

      const results = store.searchSemanticWithScores("agent1", [1, 0], 5);
      expect(results).toHaveLength(2);
      expect(results[0].score).toBeCloseTo(1.0);
      expect(results[0].entry.content).toBe("entry A");
      expect(results[1].score).toBeCloseTo(0.0);
    });

    it("returns empty when no entries have embeddings", () => {
      store.insert("agent1", makeEntry("agent1", "no emb", 0.9));
      expect(store.searchSemanticWithScores("agent1", [1, 0], 5)).toHaveLength(0);
    });
  });
});

