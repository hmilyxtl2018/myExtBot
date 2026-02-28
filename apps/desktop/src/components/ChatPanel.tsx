import type { AgentEvent, ChatMessage } from "../models/events";

interface Props {
  events: AgentEvent[];
}

export default function ChatPanel({ events }: Props) {
  const messages: ChatMessage[] = events
    .filter((e): e is Extract<AgentEvent, { type: "ChatMessage" }> => e.type === "ChatMessage")
    .map((e) => e.message);

  return (
    <div className="chat-panel">
      <h2 className="panel-title">Chat</h2>
      <div className="messages">
        {messages.map((msg) => (
          <div key={msg.id} className={`message message-${msg.role}`}>
            <span className="message-role">{msg.role}</span>
            <span className="message-content">{msg.content}</span>
          </div>
        ))}
        {messages.length === 0 && (
          <p className="placeholder">No messages yet.</p>
        )}
      </div>
    </div>
  );
}
