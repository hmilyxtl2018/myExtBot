/** Agent lifecycle states */
export type AgentStatus =
  | "Idle"
  | "Planning"
  | "WaitingPlanApproval"
  | "Thinking"
  | "WaitingApproval"
  | "RunningTool"
  | "Stopped"
  | "Completed"
  | "Failed";

/** A chain-of-thought thinking step emitted by the agent */
export interface ThinkingStep {
  id: string;
  content: string;
  timestamp: string;
}

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

/** A plan step produced by the agent (for PlanUpdated — execution tracking) */
export interface PlanStep {
  id: string;
  index: number;
  description: string;
  status: "pending" | "running" | "done" | "failed" | "skipped";
}

/** An audit log entry */
export interface AuditEntry {
  id: string;
  session_id: string;
  event_type: string;
  payload: unknown;
  timestamp: string;
}

// ── RunGraph types ────────────────────────────────────────────────────────────

export type RunNodeKind = "tool_call" | "screenshot" | "verifier" | "user_message" | "agent_message";
export type RunNodeStatus = "pending" | "running" | "completed" | "failed" | "blocked";
export type EdgeKind = "control" | "data" | "verification";
export type ClaimResult = "pass" | "fail" | "skip";

export interface RunNode {
  id: string;
  session_id: string;
  kind: RunNodeKind;
  tool?: string;
  status: RunNodeStatus;
  confidence?: number;
  inputs?: unknown;
  outputs?: unknown;
  timestamp: string;
}

export interface RunEdge {
  id: string;
  session_id: string;
  src: string;
  dst: string;
  kind: EdgeKind;
  blocked: boolean;
  timestamp: string;
}

export interface VerifierClaim {
  id: string;
  session_id: string;
  run_node_id: string;
  verifier: string;
  result: ClaimResult;
  score?: number;
  detail?: string;
  timestamp: string;
}

export interface Intervention {
  id: string;
  session_id: string;
  kind: "block_edge" | "replace_artifact" | "insert_verifier";
  payload: unknown;
  timestamp: string;
/** A step in an AgentPlan produced by the Planner */
export interface AgentPlanStep {
  id: string;
  index: number;
  intent: string;
  tool: string;
  params_preview: Record<string, unknown>;
  depends_on: string[];
  risk: "low" | "medium" | "high";
  needs_credential?: string;
}

/** A structured plan produced by the Planner */
export interface AgentPlan {
  id: string;
  goal: string;
  steps: AgentPlanStep[];
  overall_risk: "low" | "medium" | "high";
  requires_credentials: string[];
}

/** Union of all events emitted by the backend */
export type AgentEvent =
  | { type: "StatusChanged"; status: AgentStatus }
  | { type: "ChatMessage"; message: ChatMessage }
  | { type: "PlanUpdated"; steps: PlanStep[] }
  | { type: "PlanningStarted" }
  | { type: "PlanReady"; plan: AgentPlan }
  | { type: "ToolCallRequest"; request: ToolCallRequest }
  | { type: "ToolCallResult"; result: ToolCallResult }
  | { type: "AuditEntry"; entry: AuditEntry }
  | { type: "AgentThinking"; step: ThinkingStep }
  | { type: "EmergencyStop" }
  // RunGraph events
  | { type: "GraphNodeAdded"; node: RunNode }
  | { type: "GraphNodeUpdated"; node: RunNode }
  | { type: "GraphEdgeAdded"; edge: RunEdge }
  | { type: "ArtifactCreated"; artifact_id: string; run_node_id: string; kind: string }
  | { type: "VerifierResult"; claim: VerifierClaim }
  | { type: "InterventionApplied"; intervention: Intervention };

