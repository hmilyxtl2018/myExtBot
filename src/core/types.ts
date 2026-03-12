/**
 * 单次工具调用的成本记录。
 */
export interface CostEntry {
  /** ISO 8601 时间戳 */
  timestamp: string;
  /** 发起方 Agent ID（通过 dispatchAs 调用时有值，直接 dispatch 时为 undefined） */
  agentId?: string;
  /** 工具名称 */
  toolName: string;
  /** 所属 Service 名称 */
  serviceName: string;
  /** 本次调用的成本（USD） */
  cost: number;
  /** 是否调用成功 */
  success: boolean;
  /** 可选元数据 */
  metadata?: {
    /** 消耗的 token 数（适用于 Perplexity 等按 token 计费的服务） */
    tokensUsed?: number;
    /** 调用耗时（ms） */
    durationMs?: number;
    /** 处理的字符数（适用于按字符计费的服务） */
    charsProcessed?: number;
  };
}

/**
 * 成本汇总结果。
 */
export interface CostSummary {
  totalCost: number;
  totalCalls: number;
  successfulCalls: number;
  /** 按 Agent 分组的成本 */
  byAgent: Record<string, { cost: number; calls: number }>;
  /** 按 Tool 分组的成本 */
  byTool: Record<string, { cost: number; calls: number }>;
  /** 按 Service 分组的成本 */
  byService: Record<string, { cost: number; calls: number }>;
  /** 查询的日期范围 */
  dateRange: { start: string; end: string };
}

/**
 * Tool 调用请求。
 */
export interface DispatchRequest {
  toolName: string;
  serviceName?: string;
  args?: Record<string, unknown>;
  metadata?: {
    tokensUsed?: number;
    charsProcessed?: number;
  };
}

/**
 * Tool 调用结果。
 */
export interface DispatchResult {
  success: boolean;
  data?: unknown;
  error?: string;
}
