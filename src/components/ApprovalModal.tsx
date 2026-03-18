import { ApprovalRequestedPayload } from "../types";

interface ApprovalModalProps {
  request: ApprovalRequestedPayload;
  onApprove: () => void;
  onReject: () => void;
}

export function ApprovalModal({ request, onApprove, onReject }: ApprovalModalProps) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        style={{
          backgroundColor: "#fff",
          borderRadius: "12px",
          padding: "24px",
          width: "420px",
          boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
        }}
      >
        <h2 style={{ marginTop: 0, fontSize: "1.2rem", color: "#111827" }}>
          Tool Approval Required
        </h2>
        <p style={{ color: "#374151" }}>
          The agent wants to run the following tool:
        </p>
        <div
          style={{
            backgroundColor: "#f3f4f6",
            borderRadius: "8px",
            padding: "12px",
            marginBottom: "16px",
            fontFamily: "monospace",
            fontSize: "0.85rem",
          }}
        >
          <div>
            <strong>Tool:</strong> {request.tool_name}
          </div>
          <div>
            <strong>Args:</strong>{" "}
            <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
              {JSON.stringify(request.args, null, 2)}
            </pre>
          </div>
        </div>
        <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
          <button
            onClick={onReject}
            style={{
              padding: "8px 20px",
              borderRadius: "6px",
              border: "1px solid #d1d5db",
              backgroundColor: "#fff",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            Reject
          </button>
          <button
            onClick={onApprove}
            style={{
              padding: "8px 20px",
              borderRadius: "6px",
              border: "none",
              backgroundColor: "#2563eb",
              color: "#fff",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}
