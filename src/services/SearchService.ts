import { ToolCall, ToolDefinition, ToolResult } from "../core/types";
import { BaseService } from "./BaseService";

/**
 * SearchService — lightweight mock web-search service.
 * Returns stub results so the demo works without external APIs.
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
        estimatedCostPerCall: 0.001,
      },
    ];
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    if (call.toolName !== "search_web") {
      return { success: false, error: `Unknown tool: ${call.toolName}` };
    }
    const query = call.arguments["query"] as string;
    const maxResults = (call.arguments["maxResults"] as number) ?? 5;

    // Simulate async I/O
    await new Promise<void>((resolve) => setTimeout(resolve, 10));

    const results = Array.from({ length: Math.min(maxResults, 5) }, (_, i) => ({
      title: `Result ${i + 1} for "${query}"`,
      url: `https://example.com/result-${i + 1}`,
      snippet: `This is a stub result about "${query}".`,
    }));

    return { success: true, output: { query, results } };
  }
}
