import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";
import ResultChart from "./ResultChart";
import AuditTimeline from "./AuditTimeline";
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

// Gap 8: Chinese status labels
const STATUS_LABEL_CN: Record<string, string> = {
  Idle:             "空闲",
  Thinking:         "思考中",
  WaitingApproval:  "等待审批",
  RunningTool:      "执行中",
  Stopped:          "已停止",
  Completed:        "已完成",
  Failed:           "失败",
};

function renderEventItem(event: AgentEvent, idx: number) {
  switch (event.type) {
    case "AgentThinking":
      return (
        <li key={event.step.id} className="log-item log-item-thinking">
          <Icon name="thinking" size={14} className="log-icon" />
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
          <Icon name="build" size={14} className="log-icon" />
          <div className="log-body">
            <span className="log-label">
              工具调用
              <code className="tool-name">{event.request.tool}</code>
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
        <li
          key={event.result.id + "-res"}
          className={`log-item log-item-tool-res log-item-tool-res-${event.result.success ? "ok" : "err"}`}
        >
          <Icon
            name={event.result.success ? "checkCircle" : "cancel"}
            size={14}
            className="log-icon"
          />
          <div className="log-body">
            <span className="log-label">
              工具结果
              <code className="tool-name">{event.result.tool}</code>
              <span className="log-duration">{event.result.duration_ms}ms</span>
            </span>
            {event.result.success ? (
              <ResultChart tool={event.result.tool} output={event.result.output} />
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
          <Icon name="statusDot" size={8} className="log-icon" style={{ marginTop: 4 }} />
          <div className="log-body">
            {/* Gap 8: show Chinese status label */}
            <span className={`log-status-badge log-status-${event.status}`}>
              {STATUS_LABEL_CN[event.status] ?? event.status}
            </span>
          </div>
        </li>
      );

    default:
      return null;
  }
}

export default function AgentLogPanel({ events }: Props) {
  // Gap 2: tab state — "log" or "audit"
  const [activeTab, setActiveTab] = useState<"log" | "audit">("log");
  const bottomRef = useRef<HTMLLIElement>(null);

  const logEvents = events.filter(isLogEvent);

  useEffect(() => {
    if (activeTab === "log") {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [events, activeTab]);

  return (
    <div className="agent-log-panel">
      {/* Gap 2: tab navigation */}
      <div className="panel-tabs">
        <button
          className={`panel-tab${activeTab === "log" ? " panel-tab-active" : ""}`}
          onClick={() => setActiveTab("log")}
        >
          运行日志
        </button>
        <button
          className={`panel-tab${activeTab === "audit" ? " panel-tab-active" : ""}`}
          onClick={() => setActiveTab("audit")}
        >
          审计记录
        </button>
      </div>

      {activeTab === "log" ? (
        <ul className="log-list">
          {logEvents.length === 0 && (
            <li className="placeholder">等待 Agent 启动…</li>
          )}
          {logEvents.map((e, i) => renderEventItem(e, i))}
          <li ref={bottomRef} />
        </ul>
      ) : (
        <AuditTimeline events={events} />
      )}
    </div>
  );
}
