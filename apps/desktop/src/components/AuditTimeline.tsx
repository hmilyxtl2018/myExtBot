import type { AgentEvent } from "../models/events";

interface Props {
  events: AgentEvent[];
}

/** Extract a display timestamp string from an event, if available. */
function eventTimestamp(event: AgentEvent): string {
  switch (event.type) {
    case "ChatMessage":
      return event.message.timestamp;
    case "ToolCallRequest":
      return event.request.timestamp;
    case "ToolCallResult":
      return event.result.timestamp;
    case "AuditEntry":
      return event.entry.timestamp;
    default:
      return "";
  }
}

export default function AuditTimeline({ events }: Props) {
  return (
    <div className="audit-timeline">
      <h2 className="panel-title">Audit</h2>
      <ul className="audit-list">
        {events.map((event, idx) => (
          <li key={idx} className="audit-item">
            <span className="audit-type">{event.type}</span>
            <span className="audit-time">{eventTimestamp(event)}</span>
          </li>
        ))}
        {events.length === 0 && (
          <li className="placeholder">No events yet.</li>
        )}
      </ul>
    </div>
  );
}
