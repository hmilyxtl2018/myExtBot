import Icon from "./Icon";
import type { AgentEvent, AuditEntry } from "../models/events";

interface Props {
  events: AgentEvent[];
}

const EVENT_TYPE_LABEL: Record<string, string> = {
  "chat.message.sent":    "消息",
  "tool.call.completed":  "工具",
  "tool.call.approved":   "批准",
  "tool.call.denied":     "拒绝",
  "agent.status.changed": "状态",
};

function formatTime(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString("zh-CN", { hour12: false });
  } catch {
    return ts;
  }
}

export default function AuditTimeline({ events }: Props) {
  const entries: AuditEntry[] = events
    .filter((e): e is Extract<AgentEvent, { type: "AuditEntry" }> => e.type === "AuditEntry")
    .map((e) => e.entry);

  if (entries.length === 0) {
    return <p className="placeholder">暂无审计记录…</p>;
  }

  return (
    <ul className="audit-list">
      {entries.map((entry) => (
        <li key={entry.id} className="audit-item">
          <Icon name="schedule" size={12} className="audit-icon" />
          <div className="audit-body">
            <span className="audit-type-badge">
              {EVENT_TYPE_LABEL[entry.event_type] ?? entry.event_type}
            </span>
            <span className="audit-payload">
              {Object.entries(entry.payload as Record<string, unknown>)
                .map(([k, v]) => `${k}: ${v}`)
                .join("  ·  ")}
            </span>
            <span className="audit-time">{formatTime(entry.timestamp)}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}
