/**
 * CostLedger — M5 成本账本。
 *
 * 跟踪每个 Agent 的日累计成本，供 ContractEnforcer 的 maxDailyCost 守卫使用。
 */
export class CostLedger {
  /** agentId → date string → cumulative cost (USD) */
  private ledger = new Map<string, Map<string, number>>();

  private todayKey(): string {
    return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
  }

  /** 记录一次工具调用的成本 */
  recordCost(agentId: string, cost: number): void {
    const day = this.todayKey();
    if (!this.ledger.has(agentId)) {
      this.ledger.set(agentId, new Map());
    }
    const agentMap = this.ledger.get(agentId)!;
    agentMap.set(day, (agentMap.get(day) ?? 0) + cost);
  }

  /** 查询某 Agent 今日累计成本 */
  getDailyCost(agentId: string): number {
    const day = this.todayKey();
    return this.ledger.get(agentId)?.get(day) ?? 0;
  }

  /** 查询某 Agent 总累计成本（所有日期） */
  getTotalCost(agentId: string): number {
    const agentMap = this.ledger.get(agentId);
    if (!agentMap) return 0;
    let total = 0;
    for (const cost of agentMap.values()) {
      total += cost;
    }
    return total;
  }

  /** 获取所有 Agent 的今日成本快照 */
  getDailySummary(): Record<string, number> {
    const day = this.todayKey();
    const result: Record<string, number> = {};
    for (const [agentId, agentMap] of this.ledger.entries()) {
      result[agentId] = agentMap.get(day) ?? 0;
    }
    return result;
  }
}
