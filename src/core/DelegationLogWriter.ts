import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { DelegationLogEntry } from "./types";

/**
 * DelegationLogWriter — 将 DelegationLogEntry 追加写入 JSON Lines 文件。
 *
 * 文件路径规则：
 *   ${logDir}/delegation-YYYY-MM-DD.jsonl
 *
 * logDir 优先级：
 *   1. 构造函数参数
 *   2. 环境变量 MYEXTBOT_LOG_DIR
 *   3. 默认值 ~/.myextbot/logs
 */
export class DelegationLogWriter {
  private readonly logDir: string;

  constructor(logDir?: string) {
    this.logDir =
      logDir ??
      process.env["MYEXTBOT_LOG_DIR"] ??
      path.join(os.homedir(), ".myextbot", "logs");
  }

  /**
   * 追加一条日志记录到当日的 .jsonl 文件。
   * 文件不存在时自动创建（包括目录）。
   * 使用 fs.appendFile（追加，不覆盖）。
   */
  async append(entry: DelegationLogEntry): Promise<void> {
    try {
      await fs.mkdir(this.logDir, { recursive: true });
      const filePath = this.getTodayLogPath();
      await fs.appendFile(filePath, JSON.stringify(entry) + "\n", "utf8");
    } catch (err) {
      console.warn(
        "[DelegationLogWriter] Failed to persist log entry:",
        (err as Error).message
      );
    }
  }

  /** 返回今日日志文件的完整路径 */
  getTodayLogPath(): string {
    return this.getLogPathForDate(this._todayDateString());
  }

  /** 返回指定日期的日志文件路径 (date 格式：YYYY-MM-DD) */
  getLogPathForDate(date: string): string {
    return path.join(this.logDir, `delegation-${date}.jsonl`);
  }

  private _todayDateString(): string {
    return new Date().toISOString().slice(0, 10);
  }
}
