/**
 * src/services/PerplexityService.ts
 *
 * AI-powered intelligence search via the Perplexity API.
 * Falls back to SearchService when unavailable.
 *
 * In this implementation the actual HTTP call is simulated so the project
 * runs without a real API key.  Replace `_simulateApiCall()` with a real
 * fetch() call once you have a PERPLEXITY_API_KEY environment variable.
 */

import { ServiceResult } from "../core/types";
import { BaseService } from "./BaseService";

export class PerplexityService extends BaseService {
  readonly name = "PerplexityService";
  readonly description =
    "AI-powered search and reasoning via Perplexity API";

  /** When "down" or "rate-limited", route to this service. */
  fallbackServiceName = "SearchService";

  async execute(payload: unknown): Promise<ServiceResult> {
    const query =
      typeof payload === "object" &&
      payload !== null &&
      "query" in payload
        ? (payload as { query: string }).query
        : String(payload);

    return this._simulateApiCall(query);
  }

  /**
   * Simulates the Perplexity API.
   * Set PERPLEXITY_SIMULATE_FAILURE=true to force failures for testing.
   * Set PERPLEXITY_SIMULATE_RATE_LIMIT=true to force a 429.
   */
  private async _simulateApiCall(query: string): Promise<ServiceResult> {
    if (process.env.PERPLEXITY_SIMULATE_RATE_LIMIT === "true") {
      return {
        success: false,
        error: "429 Too Many Requests — rate limit exceeded",
        statusCode: 429,
        retryAfterSeconds: 30,
      };
    }

    if (process.env.PERPLEXITY_SIMULATE_FAILURE === "true") {
      return {
        success: false,
        error: "503 Service Unavailable",
        statusCode: 503,
      };
    }

    return {
      success: true,
      data: {
        source: "PerplexityService",
        query,
        answer: `AI-synthesized answer for: "${query}"`,
        citations: ["https://example.com/1", "https://example.com/2"],
      },
    };
  }
}
