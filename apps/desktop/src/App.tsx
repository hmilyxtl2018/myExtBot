import { useState } from "react";
import ChatPanel from "./components/ChatPanel";
import PlanPanel from "./components/PlanPanel";
import AgentLogPanel from "./components/AgentLogPanel";
import ApprovalModal from "./components/ApprovalModal";
import EmergencyStop from "./components/EmergencyStop";
import { useEventStream } from "./hooks/useEventStream";
import type { ToolCallRequest } from "./models/events";
import "./App.css";

const STATUS_LABEL: Record<string, string> = {
  Idle:             "空闲",
  Thinking:         "思考中",
  WaitingApproval:  "等待审批",
  RunningTool:      "工具执行中",
  Stopped:          "已停止",
  Completed:        "已完成",
  Failed:           "执行失败",
};

export default function App() {
  const [pendingApproval, setPendingApproval] = useState<ToolCallRequest | null>(null);
  const { events, agentStatus } = useEventStream({
    onToolCallRequest: (req) => setPendingApproval(req),
  });

  const handleApprove = async (req: ToolCallRequest) => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("approve_tool_call", {
        callId: req.id,
        cacheSession: false,
        tool: req.tool,
        params: req.params,
      });
    } catch {
      console.warn("approve_tool_call invoked (stub)");
    }
    setPendingApproval(null);
  };

  const handleDeny = async (req: ToolCallRequest) => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("deny_tool_call", {
        callId: req.id,
        tool: req.tool,
        params: req.params,
      });
    } catch {
      console.warn("deny_tool_call invoked (stub)");
    }
    setPendingApproval(null);
  };

  return (
    <div className="app-layout">
      <header className="app-header">
        <span className="app-title">myExtBot</span>

        <div className="avatar-status" data-status={agentStatus}>
          <span className="avatar-status-dot" />
          <span className="avatar-status-label">
            数字分身：{STATUS_LABEL[agentStatus] ?? agentStatus}
          </span>
        </div>

        <EmergencyStop />
      </header>

      <main className="app-main">
        <aside className="panel panel-plan">
          <PlanPanel events={events} />
        </aside>

        <section className="panel panel-chat">
          <ChatPanel events={events} />
        </section>

        <aside className="panel panel-log">
          <AgentLogPanel events={events} />
        </aside>
      </main>

      {pendingApproval && (
        <ApprovalModal
          request={pendingApproval}
          onApprove={handleApprove}
          onDeny={handleDeny}
        />
      )}
    </div>
  );
}
