import { useState } from "react";
import ChatPanel from "./components/ChatPanel";
import PlanPanel from "./components/PlanPanel";
import AuditTimeline from "./components/AuditTimeline";
import ApprovalModal from "./components/ApprovalModal";
import EmergencyStop from "./components/EmergencyStop";
import { useEventStream } from "./hooks/useEventStream";
import type { ToolCallRequest } from "./models/events";
import "./App.css";

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
        <span className="agent-status" data-status={agentStatus}>
          {agentStatus}
        </span>
        <EmergencyStop />
      </header>

      <main className="app-main">
        <aside className="panel panel-plan">
          <PlanPanel events={events} />
        </aside>

        <section className="panel panel-chat">
          <ChatPanel events={events} />
        </section>

        <aside className="panel panel-audit">
          <AuditTimeline events={events} />
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
