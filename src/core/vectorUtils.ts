/**
 * Compute cosine similarity between two equal-length vectors.
 * Returns a value in [-1, 1].
 * Returns 0 if either vector has zero magnitude.
 *
 * @throws {Error} if the vectors have different lengths.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(
      `Vectors must have the same dimension (got ${a.length} and ${b.length})`,
    );
  }
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  if (denom === 0) return 0;
  return dot / denom;
}

/**
 * L2-normalise a vector so that its Euclidean magnitude equals 1.
 * Returns a zero vector (same length) if the input has zero magnitude.
 */
export function normalizeVector(v: number[]): number[] {
  const mag = Math.sqrt(v.reduce((sum, vi) => sum + vi * vi, 0));
  if (mag === 0) return v.map(() => 0);
  return v.map((vi) => vi / mag);
}
