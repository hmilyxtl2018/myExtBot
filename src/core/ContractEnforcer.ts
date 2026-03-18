import { AgentContract, ContractCheckResult, ToolResult } from "./types";
import { CostLedger } from "./CostLedger";

/** Tool cost estimates per tool name (USD). Used for pre-call cost estimation. */
const DEFAULT_TOOL_COSTS: Record<string, number> = {
  search_web: 0.001,
  search_perplexity: 0.005,
  crawl_page: 0.002,
  extract_structured: 0.003,
  run_code: 0.002,
};

/**
 * ContractEnforcer — 在 dispatchAs() 外层执行 SLA 合约守卫。
 *
 * 使用方式：
 * const enforcer = new ContractEnforcer(costLedger);
 * const result = await enforcer.enforce(contract, agentId, toolName, () => manager.dispatchAs(agentId, toolCall));
 */
export class ContractEnforcer {
  /** agentId → array of call timestamps (ms) */
  private callTimestamps = new Map<string, number[]>();

  constructor(private costLedger?: CostLedger) {}

  /**
   * 执行合约检查 + 工具调用。
   *
   * 执行顺序：
   * 1. 频率检查（maxCallsPerMinute）
   * 2. 成本预估检查（maxCostPerCall）
   * 3. 日累计成本检查（maxDailyCost，需 costLedger）
   * 4. 带超时的工具调用（maxResponseTimeMs）
   * 5. 根据 retryPolicy 决定是否重试
   * 6. 若失败且有 fallback.agentId，委托给 fallback
   */
  async enforce(
    contract: AgentContract,
    agentId: string,
    toolName: string,
    execute: () => Promise<ToolResult>,
    fallbackExecute?: () => Promise<ToolResult>
  ): Promise<ToolResult> {
    // Pre-checks
    const preCheck = this.preCheck(contract, agentId, toolName);
    if (!preCheck.allowed) {
      const result: ToolResult = {
        success: false,
        error: `SLA contract violation [${preCheck.violatedRule}]: ${preCheck.reason}`,
      };

      // Attempt fallback if configured
      if (fallbackExecute) {
        console.warn(`[ContractEnforcer] Pre-check failed for agent "${agentId}", trying fallback`);
        return fallbackExecute();
      }
      return result;
    }

    // Record call for rate limiting
    this.recordCall(agentId);

    // Warn at threshold
    this.checkAlertThresholds(contract, agentId, toolName);

    // Execute with timeout + retry
    const policy = contract.sla.retryPolicy ?? "none";
    const timeoutMs = contract.sla.maxResponseTimeMs;

    const wrappedExecute = (): Promise<ToolResult> => {
      const p = execute();
      return timeoutMs !== undefined ? this.withTimeout(p, timeoutMs) : p;
    };

    let result: ToolResult;
    try {
      result = await this.withRetry(wrappedExecute, policy);
    } catch (err) {
      const errMsg = (err as Error).message ?? String(err);
      const isTimeout = errMsg.toLowerCase().includes("timeout");
      result = { success: false, error: errMsg };

      // Check if partial result is preferred on timeout
      if (isTimeout && contract.fallback?.returnPartialResult) {
        result = { success: false, error: errMsg, output: null };
      }
    }

    // On failure, try fallback agent
    if (!result.success && fallbackExecute) {
      console.warn(
        `[ContractEnforcer] Agent "${agentId}" failed (${result.error}), trying fallback`
      );
      return fallbackExecute();
    }

    // Track cost
    if (result.success && result.estimatedCost !== undefined && this.costLedger) {
      this.costLedger.recordCost(agentId, result.estimatedCost);
    } else if (result.success && this.costLedger) {
      const estimated = DEFAULT_TOOL_COSTS[toolName] ?? 0;
      if (estimated > 0) {
        this.costLedger.recordCost(agentId, estimated);
      }
    }

    return result;
  }

  /**
   * 仅做前置检查（不执行工具调用）。
   * 用于在调用前快速判断是否允许。
   */
  preCheck(contract: AgentContract, agentId: string, toolName: string): ContractCheckResult {
    // 1. Rate limit check
    const rateCheck = this.checkRateLimit(contract, agentId);
    if (!rateCheck.allowed) return rateCheck;

    // 2. Cost-per-call check
    if (contract.sla.maxCostPerCall !== undefined) {
      const estimatedCost = DEFAULT_TOOL_COSTS[toolName] ?? 0;
      if (estimatedCost > contract.sla.maxCostPerCall) {
        return {
          allowed: false,
          violatedRule: "cost-per-call",
          reason: `Estimated cost $${estimatedCost} exceeds maxCostPerCall $${contract.sla.maxCostPerCall}`,
        };
      }
    }

    // 3. Daily cost check
    if (contract.sla.maxDailyCost !== undefined && this.costLedger) {
      const dailyCost = this.costLedger.getDailyCost(agentId);
      if (dailyCost >= contract.sla.maxDailyCost) {
        return {
          allowed: false,
          violatedRule: "daily-cost",
          reason: `Daily cost $${dailyCost.toFixed(4)} has reached maxDailyCost $${contract.sla.maxDailyCost}`,
        };
      }
    }

    return { allowed: true };
  }

