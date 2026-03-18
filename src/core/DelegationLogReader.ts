import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { DelegationLogEntry } from "./types";

/**
 * Filter options for querying delegation log entries.
 */
export interface DelegationLogFilter {
  /** Match entries where fromAgentId or toAgentId equals this value. */
  agentId?: string;
  toolName?: string;
  /** YYYY-MM-DD date to read. Defaults to today if omitted. */
  date?: string;
  success?: boolean;
  /** Maximum number of results to return. Defaults to 100. */
  limit?: number;
  /** Number of results to skip. Defaults to 0. */
  offset?: number;
}

/**
 * DelegationLogReader — 从 JSON Lines 文件读取并过滤 DelegationLogEntry。
 */
export class DelegationLogReader {
  private readonly logDir: string;

  constructor(logDir?: string) {
    this.logDir =
      logDir ??
      process.env["MYEXTBOT_LOG_DIR"] ??
      path.join(os.homedir(), ".myextbot", "logs");
  }

  /**
   * 读取指定日期（或今日）的日志文件，按过滤条件返回结果。
   * 文件不存在时返回空数组（不抛错）。
   */
  async query(filter?: DelegationLogFilter): Promise<DelegationLogEntry[]> {
    const date = filter?.date ?? this._todayDateString();
    const filePath = this._getLogPathForDate(date);

    const entries = await this._readFile(filePath);
    return this._applyFilter(entries, filter);
  }

  /**
   * 返回日志目录下所有 .jsonl 文件对应的日期列表（降序）。
   */
  async listAvailableDates(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.logDir);
      const dates = files
        .map((f) => {
          const m = f.match(/^delegation-(\d{4}-\d{2}-\d{2})\.jsonl$/);
          return m ? m[1] : null;
        })
        .filter((d): d is string => d !== null)
        .sort()
        .reverse();
      return dates;
    } catch {
      return [];
    }
  }

  /**
   * 跨日期查询：读取多天的日志并合并过滤。
   */
  async queryRange(
    startDate: string,
    endDate: string,
    filter?: Omit<DelegationLogFilter, "date">
  ): Promise<DelegationLogEntry[]> {
    const dates = await this.listAvailableDates();
    const relevant = dates.filter((d) => d >= startDate && d <= endDate);

    const allEntries: DelegationLogEntry[] = [];
    for (const date of relevant) {
      const filePath = this._getLogPathForDate(date);
      const entries = await this._readFile(filePath);
      allEntries.push(...entries);
    }

    return this._applyFilter(allEntries, filter);
  }

  private async _readFile(filePath: string): Promise<DelegationLogEntry[]> {
    try {
      const content = await fs.readFile(filePath, "utf8");
      const entries: DelegationLogEntry[] = [];
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          entries.push(JSON.parse(trimmed) as DelegationLogEntry);
        } catch {
          // Skip malformed lines
        }
      }
      return entries;
    } catch {
      return [];
    }
  }

  private _applyFilter(
    entries: DelegationLogEntry[],
    filter?: Omit<DelegationLogFilter, "date">
  ): DelegationLogEntry[] {
    let result = entries;

    if (filter?.agentId !== undefined) {
      const id = filter.agentId;
      result = result.filter(
        (e) => e.fromAgentId === id || e.toAgentId === id
      );
    }
    if (filter?.toolName !== undefined) {
      const name = filter.toolName;
      result = result.filter((e) => e.toolName === name);
    }
    if (filter?.success !== undefined) {
      const ok = filter.success;
      result = result.filter((e) => e.success === ok);
    }

    const offset = filter?.offset ?? 0;
    const limit = filter?.limit ?? 100;
    return result.slice(offset, offset + limit);
  }

  private _getLogPathForDate(date: string): string {
    return path.join(this.logDir, `delegation-${date}.jsonl`);
  }

  private _todayDateString(): string {
    return new Date().toISOString().slice(0, 10);
  }
}
