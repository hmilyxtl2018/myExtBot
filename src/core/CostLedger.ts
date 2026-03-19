import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { CostEntry, CostSummary } from "./types";

/**
 * Cost query filter.
 */
export interface CostQueryFilter {
  agentId?: string;
  toolName?: string;
  serviceName?: string;
  /** YYYY-MM-DD, filters to this exact date when specified */
  date?: string;
  /** Start date (inclusive), YYYY-MM-DD */
  startDate?: string;
  /** End date (inclusive), YYYY-MM-DD */
  endDate?: string;
  success?: boolean;
  limit?: number;
  offset?: number;
}

/**
 * CostLedger — records and queries tool call costs.
 *
 * Storage: in-memory CostEntry[] array, with async append to
 *          ~/.myextbot/costs/costs-YYYY-MM-DD.jsonl
 */
export class CostLedger {
  private entries: CostEntry[] = [];
  private readonly logDir: string;

  constructor(logDir?: string) {
    this.logDir = logDir ?? path.join(os.homedir(), ".myextbot", "costs");
  }

  /**
   * Record a cost entry (in-memory + async file write).
   */
  async record(entry: CostEntry): Promise<void> {
    this.entries.push(entry);
    this.appendToFile(entry).catch((err) => {
      console.warn("[CostLedger] Failed to write cost entry to file:", err);
    });
  }

  /** recordCost compatibility method for ContractEnforcer.
   * Uses "unknown" as placeholder for toolName and serviceName since the
   * caller doesn't have that context. Cost is tracked by agentId only.
   */
  recordCost(agentId: string, cost: number): void {
    const entry: CostEntry = {
      timestamp: new Date().toISOString(),
      agentId,
      toolName: "unknown",
      serviceName: "unknown",
      cost,
      success: true,
    };
    this.entries.push(entry);
  }

  /**
   * Query cost entries.
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
   * Generate a cost summary report.
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

      const agentKey = entry.agentId ?? "(direct)";
      if (!byAgent[agentKey]) byAgent[agentKey] = { cost: 0, calls: 0 };
      byAgent[agentKey].cost += entry.cost;
      byAgent[agentKey].calls++;

      if (!byTool[entry.toolName]) byTool[entry.toolName] = { cost: 0, calls: 0 };
      byTool[entry.toolName].cost += entry.cost;
      byTool[entry.toolName].calls++;

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
   * Query today's accumulated cost for a specific agent.
   */
  getDailyCostForAgent(agentId: string, date?: string): number {
    const today = date ?? new Date().toISOString().slice(0, 10);
    const entries = this.query({ agentId, date: today });
    return entries.reduce((sum, e) => sum + e.cost, 0);
  }

  /**
   * Alias for getDailyCostForAgent (used by ContractEnforcer).
   */
  getDailyCost(agentId: string): number {
    return this.getDailyCostForAgent(agentId);
  }

  /**
   * Count entries matching the filter (without pagination).
   */
  count(filter?: Omit<CostQueryFilter, "limit" | "offset">): number {
    return this.query(filter).length;
  }

  /**
   * Get all recorded entries.
   */
  getAll(): CostEntry[] {
    return [...this.entries];
  }

  /**
   * Async append a JSON Lines entry to the cost log file.
   */
  private async appendToFile(entry: CostEntry): Promise<void> {
    const date = entry.timestamp.slice(0, 10);
    const filePath = path.join(this.logDir, `costs-${date}.jsonl`);

    await fs.promises.mkdir(this.logDir, { recursive: true });
    await fs.promises.appendFile(filePath, JSON.stringify(entry) + "\n", "utf8");
  }
}
