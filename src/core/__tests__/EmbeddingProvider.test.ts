import { SimpleEmbeddingProvider } from "../EmbeddingProvider";

describe("EmbeddingProvider", () => {
  // ── SimpleEmbeddingProvider ───────────────────────────────────────────────

  describe("SimpleEmbeddingProvider", () => {
    it("returns a vector of the configured dimensionality", async () => {
      const provider = new SimpleEmbeddingProvider(32);
      const vec = await provider.embed("hello world");
      expect(vec).toHaveLength(32);
      expect(provider.dimensions).toBe(32);
    });

    it("uses 64 dimensions by default", async () => {
      const provider = new SimpleEmbeddingProvider();
      const vec = await provider.embed("test");
      expect(vec).toHaveLength(64);
      expect(provider.dimensions).toBe(64);
    });

    it("produces a deterministic embedding — same text yields same vector", async () => {
      const provider = new SimpleEmbeddingProvider(64);
      const v1 = await provider.embed("TypeScript generics");
      const v2 = await provider.embed("TypeScript generics");
      expect(v1).toEqual(v2);
    });

    it("produces different vectors for different texts", async () => {
      const provider = new SimpleEmbeddingProvider(64);
      const a = await provider.embed("TypeScript generics");
      const b = await provider.embed("Python list comprehension");
      expect(a).not.toEqual(b);
    });

    it("returns a non-negative integer vector (term-frequency counts)", async () => {
      const provider = new SimpleEmbeddingProvider(64);
      const vec = await provider.embed("hello world foo");
      for (const v of vec) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(v)).toBe(true);
      }
    });

    it("returns all-zeros for empty string", async () => {
      const provider = new SimpleEmbeddingProvider(16);
      const vec = await provider.embed("");
      expect(vec.every((v) => v === 0)).toBe(true);
    });

    it("similar texts produce higher cosine similarity than dissimilar texts", async () => {
      const { cosineSimilarity } = await import("../vectorUtils");
      const provider = new SimpleEmbeddingProvider(64);

      const ts1 = await provider.embed("TypeScript type safety");
      const ts2 = await provider.embed("TypeScript type system");
      const py = await provider.embed("Python list comprehension");

      const simSame = cosineSimilarity(ts1, ts2);
      const simDiff = cosineSimilarity(ts1, py);

      // ts1 and ts2 share tokens; ts1 and py share almost none.
      expect(simSame).toBeGreaterThan(simDiff);
    });

    it("is case-insensitive (upper and lower case yield same vector)", async () => {
      const provider = new SimpleEmbeddingProvider(64);
      const lower = await provider.embed("typescript generics");
      const upper = await provider.embed("TYPESCRIPT GENERICS");
      expect(lower).toEqual(upper);
    });

    it("ignores non-word characters as token separators", async () => {
      const provider = new SimpleEmbeddingProvider(64);
      const a = await provider.embed("hello world");
      const b = await provider.embed("hello, world!");
      expect(a).toEqual(b);
    });
  });
});
