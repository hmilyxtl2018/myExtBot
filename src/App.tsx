import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

import { AgentStatusBadge } from "./components/AgentStatusBadge";
import { ApprovalModal } from "./components/ApprovalModal";
import { ChatWindow } from "./components/ChatWindow";
import {
  AgentState,
  ApprovalRequestedPayload,
  ChatMessage,
  MessagePayload,
  StateChangedPayload,
} from "./types";

let messageIdCounter = 0;

function App() {
  const [agentState, setAgentState] = useState<AgentState>("idle");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [approvalRequest, setApprovalRequest] =
    useState<ApprovalRequestedPayload | null>(null);

  const unlistenRefs = useRef<UnlistenFn[]>([]);

  // ── Subscribe to Rust IPC events on mount ──────────────────────────────────
  useEffect(() => {
    let mounted = true;

    async function subscribeToEvents() {
      // Hydrate initial state from Rust
      const initialState = await invoke<AgentState>("get_state");
      if (mounted) setAgentState(initialState);

      const unlistenState = await listen<StateChangedPayload>(
        "agent://state-changed",
        (event) => {
          if (mounted) setAgentState(event.payload.state);
        }
      );

      const unlistenMessage = await listen<MessagePayload>(
        "agent://message",
        (event) => {
          if (mounted) {
            const msg: ChatMessage = {
              id: ++messageIdCounter,
              role: event.payload.role,
              content: event.payload.content,
            };
            setMessages((prev) => [...prev, msg]);
          }
        }
      );

      const unlistenApproval = await listen<ApprovalRequestedPayload>(
        "agent://approval-requested",
        (event) => {
          if (mounted) setApprovalRequest(event.payload);
        }
      );

      unlistenRefs.current = [unlistenState, unlistenMessage, unlistenApproval];
    }

    subscribeToEvents();

    return () => {
      mounted = false;
      unlistenRefs.current.forEach((fn) => fn());
    };
  }, []);

  // ── Send a user message ────────────────────────────────────────────────────
  async function handleSend() {
    const text = input.trim();
    if (!text || agentState !== "idle") return;
    setInput("");
    try {
      await invoke("send_message", { message: text });
    } catch (err) {
      console.error("send_message error:", err);
    }
  }

  // ── Approval flow ──────────────────────────────────────────────────────────
  async function handleApprove() {
    setApprovalRequest(null);
    try {
      await invoke("approve_tool");
    } catch (err) {
      console.error("approve_tool error:", err);
    }
  }

  async function handleReject() {
    setApprovalRequest(null);
    try {
      await invoke("reject_tool");
    } catch (err) {
      console.error("reject_tool error:", err);
    }
  }

  const canSend = agentState === "idle";

  return (
    <main
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        padding: "20px",
        gap: "12px",
        fontFamily: "system-ui, sans-serif",
        maxWidth: "720px",
        margin: "0 auto",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <h1 style={{ margin: 0, fontSize: "1.4rem" }}>myExtBot Agent</h1>
        <AgentStatusBadge state={agentState} />
      </header>

      <ChatWindow messages={messages} />

      <form
        style={{ display: "flex", gap: "8px" }}
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
      >
        <input
          style={{
            flex: 1,
            padding: "10px 14px",
            borderRadius: "8px",
            border: "1px solid #d1d5db",
            fontSize: "0.95rem",
          }}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={canSend ? "Type a message…" : "Agent is busy…"}
          disabled={!canSend}
        />
        <button
          type="submit"
          disabled={!canSend || !input.trim()}
          style={{
            padding: "10px 20px",
            borderRadius: "8px",
            border: "none",
            backgroundColor: canSend ? "#2563eb" : "#9ca3af",
            color: "#fff",
            cursor: canSend ? "pointer" : "not-allowed",
            fontWeight: 600,
          }}
        >
          Send
        </button>
      </form>

      {approvalRequest && (
        <ApprovalModal
          request={approvalRequest}
          onApprove={handleApprove}
          onReject={handleReject}
        />
      )}
    </main>
  );
}

export default App;

