import { AgentState } from "../types";

interface AgentStatusBadgeProps {
  state: AgentState;
}

const STATE_LABELS: Record<AgentState, string> = {
  idle: "Idle",
  thinking: "Thinking…",
  waiting_approval: "Waiting Approval",
  running_tool: "Running Tool",
  completed: "Completed",
  failed: "Failed",
};

const STATE_COLORS: Record<AgentState, string> = {
  idle: "#6b7280",
  thinking: "#3b82f6",
  waiting_approval: "#f59e0b",
  running_tool: "#8b5cf6",
  completed: "#10b981",
  failed: "#ef4444",
};

export function AgentStatusBadge({ state }: AgentStatusBadgeProps) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "4px 12px",
        borderRadius: "9999px",
        backgroundColor: STATE_COLORS[state],
        color: "#fff",
        fontWeight: 600,
        fontSize: "0.85rem",
      }}
    >
      {STATE_LABELS[state]}
    </span>
  );
}
