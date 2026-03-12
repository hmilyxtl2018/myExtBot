import { ToolCall, ToolDefinition, ToolResult } from "../core/types";
import { BaseService } from "./BaseService";
import { config } from "../config";
import { httpsPost } from "../utils/httpsPost";

/** Shape of the Perplexity chat/completions response we care about. */
interface PerplexityResponse {
  id?: string;
  model?: string;
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  citations?: string[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: {
    message?: string;
    type?: string;
  };
}

/**
 * PerplexityService provides real-time web search via the Perplexity AI API.
 *
 * Tool provided: `intelligence_search`
 *
 * Set the following environment variables before use:
 *   PERPLEXITY_API_KEY  — your Perplexity API key (required)
 *   PERPLEXITY_MODEL    — model name, default "sonar"
 *   PERPLEXITY_BASE_URL — override the API base URL (optional)
 */
export class PerplexityService extends BaseService {
  readonly name = "PerplexityService";

  getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: "intelligence_search",
        description:
          "使用 Perplexity AI 搜索实时信息，返回带引用来源的答案。适合需要最新信息、事实查询、技术文档查找的场景。",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "搜索查询词。",
            },
            focus: {
              type: "string",
              description:
                '搜索范围。可选值："web"（默认）、"academic"、"news"。',
              enum: ["web", "academic", "news"],
              default: "web",
            },
            maxTokens: {
              type: "number",
              description: "最大返回 token 数（默认 1024）。",
              default: 1024,
            },
          },
          required: ["query"],
        },
      },
    ];
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    if (call.toolName !== "intelligence_search") {
      return { success: false, error: `Unknown tool: ${call.toolName}` };
    }

    const { apiKey, baseUrl, model } = config.perplexity;

    if (!apiKey) {
      return {
        success: false,
        error:
          "PERPLEXITY_API_KEY is not set. Please set it in your environment.",
      };
    }

    const query = call.arguments["query"] as string;
    const focus = (call.arguments["focus"] as string | undefined) ?? "web";
    const maxTokens =
      (call.arguments["maxTokens"] as number | undefined) ?? 1024;

    const messages: Array<{ role: string; content: string }> = [];

    if (focus === "news") {
      messages.push({
        role: "system",
        content: "Focus on recent news articles.",
      });
    }

    messages.push({ role: "user", content: query });

    const requestBody = JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      search_domain_filter: [],
      return_citations: true,
      return_related_questions: false,
      search_recency_filter: "month",
    });

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    };

    try {
      let status: number;
      let responseData: unknown;

      if (typeof globalThis.fetch === "function") {
        const response = await globalThis.fetch(
          `${baseUrl}/chat/completions`,
          {
            method: "POST",
            headers,
            body: requestBody,
          }
        );
        status = response.status;
        responseData = await response.json();
      } else {
        const result = await httpsPost(
          `${baseUrl}/chat/completions`,
          headers,
          requestBody
        );
        status = result.status;
        responseData = result.json;
      }

      const data = responseData as PerplexityResponse;

      if (status < 200 || status >= 300) {
        const errMsg = data?.error?.message ?? `HTTP error ${status}`;
        return { success: false, error: errMsg };
      }

      const answer = data.choices?.[0]?.message?.content ?? "";
      const citations = data.citations ?? [];

      return {
        success: true,
        output: {
          answer,
          citations,
          model: data.model ?? model,
          usage: data.usage ?? {},
        },
      };
    } catch (err) {
      return {
        success: false,
        error: (err as Error).message,
      };
    }
  }
}
