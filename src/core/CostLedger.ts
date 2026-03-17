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
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { CostEntry, CostSummary } from "./types";

/**
 * 成本查询过滤器。
 */
export interface CostQueryFilter {
  agentId?: string;
  toolName?: string;
  serviceName?: string;
  /** YYYY-MM-DD，不传则不限日期 */
  date?: string;
  /** 起始日期（含），YYYY-MM-DD */
  startDate?: string;
  /** 结束日期（含），YYYY-MM-DD */
  endDate?: string;
  success?: boolean;
  limit?: number;
  offset?: number;
}

/**
 * CostLedger — 记录和查询工具调用成本。
 *
 * 存储：内存中维护 CostEntry[]，同时异步追加写入
 *       ~/.myextbot/costs/costs-YYYY-MM-DD.jsonl（与 DelegationLogWriter 同目录策略）
 *
 * 注意：写入失败不影响主流程（try/catch，只 console.warn）
 */
export class CostLedger {
  private entries: CostEntry[] = [];
  private readonly logDir: string;

  constructor(logDir?: string) {
    this.logDir = logDir ?? path.join(os.homedir(), ".myextbot", "costs");
  }

  /**
   * 记录一条成本条目（内存 + 异步写文件）。
   */
  async record(entry: CostEntry): Promise<void> {
    this.entries.push(entry);
    this.appendToFile(entry).catch((err) => {
      console.warn("[CostLedger] Failed to write cost entry to file:", err);
    });
  }

  /**
   * 查询成本条目。
   */
  query(filter?: CostQueryFilter): CostEntry[] {
    let result = this.entries;

    if (filter) {
      if (filter.agentId !== undefined) {
        result = result.filter((e) => e.agentId === filter.agentId);
      }
      if (filter.toolName !== undefined) {
        result = result.filter((e) => e.toolName === filter.toolName);
      }
      if (filter.serviceName !== undefined) {
        result = result.filter((e) => e.serviceName === filter.serviceName);
      }
      if (filter.success !== undefined) {
        result = result.filter((e) => e.success === filter.success);
      }

      const dateStr = filter.date;
      const startDate = filter.startDate;
      const endDate = filter.endDate;

      if (dateStr) {
        result = result.filter((e) => e.timestamp.startsWith(dateStr));
      } else if (startDate || endDate) {
        result = result.filter((e) => {
          const d = e.timestamp.slice(0, 10);
          if (startDate && d < startDate) return false;
          if (endDate && d > endDate) return false;
          return true;
        });
      }

      const offset = filter.offset ?? 0;
      const limit = filter.limit;
      if (limit !== undefined) {
        result = result.slice(offset, offset + limit);
      } else if (offset > 0) {
        result = result.slice(offset);
      }
    }

    return result;
  }

  /**
   * 生成成本汇总报告。
   */
  summarize(filter?: Omit<CostQueryFilter, "limit" | "offset">): CostSummary {
    const entries = this.query(filter);

    const byAgent: Record<string, { cost: number; calls: number }> = {};
    const byTool: Record<string, { cost: number; calls: number }> = {};
    const byService: Record<string, { cost: number; calls: number }> = {};

    let totalCost = 0;
    let successfulCalls = 0;

    for (const entry of entries) {
      totalCost += entry.cost;
      if (entry.success) successfulCalls++;

      // byAgent
      const agentKey = entry.agentId ?? "(direct)";
      if (!byAgent[agentKey]) byAgent[agentKey] = { cost: 0, calls: 0 };
      byAgent[agentKey].cost += entry.cost;
      byAgent[agentKey].calls++;

      // byTool
      if (!byTool[entry.toolName]) byTool[entry.toolName] = { cost: 0, calls: 0 };
      byTool[entry.toolName].cost += entry.cost;
      byTool[entry.toolName].calls++;

      // byService
      if (!byService[entry.serviceName]) byService[entry.serviceName] = { cost: 0, calls: 0 };
      byService[entry.serviceName].cost += entry.cost;
      byService[entry.serviceName].calls++;
    }

    const timestamps = entries.map((e) => e.timestamp).sort();
    const start = timestamps[0] ?? new Date().toISOString();
    const end = timestamps[timestamps.length - 1] ?? new Date().toISOString();

    return {
      totalCost,
      totalCalls: entries.length,
      successfulCalls,
      byAgent,
      byTool,
      byService,
      dateRange: { start, end },
    };
  }

  /**
   * 查询指定 Agent 在今日的累计成本。
   * （M8 ContractEnforcer 会调用此方法）
   */
  getDailyCostForAgent(agentId: string, date?: string): number {
    const today = date ?? new Date().toISOString().slice(0, 10);
    const entries = this.query({ agentId, date: today });
    return entries.reduce((sum, e) => sum + e.cost, 0);
  }

  /**
   * 统计符合条件的条目数（不分页）。
   */
  count(filter?: Omit<CostQueryFilter, "limit" | "offset">): number {
    return this.query(filter).length;
  }

  /**
   */
  getAll(): CostEntry[] {
    return [...this.entries];
  }

  /**
   * 异步追加写入 JSON Lines 文件。
   */
  private async appendToFile(entry: CostEntry): Promise<void> {
    const date = entry.timestamp.slice(0, 10);
    const filePath = path.join(this.logDir, `costs-${date}.jsonl`);

    await fs.promises.mkdir(this.logDir, { recursive: true });
    await fs.promises.appendFile(filePath, JSON.stringify(entry) + "\n", "utf8");
  }
}
