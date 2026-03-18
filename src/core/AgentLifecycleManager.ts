import {
  AgentStatus,
  AgentLifecycleRecord,
  AgentLifecycleHistoryEntry,
} from "./types";

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

  init(agentId: string): void {
    if (this.records.has(agentId)) return;
    this.records.set(agentId, {
      agentId,
      status: "active",
      since: new Date().toISOString(),
      taskCount: 0,
    });
  }

  getRecord(agentId: string): AgentLifecycleRecord {
    return this.records.get(agentId) ?? {
      agentId,
      status: "active",
      since: new Date().toISOString(),
      taskCount: 0,
    };
  }

  getAllRecords(): AgentLifecycleRecord[] {
    return Array.from(this.records.values());
  }

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
    this.records.set(agentId, {
      ...record,
      status: newStatus,
      since: now,
      reason,
      taskCount: newStatus === "busy" ? record.taskCount : 0,
    });

    this.history.push({
      agentId,
      fromStatus,
      toStatus: newStatus,
      timestamp: now,
      reason,
      triggeredBy,
    });
  }

  isCallable(agentId: string): boolean {
    const record = this.getRecord(agentId);
    return record.status === "active" || record.status === "busy";
  }

  markBusy(agentId: string): void {
    const record = this.getRecord(agentId);
    if (record.status === "busy") {
      this.records.set(agentId, { ...record, taskCount: record.taskCount + 1 });
      return;
    }
    if (record.status === "active") {
      const now = new Date().toISOString();
      this.records.set(agentId, { ...record, status: "busy", since: now, taskCount: 1 });
      this.history.push({ agentId, fromStatus: "active", toStatus: "busy", timestamp: now, triggeredBy: "system" });
      return;
    }
    throw new Error(`Cannot mark agent "${agentId}" as busy: current status is "${record.status}".`);
  }

  markTaskComplete(agentId: string): void {
    const record = this.getRecord(agentId);
    if (record.status !== "busy") return;
    const newTaskCount = Math.max(0, record.taskCount - 1);
    if (newTaskCount === 0) {
      const now = new Date().toISOString();
      this.records.set(agentId, { ...record, status: "active", since: now, taskCount: 0 });
      this.history.push({ agentId, fromStatus: "busy", toStatus: "active", timestamp: now, triggeredBy: "system" });
    } else {
      this.records.set(agentId, { ...record, taskCount: newTaskCount });
    }
  }

  getHistory(agentId: string, limit = 50): AgentLifecycleHistoryEntry[] {
    return this.history.filter((e) => e.agentId === agentId).reverse().slice(0, limit);
  }

  getAllHistory(limit = 50): AgentLifecycleHistoryEntry[] {
    return [...this.history].reverse().slice(0, limit);
  }

  private isValidTransition(from: AgentStatus, to: AgentStatus): boolean {
    return VALID_TRANSITIONS[from].includes(to);
  }
}
