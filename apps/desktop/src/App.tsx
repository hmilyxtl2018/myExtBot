import { useState } from "react";
import ChatPanel from "./components/ChatPanel";
import PlanPanel from "./components/PlanPanel";
import AuditTimeline from "./components/AuditTimeline";
import ApprovalModal from "./components/ApprovalModal";
import EmergencyStop from "./components/EmergencyStop";
import { useEventStream } from "./hooks/useEventStream";
import type { AgentEvent, ToolCallRequest } from "./models/events";
import "./App.css";

export default function App() {
  const [pendingApproval, setPendingApproval] = useState<ToolCallRequest | null>(null);
  const { events, agentStatus } = useEventStream({
    onToolCallRequest: (req) => setPendingApproval(req),
  });

  const handleApprove = (_req: ToolCallRequest) => {
    // TODO: invoke Tauri command to approve tool call
    setPendingApproval(null);
  };

  const handleDeny = (_req: ToolCallRequest) => {
    // TODO: invoke Tauri command to deny tool call
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
