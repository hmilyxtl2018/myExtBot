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
});
