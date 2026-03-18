/**
 * 每个 Tool 的单次调用成本配置（USD）。
 *
 * 规则：
 * - 未配置的 Tool 默认成本为 0
 * - "per-call" 单位：每次调用固定成本
 * - "per-token" 单位：需结合 metadata.tokensUsed 计算（基础费 + tokensUsed * unitCost）
 * - "per-char" 单位：需结合 metadata.charsProcessed 计算（基础费 + charsProcessed * unitCost）
 */
export interface ToolCostConfig {
  costPerCall: number;       // 固定成本（USD/次）
  unit?: "per-call" | "per-token" | "per-char";
  unitCost?: number;         // 额外的单位成本（per-token 或 per-char 时使用）
}

export const TOOL_COSTS: Record<string, ToolCostConfig> = {
  // 免费工具
  "search_web":      { costPerCall: 0,     unit: "per-call" },
  "run_code":        { costPerCall: 0,     unit: "per-call" },
  "create_event":    { costPerCall: 0,     unit: "per-call" },
  "list_events":     { costPerCall: 0,     unit: "per-call" },
  "delete_event":    { costPerCall: 0,     unit: "per-call" },

  // Perplexity（预留，M1 实现后接入真实成本）
  "intelligence_search": { costPerCall: 0.001, unit: "per-call" },
  "perplexity_search":   { costPerCall: 0.001, unit: "per-call" },

  // Firecrawl（预留）
  "web_scrape":      { costPerCall: 0.002, unit: "per-call" },
  "web_crawl":       { costPerCall: 0.005, unit: "per-call" },
  "extract_data":    { costPerCall: 0.003, unit: "per-call" },

  // Plugin 工具（预留）
  "get_weather":     { costPerCall: 0.0005, unit: "per-call" },
  "translate_text":  { costPerCall: 0.001,  unit: "per-char", unitCost: 0.000001 },
  "summarize_text":  { costPerCall: 0.001,  unit: "per-call" },
};

/**
 * 计算一次工具调用的实际成本。
 *
 * @param toolName  工具名称
 * @param metadata  可选：tokensUsed（per-token 模式）或 charsProcessed（per-char 模式）
 * @returns 成本（USD）
 */
export function calculateCost(
  toolName: string,
  metadata?: { tokensUsed?: number; charsProcessed?: number }
): number {
  const config = TOOL_COSTS[toolName];
  if (!config) {
    return 0;
  }

  let cost = config.costPerCall;

  if (config.unit === "per-token" && config.unitCost && metadata?.tokensUsed) {
    cost += metadata.tokensUsed * config.unitCost;
  } else if (config.unit === "per-char" && config.unitCost && metadata?.charsProcessed) {
    cost += metadata.charsProcessed * config.unitCost;
  }

  return cost;
}
