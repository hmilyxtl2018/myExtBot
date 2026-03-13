import { ToolCall, ToolDefinition, ToolResult } from "../core/types";
import { BaseService } from "./BaseService";
import { config } from "../config";
import { httpsPost } from "../utils/httpsPost";

/** Shape of the Firecrawl /scrape response we care about. */
interface FirecrawlResponse {
  success?: boolean;
  data?: {
    markdown?: string;
    html?: string;
    rawHtml?: string;
    links?: string[];
    metadata?: Record<string, unknown>;
  };
  error?: string;
}

/**
 * FirecrawlService provides web scraping via the Firecrawl API.
 * Returns clean Markdown (or other formats) stripped of ads, navbars, etc.
 * Supports JavaScript-rendered pages.
 *
 * Tool provided: `web_scrape`
 *
 * Set the following environment variables before use:
 *   FIRECRAWL_API_KEY  — your Firecrawl API key (required)
 *   FIRECRAWL_BASE_URL — override the API base URL (optional)
 */
export class FirecrawlService extends BaseService {
  readonly name = "FirecrawlService";

  getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: "web_scrape",
        description:
          "使用 Firecrawl 抓取指定网页的内容，返回干净的 Markdown 文本（去除广告、导航栏等噪音）。支持 JavaScript 渲染的动态网页。适合内容提取、数据采集、文档爬取等场景。",
        parameters: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description:
                "目标网页的完整 URL（必须以 http:// 或 https:// 开头）。",
            },
            format: {
              type: "string",
              description: '返回格式（默认 "markdown"）。',
              enum: ["markdown", "html", "rawHtml", "links"],
              default: "markdown",
            },
            onlyMainContent: {
              type: "string",
              description:
                "是否只返回主体内容，去除页头页脚（默认 true）。",
              default: "true",
            },
            waitFor: {
              type: "number",
              description:
                "等待页面加载的毫秒数，用于动态内容（默认 0）。",
              default: 0,
            },
          },
          required: ["url"],
        },
      },
    ];
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    if (call.toolName !== "web_scrape") {
      return { success: false, error: `Unknown tool: ${call.toolName}` };
    }

    const { apiKey, baseUrl } = config.firecrawl;

    if (!apiKey) {
      return {
        success: false,
        error:
          "FIRECRAWL_API_KEY is not set. Please set it in your environment.",
      };
    }

    const url = call.arguments["url"] as string;
    const format =
      (call.arguments["format"] as string | undefined) ?? "markdown";

    // Accept both boolean true/false and string "true"/"false" from tool arguments.
    const rawOnlyMain = call.arguments["onlyMainContent"];
    const onlyMainContent =
      rawOnlyMain === false || rawOnlyMain === "false" ? false : true;

    const waitFor = (call.arguments["waitFor"] as number | undefined) ?? 0;

    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      return {
        success: false,
        error: "URL must start with http:// or https://",
      };
    }

    const requestBody = JSON.stringify({
      url,
      formats: [format],
      onlyMainContent,
      waitFor,
    });

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    };

    try {
      let status: number;
      let responseData: unknown;

      if (typeof globalThis.fetch === "function") {
        const response = await globalThis.fetch(`${baseUrl}/scrape`, {
          method: "POST",
          headers,
          body: requestBody,
        });
        status = response.status;
        responseData = await response.json();
      } else {
        const result = await httpsPost(
          `${baseUrl}/scrape`,
          headers,
          requestBody
        );
        status = result.status;
        responseData = result.json;
      }

      const data = responseData as FirecrawlResponse;

      if (status < 200 || status >= 300) {
        const errMsg = data?.error ?? `HTTP error ${status}`;
        return { success: false, error: errMsg };
      }

      if (!data.success) {
        return {
          success: false,
          error: data.error ?? "Firecrawl returned success: false",
        };
      }

      const scrapeData = data.data ?? {};
      const content =
        format === "markdown"
          ? (scrapeData.markdown ?? "")
          : format === "html"
          ? (scrapeData.html ?? "")
          : format === "rawHtml"
          ? (scrapeData.rawHtml ?? "")
          : JSON.stringify(scrapeData.links ?? []);

      const metadata = scrapeData.metadata ?? {};
      const title = (metadata["title"] as string | undefined) ?? undefined;

      return {
        success: true,
        output: {
          url,
          ...(title !== undefined ? { title } : {}),
          content,
          format,
          metadata,
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
