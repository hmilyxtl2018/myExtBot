/**
 * Type definitions mirroring the Rust AgentState enum and IPC event payloads.
 */

export type AgentState =
  | "idle"
  | "thinking"
  | "waiting_approval"
  | "running_tool"
  | "completed"
  | "failed";

export interface StateChangedPayload {
  state: AgentState;
}

export interface MessagePayload {
  role: "user" | "assistant" | "tool";
  content: string;
}

export interface ApprovalRequestedPayload {
  tool_name: string;
  args: Record<string, unknown>;
}

export interface ChatMessage {
  id: number;
  role: MessagePayload["role"];
  content: string;
}