  /** 频率限制检查（滑动窗口实现） */
  private checkRateLimit(contract: AgentContract, agentId: string): ContractCheckResult {
    if (contract.sla.maxCallsPerMinute === undefined) return { allowed: true };

    const now = Date.now();
    const windowMs = 60_000;
    const timestamps = this.callTimestamps.get(agentId) ?? [];

    // Purge old timestamps outside the window
    const valid = timestamps.filter((t) => now - t < windowMs);
    this.callTimestamps.set(agentId, valid);

    if (valid.length >= contract.sla.maxCallsPerMinute) {
      return {
        allowed: false,
        violatedRule: "rate-limit",
        reason: `Rate limit exceeded: ${valid.length}/${contract.sla.maxCallsPerMinute} calls in the last minute`,
      };
    }

    return { allowed: true };
  }

  /** 带超时的 Promise 包装 */
  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`timeout: call exceeded ${timeoutMs}ms`));
      }, timeoutMs);

      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (err: unknown) => {
          clearTimeout(timer);
          reject(err);
        }
      );
    });
  }

  /** 指数退避重试 */
  private async withRetry(
    execute: () => Promise<ToolResult>,
    policy: string
  ): Promise<ToolResult> {
    if (policy === "none") {
      return execute();
    }

    if (policy === "once") {
      const first = await execute().catch((e: unknown) => ({
        success: false,
        error: (e as Error).message ?? String(e),
      }));
      if (first.success) return first;
      // Retry once
      return execute();
    }

    if (policy === "exponential-backoff") {
      const delays = [1000, 2000, 4000];
      let lastResult: ToolResult = { success: false, error: "not started" };
      for (let attempt = 0; attempt <= delays.length; attempt++) {
        try {
          lastResult = await execute();
          if (lastResult.success) return lastResult;
        } catch (err) {
          lastResult = { success: false, error: (err as Error).message ?? String(err) };
        }
        if (attempt < delays.length) {
          await this.sleep(delays[attempt]);
        }
      }
      return lastResult;
    }

    // Unknown policy — just execute once
    return execute();
  }

  /** 记录 agentId 的一次调用（用于滑动窗口计数） */
  private recordCall(agentId: string): void {
    const timestamps = this.callTimestamps.get(agentId) ?? [];
    timestamps.push(Date.now());
    this.callTimestamps.set(agentId, timestamps);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Check alert thresholds and emit warn log if approaching limits */
  private checkAlertThresholds(
    contract: AgentContract,
    agentId: string,
    toolName: string
  ): void {
    const warnAt = contract.alertThresholds?.warnAt;
    if (warnAt === undefined) return;

    // Check rate limit threshold
    if (contract.sla.maxCallsPerMinute !== undefined) {
      const now = Date.now();
      const valid = (this.callTimestamps.get(agentId) ?? []).filter((t) => now - t < 60_000);
      const ratio = valid.length / contract.sla.maxCallsPerMinute;
      if (ratio >= warnAt) {
        console.warn(
          `[ContractEnforcer] WARN: agent "${agentId}" rate usage at ${(ratio * 100).toFixed(1)}% (${valid.length}/${contract.sla.maxCallsPerMinute} calls/min)`
        );
      }
    }

    // Check daily cost threshold
    if (contract.sla.maxDailyCost !== undefined && this.costLedger) {
      const daily = this.costLedger.getDailyCost(agentId);
      const ratio = daily / contract.sla.maxDailyCost;
      if (ratio >= warnAt) {
        console.warn(
          `[ContractEnforcer] WARN: agent "${agentId}" daily cost at ${(ratio * 100).toFixed(1)}% ($${daily.toFixed(4)}/$${contract.sla.maxDailyCost})`
        );
      }
    }

    // Check cost-per-call threshold
    if (contract.sla.maxCostPerCall !== undefined) {
      const estimated = DEFAULT_TOOL_COSTS[toolName] ?? 0;
      if (contract.sla.maxCostPerCall > 0) {
        const ratio = estimated / contract.sla.maxCostPerCall;
        if (ratio >= warnAt) {
          console.warn(
            `[ContractEnforcer] WARN: agent "${agentId}" tool "${toolName}" estimated cost $${estimated} is at ${(ratio * 100).toFixed(1)}% of maxCostPerCall $${contract.sla.maxCostPerCall}`
          );
        }
      }
    }
  }
}
