import { cosineSimilarity, normalizeVector } from "../vectorUtils";

describe("vectorUtils", () => {
  // ── cosineSimilarity ──────────────────────────────────────────────────────

  describe("cosineSimilarity", () => {
    it("returns 1.0 for identical vectors", () => {
      expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1.0);
    });

    it("returns -1.0 for exactly opposite vectors", () => {
      expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1.0);
    });

    it("returns 0.0 for orthogonal vectors", () => {
      expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0.0);
    });

    it("returns 0.0 when the first vector is all zeros", () => {
      expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
    });

    it("returns 0.0 when the second vector is all zeros", () => {
      expect(cosineSimilarity([1, 2, 3], [0, 0, 0])).toBe(0);
    });

    it("returns 0.0 when both vectors are all zeros", () => {
      expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
    });

    it("computes correct similarity for arbitrary vectors", () => {
      // [1, 1] · [1, 0] = 1; |[1,1]| = sqrt(2); |[1,0]| = 1 → cos ≈ 0.7071
      expect(cosineSimilarity([1, 1], [1, 0])).toBeCloseTo(Math.SQRT1_2);
    });

    it("is symmetric — swap(a,b) == swap(b,a)", () => {
      const a = [3, 1, 4];
      const b = [1, 5, 9];
      expect(cosineSimilarity(a, b)).toBeCloseTo(cosineSimilarity(b, a));
    });

    it("handles single-element vectors", () => {
      expect(cosineSimilarity([5], [3])).toBeCloseTo(1.0);
      expect(cosineSimilarity([5], [-3])).toBeCloseTo(-1.0);
    });

    it("throws when vectors have different lengths", () => {
      expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow(
        /same dimension/,
      );
    });

    it("returns a value in [-1, 1] for random-ish vectors", () => {
      const a = [0.3, -0.7, 0.5, 1.2];
      const b = [-0.1, 0.8, 0.2, -0.9];
      const sim = cosineSimilarity(a, b);
      expect(sim).toBeGreaterThanOrEqual(-1);
      expect(sim).toBeLessThanOrEqual(1);
    });
  });

  // ── normalizeVector ───────────────────────────────────────────────────────

  describe("normalizeVector", () => {
    it("produces a unit vector (magnitude ≈ 1)", () => {
      const v = [3, 4]; // magnitude = 5
      const n = normalizeVector(v);
      const mag = Math.sqrt(n.reduce((s, x) => s + x * x, 0));
      expect(mag).toBeCloseTo(1.0);
    });

    it("preserves the direction of the vector", () => {
      const v = [1, 1, 1];
      const n = normalizeVector(v);
      // all components should be equal
      expect(n[0]).toBeCloseTo(n[1]);
      expect(n[1]).toBeCloseTo(n[2]);
    });

    it("returns a zero vector for a zero input vector", () => {
      const result = normalizeVector([0, 0, 0]);
      expect(result).toEqual([0, 0, 0]);
    });

    it("does not mutate the input vector", () => {
      const v = [3, 4];
      normalizeVector(v);
      expect(v).toEqual([3, 4]);
    });

    it("handles single-element vectors", () => {
      expect(normalizeVector([7])).toEqual([1]);
      expect(normalizeVector([-7])[0]).toBeCloseTo(-1);
    });

    it("normalized vector has cosine similarity of 1 with itself", () => {
      const v = [1, 2, 3];
      const n = normalizeVector(v);
      expect(cosineSimilarity(n, n)).toBeCloseTo(1.0);
    });

    it("two vectors normalized then compared have same cosine similarity as unnormalized", () => {
      const a = [2, 0];
      const b = [1, 1];
      const direct = cosineSimilarity(a, b);
      const viaNorm = cosineSimilarity(normalizeVector(a), normalizeVector(b));
      expect(viaNorm).toBeCloseTo(direct);
    });
  });
});
