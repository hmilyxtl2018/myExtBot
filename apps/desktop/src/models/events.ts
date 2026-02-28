/** Agent lifecycle states */
export type AgentStatus =
  | "Idle"
  | "Thinking"
  | "WaitingApproval"
  | "RunningTool"
  | "Stopped"
  | "Completed"
  | "Failed";

/** A tool call proposed by the agent, awaiting user approval */
export interface ToolCallRequest {
  id: string;
  tool: string;
  params: Record<string, unknown>;
  /** Risk level hint from the agent */
  risk: "low" | "medium" | "high";
  /** Human-readable description of what the tool will do */
  description: string;
  timestamp: string;
}

/** Result after a tool call completes */
export interface ToolCallResult {
  id: string;
  tool: string;
  success: boolean;
  output?: unknown;
  error?: string;
  duration_ms: number;
  timestamp: string;
}

/** A chat message from user or agent */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
}

/** A plan step produced by the agent */
export interface PlanStep {
  id: string;
  index: number;
  description: string;
  status: "pending" | "running" | "done" | "failed" | "skipped";
}

/** Union of all events emitted by the backend */
export type AgentEvent =
  | { type: "StatusChanged"; status: AgentStatus }
  | { type: "ChatMessage"; message: ChatMessage }
  | { type: "PlanUpdated"; steps: PlanStep[] }
  | { type: "ToolCallRequest"; request: ToolCallRequest }
  | { type: "ToolCallResult"; result: ToolCallResult }
  | { type: "AuditEntry"; entry: AuditEntry }
  | { type: "EmergencyStop" };

/** An audit log entry */
export interface AuditEntry {
  id: string;
  session_id: string;
  event_type: string;
  payload: unknown;
  timestamp: string;
}
