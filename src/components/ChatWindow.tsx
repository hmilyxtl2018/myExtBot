import { ChatMessage } from "../types";

interface ChatWindowProps {
  messages: ChatMessage[];
}

const ROLE_LABELS: Record<ChatMessage["role"], string> = {
  user: "You",
  assistant: "Agent",
  tool: "Tool",
};

const ROLE_COLORS: Record<ChatMessage["role"], string> = {
  user: "#1d4ed8",
  assistant: "#374151",
  tool: "#7c3aed",
};

export function ChatWindow({ messages }: ChatWindowProps) {
  return (
    <div
      style={{
        flex: 1,
        overflowY: "auto",
        border: "1px solid #e5e7eb",
        borderRadius: "8px",
        padding: "12px",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        backgroundColor: "#f9fafb",
      }}
    >
      {messages.length === 0 && (
        <p style={{ color: "#9ca3af", textAlign: "center", marginTop: "24px" }}>
          No messages yet. Type a message below to start.
        </p>
      )}
      {messages.map((msg) => (
        <div
          key={msg.id}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: msg.role === "user" ? "flex-end" : "flex-start",
          }}
        >
          <span
            style={{
              fontSize: "0.7rem",
              color: ROLE_COLORS[msg.role],
              marginBottom: "2px",
              fontWeight: 600,
            }}
          >
            {ROLE_LABELS[msg.role]}
          </span>
          <div
            style={{
              maxWidth: "80%",
              padding: "8px 12px",
              borderRadius: "8px",
              backgroundColor: msg.role === "user" ? "#dbeafe" : "#ffffff",
              border: "1px solid #e5e7eb",
              fontSize: "0.9rem",
              whiteSpace: "pre-wrap",
            }}
          >
            {msg.content}
          </div>
        </div>
      ))}
    </div>
  );
}
