import {
  AgentStatus,
  AgentLifecycleRecord,
  AgentLifecycleHistoryEntry,
} from "./types";

/**
 * AgentLifecycleManager — 管理所有 Agent 的生命周期状态机。
 *
 * 合法的状态转换路径：
 * initializing → active
 * initializing → sleeping   (启动时发现配置错误)
 * active       → busy       (开始执行任务)
 * active       → sleeping   (手动挂起 / API key 失效)
 * active       → retired    (手动退休)
 * busy         → active     (任务完成)
 * busy         → sleeping   (任务执行中 API key 失效)
 * sleeping     → active     (手动唤醒 / API key 恢复)
 * sleeping     → retired    (决定永久停用)
 * retired      → (终态，不允许任何转出)
 *
 * 非法转换示例（应 throw Error）：
 * retired → active
 * busy → retired
 * initializing → busy
 */

const VALID_TRANSITIONS: Record<AgentStatus, AgentStatus[]> = {
  initializing: ["active", "sleeping"],
  active: ["busy", "sleeping", "retired"],
  busy: ["active", "sleeping"],
  sleeping: ["active", "retired"],
  retired: [],
};

export class AgentLifecycleManager {
  private records = new Map<string, AgentLifecycleRecord>();
  private history: AgentLifecycleHistoryEntry[] = [];

  /**
   * 初始化一个 Agent 的生命周期记录（状态设为 "active"）。
   * 若 Agent 已存在，不覆盖。
   */
  init(agentId: string): void {
    if (this.records.has(agentId)) {
      return;
    }
    this.records.set(agentId, {
      agentId,
      status: "active",
      since: new Date().toISOString(),
      taskCount: 0,
    });
  }

  /**
   * 获取 Agent 当前的生命周期档案。
   * 若 Agent 未初始化，返回 status: "active" 的默认记录（兼容旧代码）。
   */
  getRecord(agentId: string): AgentLifecycleRecord {
    const record = this.records.get(agentId);
    if (!record) {
      return {
        agentId,
        status: "active",
        since: new Date().toISOString(),
        taskCount: 0,
      };
    }
    return record;
  }

  /**
   * 获取所有 Agent 的生命周期档案。
   */
  getAllRecords(): AgentLifecycleRecord[] {
    return Array.from(this.records.values());
  }

  /**
   * 执行状态转换。
   *
   * @param agentId Agent ID
   * @param newStatus 目标状态
   * @param reason 转换原因（可选）
   * @param triggeredBy 触发来源（默认 "manual"）
   * @throws Error 若转换路径不合法
   */
  transition(
    agentId: string,
    newStatus: AgentStatus,
    reason?: string,
    triggeredBy: AgentLifecycleHistoryEntry["triggeredBy"] = "manual"
  ): void {
    const record = this.getRecord(agentId);
    const fromStatus = record.status;

    if (!this.isValidTransition(fromStatus, newStatus)) {
      throw new Error(
        `Invalid lifecycle transition for agent "${agentId}": ` +
          `"${fromStatus}" → "${newStatus}" is not allowed.`
      );
    }

    const now = new Date().toISOString();

    const updatedRecord: AgentLifecycleRecord = {
      ...record,
      status: newStatus,
      since: now,
      reason,
      // Reset taskCount when leaving busy state (sleeping/retired interrupts tasks)
      taskCount: newStatus === "busy" ? record.taskCount : 0,
    };

    this.records.set(agentId, updatedRecord);

    this.history.push({
      agentId,
      fromStatus,
      toStatus: newStatus,
      timestamp: now,
      reason,
      triggeredBy,
    });
  }

  /**
   * 检查 Agent 是否可以接受新的调用。
   * active = true, busy = true（排队）, sleeping/retired/initializing = false
   */
  isCallable(agentId: string): boolean {
    const record = this.getRecord(agentId);
    return record.status === "active" || record.status === "busy";
  }

  /**
   * 标记 Agent 开始执行任务（active → busy）。
   * 若已是 busy，只增加 taskCount。
   */
  markBusy(agentId: string): void {
    const record = this.getRecord(agentId);

    if (record.status === "busy") {
      // Already busy — just increment taskCount
      this.records.set(agentId, {
        ...record,
        taskCount: record.taskCount + 1,
      });
      return;
    }

    if (record.status === "active") {
      const now = new Date().toISOString();
      this.records.set(agentId, {
        ...record,
        status: "busy",
        since: now,
        taskCount: 1,
      });
      this.history.push({
        agentId,
        fromStatus: "active",
        toStatus: "busy",
        timestamp: now,
        triggeredBy: "system",
      });
      return;
    }

    throw new Error(
      `Cannot mark agent "${agentId}" as busy: current status is "${record.status}".`
    );
  }

  /**
   * 标记 Agent 完成一个任务（taskCount--，若 taskCount == 0 → active）。
   */
  markTaskComplete(agentId: string): void {
    const record = this.getRecord(agentId);

    if (record.status !== "busy") {
      // If not busy, nothing to do
      return;
    }

    const newTaskCount = Math.max(0, record.taskCount - 1);

    if (newTaskCount === 0) {
      const now = new Date().toISOString();
      this.records.set(agentId, {
        ...record,
        status: "active",
        since: now,
        taskCount: 0,
      });
      this.history.push({
        agentId,
        fromStatus: "busy",
        toStatus: "active",
        timestamp: now,
        triggeredBy: "system",
      });
    } else {
      this.records.set(agentId, {
        ...record,
        taskCount: newTaskCount,
      });
    }
  }

  /**
   * 获取指定 Agent 的状态变更历史记录（降序）。
   * @param limit 最多返回多少条（默认 50）
   */
  getHistory(agentId: string, limit = 50): AgentLifecycleHistoryEntry[] {
    const entries = this.history
      .filter((e) => e.agentId === agentId)
      .reverse();
    return entries.slice(0, limit);
  }

  /**
   * 获取所有 Agent 的状态变更历史。
   */
  getAllHistory(limit = 50): AgentLifecycleHistoryEntry[] {
    return [...this.history].reverse().slice(0, limit);
  }

  /**
   * 检查一个状态转换是否合法。
   */
  private isValidTransition(from: AgentStatus, to: AgentStatus): boolean {
    return VALID_TRANSITIONS[from].includes(to);
  }
}
