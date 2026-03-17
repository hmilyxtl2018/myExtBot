/**
 * src/services/SearchService.ts
 *
 * A lightweight mock search service — used as a fallback when premium
 * services (e.g. PerplexityService) are unavailable.
 */

import { ServiceResult } from "../core/types";
import { BaseService } from "./BaseService";

export class SearchService extends BaseService {
  readonly name = "SearchService";
  readonly description = "Mock web-search service (free, always available)";

  async execute(payload: unknown): Promise<ServiceResult> {
    const query =
      typeof payload === "object" &&
      payload !== null &&
      "query" in payload
        ? (payload as { query: string }).query
        : String(payload);

    return {
      success: true,
      data: {
        source: "SearchService (mock)",
        query,
        results: [
          { title: "Mock Result 1", snippet: `Result for "${query}" (mock)` },
          { title: "Mock Result 2", snippet: `Another result for "${query}" (mock)` },
        ],
      },
import { ToolCall, ToolDefinition, ToolResult } from "../core/types";
import { BaseService } from "./BaseService";

/**
 * SearchService exposes web-search capabilities to the LLM.
 *
 * Tool provided: `search_web`
 */
export class SearchService extends BaseService {
  readonly name = "SearchService";

  getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: "search_web",
        description:
          "Search the web for information about a given query and return the top results.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The search query string.",
            },
            maxResults: {
              type: "number",
              description: "Maximum number of results to return (default: 5).",
              default: 5,
            },
          },
          required: ["query"],
        },
      },
    ];
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    if (call.toolName !== "search_web") {
      return { success: false, error: `Unknown tool: ${call.toolName}` };
    }

    const query = call.arguments["query"] as string;
    const maxResults = (call.arguments["maxResults"] as number) ?? 5;

    // Mock implementation — replace with a real search API call.
    const mockResults = Array.from({ length: maxResults }, (_, i) => ({
      title: `Result ${i + 1} for "${query}"`,
      url: `https://example.com/search?q=${encodeURIComponent(query)}&page=${i + 1}`,
      snippet: `This is a mock snippet for result ${i + 1} matching the query "${query}".`,
    }));

    return {
      success: true,
      output: { query, results: mockResults },
    };
  }
}
