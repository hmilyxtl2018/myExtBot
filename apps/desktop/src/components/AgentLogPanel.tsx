import { useEffect, useRef } from "react";
import type { AgentEvent } from "../models/events";

interface Props {
  events: AgentEvent[];
}

const LOG_EVENT_TYPES = [
  "AgentThinking",
  "ToolCallRequest",
  "ToolCallResult",
  "StatusChanged",
] as const;

type LogEventType = (typeof LOG_EVENT_TYPES)[number];

function isLogEvent(e: AgentEvent): e is Extract<AgentEvent, { type: LogEventType }> {
  return LOG_EVENT_TYPES.includes(e.type as LogEventType);
}

function formatTime(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString("zh-CN", { hour12: false });
  } catch {
    return ts;
  }
}

function renderEventItem(event: AgentEvent, idx: number) {
  switch (event.type) {
    case "AgentThinking":
      return (
        <li key={event.step.id} className="log-item log-item-thinking">
          <span className="log-icon">🤔</span>
          <div className="log-body">
            <span className="log-label">思维链</span>
            <p className="log-content">{event.step.content}</p>
            <span className="log-time">{formatTime(event.step.timestamp)}</span>
          </div>
        </li>
      );

    case "ToolCallRequest":
      return (
        <li key={event.request.id + "-req"} className="log-item log-item-tool-req">
          <span className="log-icon">🔧</span>
          <div className="log-body">
            <span className="log-label">
              工具调用 <code className="tool-name">{event.request.tool}</code>
              <span className={`risk-badge risk-${event.request.risk}`}>{event.request.risk}</span>
            </span>
            <p className="log-content">{event.request.description}</p>
            <pre className="log-params">{JSON.stringify(event.request.params, null, 2)}</pre>
            <span className="log-time">{formatTime(event.request.timestamp)}</span>
          </div>
        </li>
      );

    case "ToolCallResult":
      return (
        <li key={event.result.id + "-res"} className={`log-item log-item-tool-res log-item-tool-res-${event.result.success ? "ok" : "err"}`}>
          <span className="log-icon">{event.result.success ? "✅" : "❌"}</span>
          <div className="log-body">
            <span className="log-label">
              工具结果 <code className="tool-name">{event.result.tool}</code>
              <span className="log-duration">{event.result.duration_ms}ms</span>
            </span>
            {event.result.success ? (
              <pre className="log-params">{JSON.stringify(event.result.output, null, 2)}</pre>
            ) : (
              <p className="log-error">{event.result.error}</p>
            )}
            <span className="log-time">{formatTime(event.result.timestamp)}</span>
          </div>
        </li>
      );

    case "StatusChanged":
      return (
        <li key={`status-${event.status}-${idx}`} className="log-item log-item-status">
          <span className="log-icon">📌</span>
          <div className="log-body">
            <span className={`log-status-badge log-status-${event.status}`}>{event.status}</span>
          </div>
        </li>
      );

    default:
      return null;
  }
}

export default function AgentLogPanel({ events }: Props) {
  const bottomRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events]);

  const logEvents = events.filter(isLogEvent);

  return (
    <div className="agent-log-panel">
      <h2 className="panel-title">运行日志</h2>
      <ul className="log-list">
        {logEvents.length === 0 && (
          <li className="placeholder">等待 Agent 启动…</li>
        )}
        {logEvents.map((e, i) => renderEventItem(e, i))}
        <li ref={bottomRef} />
      </ul>
    </div>
  );
}
