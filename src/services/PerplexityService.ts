/**
 * src/services/PerplexityService.ts
 *
 * AI-powered intelligence search via the Perplexity API.
 * Falls back to SearchService when unavailable.
 */

import { ToolCall, ToolDefinition, ToolResult } from "../core/types";
import { BaseService } from "./BaseService";

export class PerplexityService extends BaseService {
  readonly name = "PerplexityService";

  /** When "down" or "rate-limited", route to this service. */
  fallbackServiceName = "SearchService";

  getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: "search_perplexity",
        description: "AI-powered search and reasoning via the Perplexity API.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "The search query." },
            maxResults: { type: "number", description: "Max results to return (default: 5).", default: 5 },
          },
          required: ["query"],
        },
        estimatedCostPerCall: 0.005,
      },
    ];
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    const query = call.arguments["query"] as string ?? String(call.arguments);
    return this._simulateApiCall(query);
  }

  /**
   * Simulates the Perplexity API.
   * Set PERPLEXITY_SIMULATE_FAILURE=true to force failures for testing.
   * Set PERPLEXITY_SIMULATE_RATE_LIMIT=true to force a 429.
   */
  private async _simulateApiCall(query: string): Promise<ToolResult> {
    // Note: process.env access requires @types/node
    const env = (typeof process !== "undefined" && process.env) ? process.env : {};

    if (env["PERPLEXITY_SIMULATE_RATE_LIMIT"] === "true") {
      return { success: false, error: "429 Too Many Requests — rate limit exceeded" };
    }
    if (env["PERPLEXITY_SIMULATE_FAILURE"] === "true") {
      return { success: false, error: "503 Service Unavailable" };
    }

    return {
      success: true,
      output: {
        source: "PerplexityService",
        query,
        answer: `AI-synthesized answer for: "${query}"`,
        citations: ["https://example.com/1", "https://example.com/2"],
      },
    };
  }
}
