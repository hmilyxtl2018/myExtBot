import axios from "axios";
import { ToolCall, ToolDefinition, ToolResult } from "../core/types";
import { BaseService } from "./BaseService";

const PERPLEXITY_API_URL = "https://api.perplexity.ai/chat/completions";

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

interface PerplexityApiResponse {
  choices: Array<{ message: { role: string; content: string } }>;
  citations?: string[];
}

/**
 * SearchService — web-search service backed by the Perplexity API when
 * `PERPLEXITY_API_KEY` is set in the environment.  Falls back to stub
 * results so the demo and tests work without any API key.
 *
 * Tool provided: `search_web`
 */
export class SearchService extends BaseService {
  readonly name = "SearchService";

  /** Request timeout in milliseconds (default: 10,000). */
  private readonly _timeoutMs: number;

  /**
   * Maximum number of total attempts for each API call.
   * 1 = single attempt (no retry), 2 = one retry, etc.
   * 401 and 429 responses are never retried.
   */
  private readonly _maxAttempts: number;

  constructor(timeoutMs = 10_000, maxAttempts = 1) {
    super();
    this._timeoutMs = timeoutMs;
    this._maxAttempts = maxAttempts;
  }

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

    const apiKey = process.env["PERPLEXITY_API_KEY"];
    if (apiKey) {
      try {
        const results = await this._fetchFromPerplexity(query, maxResults, apiKey);
        return { success: true, output: { query, results } };
      } catch (err) {
        console.warn(
          "[SearchService] Perplexity API call failed, falling back to stub:",
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    return this._stubResults(query, maxResults);
  }

  /** Calls the Perplexity chat-completions endpoint and returns normalised results. */
  private async _fetchFromPerplexity(
    query: string,
    maxResults: number,
    apiKey: string,
  ): Promise<SearchResult[]> {
    let lastError: unknown;

    for (let attempt = 0; attempt < this._maxAttempts; attempt++) {
      try {
        const { data } = await axios.post<PerplexityApiResponse>(
          PERPLEXITY_API_URL,
          {
            model: "sonar",
            messages: [
              { role: "system", content: "Return concise search results with sources." },
              {
                role: "user",
                content: `Search: ${query}. Return top ${maxResults} results.`,
              },
            ],
            max_tokens: 1024,
          },
          {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            timeout: this._timeoutMs,
          },
        );

        const content = data.choices?.[0]?.message?.content ?? "";
        const citations = data.citations ?? [];
        return this._normalizeResults(content, citations, maxResults);
      } catch (err) {
        const status = (err as { response?: { status?: number } }).response?.status;
        if (status === 401) {
          console.warn("[SearchService] Invalid Perplexity API key (401).");
          throw err;
        }
        if (status === 429) {
          console.warn("[SearchService] Perplexity rate limit hit (429).");
          throw err;
        }
        lastError = err;
      }
    }

    throw lastError;
  }

  /** Maps a Perplexity response into the `{ title, url, snippet }` format. */
  private _normalizeResults(
    content: string,
    citations: string[],
    maxResults: number,
  ): SearchResult[] {
    const lines = content.split("\n").filter((l) => l.trim());
    const count = Math.min(maxResults, citations.length > 0 ? citations.length : lines.length || 1);

    return Array.from({ length: count }, (_, i) => ({
      title: `Result ${i + 1}`,
      url: citations[i] ?? `https://example.com/result-${i + 1}`,
      snippet: (lines[i] ?? content).replace(/^\d+\.\s*/, "").trim().substring(0, 200),
    }));
  }

  private async _stubResults(query: string, maxResults: number): Promise<ToolResult> {
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
