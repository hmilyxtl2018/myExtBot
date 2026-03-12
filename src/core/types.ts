/**
 * Core types for myExtBot digital asset system.
 */

/**
 * A single tool invocation request.
 */
export interface ToolCall {
  toolName: string;
  arguments: Record<string, unknown>;
}

/**
 * The result of a tool invocation.
 */
export interface ToolResult {
  success: boolean;
  output?: unknown;
  error?: string;
  /** Estimated cost in USD for this call (optional, populated by CostLedger integration) */
  estimatedCost?: number;
}

/**
 * Definition of a tool exposed by a service.
 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
  /** Estimated cost per call in USD (optional, used by ContractEnforcer) */
  estimatedCostPerCall?: number;
}

/**
 * Agent SLA 合约。
 */
export interface AgentContract {
  /** 绑定的 Agent ID */
  agentId: string;

  sla: {
    /** 单次调用最大响应时间（ms）。超时后返回超时错误 */
    maxResponseTimeMs?: number;

    /** 单次调用最大成本（USD）。执行前基于工具成本配置估算，超限则拒绝 */
    maxCostPerCall?: number;

    /** 单 Agent 每日累计成本上限（USD）。需与 CostLedger 联动 */
    maxDailyCost?: number;

    /** 每分钟最大调用次数（滑动窗口） */
    maxCallsPerMinute?: number;

    /**
     * 重试策略：
     * - "none"：不重试
     * - "once"：失败后重试一次
     * - "exponential-backoff"：指数退避，最多重试 3 次（延迟：1s, 2s, 4s）
     */
    retryPolicy?: "none" | "once" | "exponential-backoff";
  };

  fallback?: {
    /** SLA 违约时转给哪个 Agent */
    agentId?: string;
    /** 超时时是否返回已有的部分结果（而不是报错） */
    returnPartialResult?: boolean;
  };

  alertThresholds?: {
    /** 成本/调用次数达到上限的此比例时发出 warn 日志 */
    warnAt?: number; // 例：0.8 = 80%
  };
}

/**
 * 单次合约执行的检查结果。
 */
export interface ContractCheckResult {
  allowed: boolean;
  /** 若 allowed === false，说明是哪条规则触发了拒绝 */
  violatedRule?: "timeout" | "cost-per-call" | "daily-cost" | "rate-limit";
  reason?: string;
}
