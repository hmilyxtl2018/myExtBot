import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";
import type { AgentEvent, AgentStatus, ChatMessage } from "../models/events";

interface Props {
  events: AgentEvent[];
  agentStatus: AgentStatus;
  onSend: (text: string) => void;
}

function formatTime(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

const ROLE_LABEL: Record<string, string> = {
  user:      "用户",
  assistant: "助手",
  system:    "系统",
};

// Gap 8: Chinese status labels for busy indicator
const BUSY_STATUS = new Set<AgentStatus>(["Thinking", "RunningTool"]);

export default function ChatPanel({ events, agentStatus, onSend }: Props) {
  const [input, setInput] = useState("");
  // Gap 6: auto-scroll ref
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const messages: ChatMessage[] = events
    .filter((e): e is Extract<AgentEvent, { type: "ChatMessage" }> => e.type === "ChatMessage")
    .map((e) => e.message);

  // Gap 6: scroll to bottom whenever a new message arrives
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const isBusy = BUSY_STATUS.has(agentStatus);

  const handleSend = () => {
    const text = input.trim();
    if (!text || isBusy) return;
    onSend(text);
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    // Auto-resize textarea up to ~5 lines
    e.target.style.height = "auto";
    e.target.style.height = `${Math.min(e.target.scrollHeight, 130)}px`;
  };

  return (
    <div className="chat-panel">
      {/* Gap 5: Chinese title */}
      <div className="chat-messages">
        <h2 className="panel-title">对话</h2>
        {messages.length === 0 ? (
          <p className="placeholder">发送消息，开始与数字分身对话…</p>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className={`message message-${msg.role}`}>
              {/* Gap 7: role label + timestamp */}
              <div className="message-meta">
                <span className="message-role">{ROLE_LABEL[msg.role] ?? msg.role}</span>
                <span className="message-time">{formatTime(msg.timestamp)}</span>
              </div>
              <p className="message-content">{msg.content}</p>
            </div>
          ))
        )}
        {/* Gap 6: scroll anchor */}
        <div ref={bottomRef} />
      </div>

      {/* Gap 1: user input area */}
      <div className="chat-input-area">
        <textarea
          ref={textareaRef}
          className="chat-input"
          placeholder={isBusy ? "助手正在响应中…" : "发送消息… (Enter 发送，Shift+Enter 换行)"}
          value={input}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          disabled={isBusy}
          rows={1}
        />
        <button
          className="chat-send-btn"
          onClick={handleSend}
          disabled={isBusy || !input.trim()}
          title="发送"
        >
          <Icon name="send" size={18} />
        </button>
      </div>
    </div>
  );
}
