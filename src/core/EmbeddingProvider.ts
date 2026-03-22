/**
 * Common interface for text embedding providers.
 * Implementations convert a string into a fixed-length numeric vector
 * suitable for cosine-similarity comparisons.
 */
export interface EmbeddingProvider {
  /** Generate an embedding vector for the given text. */
  embed(text: string): Promise<number[]>;
  /** The dimensionality of the embedding vectors produced. */
  readonly dimensions: number;
}

/**
 * Deterministic bag-of-words embedding provider for testing / offline use.
 * Uses a simple hash-bucketed term-frequency approach — no external API
 * dependency, always produces the same vector for the same input.
 *
 * NOTE: This provider is intentionally naive and is NOT suitable for
 * production semantic search.  Use `OpenAIEmbeddingProvider` (or another
 * real provider) for production workloads.
 */
export class SimpleEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions: number;

  constructor(dimensions = 64) {
    this.dimensions = dimensions;
  }

  async embed(text: string): Promise<number[]> {
    const vector = new Array<number>(this.dimensions).fill(0);
    const tokens = text.toLowerCase().split(/\W+/).filter(Boolean);
    for (const token of tokens) {
      const h = this.hashToken(token);
      vector[h % this.dimensions] += 1;
    }
    return vector;
  }

  private hashToken(token: string): number {
    // djb2-inspired non-cryptographic hash
    let h = 5381;
    for (let i = 0; i < token.length; i++) {
      h = ((h << 5) + h + token.charCodeAt(i)) >>> 0;
    }
    return h;
  }
}

/**
 * OpenAI embeddings API provider (text-embedding-3-small by default).
 * Requires the `OPENAI_API_KEY` environment variable to be set.
 *
 * This is a skeleton implementation that demonstrates the integration
 * pattern.  For large-scale production use, consider batching requests
 * and caching results.
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions: number;
  private readonly model: string;

  constructor(model = "text-embedding-3-small", dimensions = 1536) {
    this.model = model;
    this.dimensions = dimensions;
  }

  async embed(text: string): Promise<number[]> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY environment variable is not set");
    }

    const { default: https } = await import("https");
    const body = JSON.stringify({ model: this.model, input: text });

    return new Promise<number[]>((resolve, reject) => {
      const req = https.request(
        {
          hostname: "api.openai.com",
          path: "/v1/embeddings",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
            "Content-Length": Buffer.byteLength(body),
          },
        },
        (res) => {
          let data = "";
          res.on("data", (chunk: string) => {
            data += chunk;
          });
          res.on("end", () => {
            try {
              const json = JSON.parse(data) as {
                data?: Array<{ embedding: number[] }>;
                error?: { message: string };
              };
              if (json.error) {
                reject(new Error(`OpenAI API error: ${json.error.message}`));
              } else if (!json.data?.[0]?.embedding) {
                reject(new Error(`Unexpected OpenAI response: ${data}`));
              } else {
                resolve(json.data[0].embedding);
              }
            } catch (err) {
              reject(err);
            }
          });
        },
      );
      req.on("error", reject);
      req.write(body);
      req.end();
    });
  }
}
