import { CostEntry, CostSummary, DispatchRequest, DispatchResult } from "./types";
import { CostLedger, CostQueryFilter } from "./CostLedger";
import { calculateCost } from "../config/toolCosts";

/**
 * McpServiceListManager — 管理 MCP 服务列表，负责工具调用分发与成本记录。
 *
 * - dispatch()     直接调用工具（agentId 为 undefined）
 * - dispatchAs()   以指定 Agent 身份调用工具（记录 agentId）
 * - 两者均记录 durationMs 和成本到 CostLedger
 */
export class McpServiceListManager {
  private costLedger = new CostLedger();

  /**
   * 直接调用工具（不指定 Agent，agentId 记为 undefined）。
   */
  async dispatch(request: DispatchRequest): Promise<DispatchResult> {
    const startTime = Date.now();
    let result: DispatchResult;

    try {
      result = await this.executeToolCall(request);
    } catch (err) {
      result = {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    const durationMs = Date.now() - startTime;
    const cost = calculateCost(request.toolName, request.metadata);

    await this.costLedger.record({
      timestamp: new Date().toISOString(),
      agentId: undefined,
      toolName: request.toolName,
      serviceName: request.serviceName ?? "unknown",
      cost,
      success: result.success,
      metadata: {
        ...request.metadata,
        durationMs,
      },
    });

    return result;
  }

  /**
   * 以指定 Agent 身份调用工具（记录 agentId）。
   */
  async dispatchAs(agentId: string, request: DispatchRequest): Promise<DispatchResult> {
    const startTime = Date.now();
    let result: DispatchResult;

    try {
      result = await this.executeToolCall(request);
    } catch (err) {
      result = {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    const durationMs = Date.now() - startTime;
    const cost = calculateCost(request.toolName, request.metadata);

    await this.costLedger.record({
      timestamp: new Date().toISOString(),
      agentId,
      toolName: request.toolName,
      serviceName: request.serviceName ?? "unknown",
      cost,
      success: result.success,
      metadata: {
        ...request.metadata,
        durationMs,
      },
    });

    return result;
  }

  /**
   * 获取成本账本实例（供 M8 ContractEnforcer 使用）。
   */
  getCostLedger(): CostLedger {
    return this.costLedger;
  }

  /**
   * 获取成本汇总报告。
   */
  getCostSummary(filter?: CostQueryFilter): CostSummary {
    return this.costLedger.summarize(filter);
  }

  /**
   * 执行工具调用（模拟实现，实际接入真实服务时替换此方法）。
   */
  private async executeToolCall(request: DispatchRequest): Promise<DispatchResult> {
    // Simulate async tool execution
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Mock success response
    return {
      success: true,
      data: {
        toolName: request.toolName,
        args: request.args ?? {},
        result: `[mock] Tool '${request.toolName}' executed successfully.`,
      },
    };
  }
}
