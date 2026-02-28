import type { AgentEvent } from "../models/events";

interface Props {
  events: AgentEvent[];
}

export default function AuditTimeline({ events }: Props) {
  return (
    <div className="audit-timeline">
      <h2 className="panel-title">Audit</h2>
      <ul className="audit-list">
        {events.map((event, idx) => (
          <li key={idx} className="audit-item">
            <span className="audit-type">{event.type}</span>
            <span className="audit-time">
              {"timestamp" in event
                ? String((event as Record<string, unknown>).timestamp ?? "")
                : ""}
            </span>
          </li>
        ))}
        {events.length === 0 && (
          <li className="placeholder">No events yet.</li>
        )}
      </ul>
    </div>
  );
}
