import Icon from "./Icon";
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
        <h3 className="modal-title">工具调用审批</h3>
        <p className="modal-description">{request.description}</p>
        <dl className="modal-details">
          <dt>工具</dt>
          <dd><code className="tool-name">{request.tool}</code></dd>
          <dt>风险</dt>
          <dd><span className={`risk-badge risk-${request.risk}`}>{request.risk}</span></dd>
          <dt>参数</dt>
          <dd>
            <pre>{JSON.stringify(request.params, null, 2)}</pre>
          </dd>
        </dl>
        <div className="modal-actions">
          <button className="btn btn-deny" onClick={() => onDeny(request)}>
            <Icon name="close" size={14} />
            拒绝
          </button>
          <button className="btn btn-approve" onClick={() => onApprove(request)}>
            <Icon name="check" size={14} />
            批准
          </button>
        </div>
      </div>
    </div>
  );
}
