import type { ToolCallRequest } from "../models/events";

interface Props {
  request: ToolCallRequest;
  onApprove: (req: ToolCallRequest) => void;
  onDeny: (req: ToolCallRequest) => void;
}

export default function ApprovalModal({ request, onApprove, onDeny }: Props) {
  return (
    <div className="modal-overlay">
      <div className="modal-box">
        <h3 className="modal-title">Tool Call Approval Required</h3>
        <p className="modal-description">{request.description}</p>
        <dl className="modal-details">
          <dt>Tool</dt>
          <dd>{request.tool}</dd>
          <dt>Risk</dt>
          <dd className={`risk-${request.risk}`}>{request.risk}</dd>
          <dt>Parameters</dt>
          <dd>
            <pre>{JSON.stringify(request.params, null, 2)}</pre>
          </dd>
        </dl>
        <div className="modal-actions">
          <button className="btn btn-approve" onClick={() => onApprove(request)}>
            Approve
          </button>
          <button className="btn btn-deny" onClick={() => onDeny(request)}>
            Deny
          </button>
        </div>
      </div>
    </div>
  );
}
