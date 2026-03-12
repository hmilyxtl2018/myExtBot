// ─── Agent Lifecycle Types ───────────────────────────────────────────────────

/**
 * Agent 的生命周期状态。
 */
export type AgentStatus =
  | "initializing"  // 正在启动/加载（plugin 安装中、配置检查中）
  | "active"        // 就绪，随时可被调用
  | "busy"          // 正在执行任务（可配置是否排队）
  | "sleeping"      // 暂时挂起（API key 失效、账单问题、手动维护）
  | "retired";      // 永久停用（终态，历史记录保留，不可再调用）

/**
 * Agent 的实时生命周期档案。
 */
export interface AgentLifecycleRecord {
  agentId: string;
  /** 当前状态 */
  status: AgentStatus;
  /** 上次状态变更时间 ISO 8601 */
  since: string;
  /** 当前状态的原因说明 */
  reason?: string;
  /**
   * sleeping 状态的预计恢复时间 ISO 8601。
   * 到达此时间时，系统自动将状态切换回 active（可选实现）。
   */
  resumeAt?: string;
  /** 当前排队/执行中的任务数（busy 状态时 > 0） */
  taskCount: number;
}

/**
 * 状态变更历史记录的单条条目。
 */
export interface AgentLifecycleHistoryEntry {
  agentId: string;
  fromStatus: AgentStatus;
  toStatus: AgentStatus;
  timestamp: string;
  reason?: string;
  triggeredBy?: "manual" | "health-monitor" | "sla-enforcer" | "system";
}

// ─── Core Agent/Service Types ─────────────────────────────────────────────────

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolCallRequest {
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  toolName: string;
  result: unknown;
  error?: string;
}

export interface McpService {
  id: string;
  name: string;
  tools: ToolDefinition[];
  call(request: ToolCallRequest): Promise<ToolResult>;
}

export interface AgentProfile {
  id: string;
  name: string;
  description?: string;
  allowedServices: string[];
  canDelegateTo?: string[];
}

export interface DelegationLogEntry {
  timestamp: string;
  fromAgent: string;
  toAgent: string;
  toolName: string;
  arguments: Record<string, unknown>;
  result?: ToolResult;
  durationMs?: number;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  services: McpService[];
}
