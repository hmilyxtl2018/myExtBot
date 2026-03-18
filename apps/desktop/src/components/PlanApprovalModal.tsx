import Icon from "./Icon";
import type { AgentPlan, AgentPlanStep } from "../models/events";

interface Props {
  plan: AgentPlan;
  onApprove: () => void;
  onDeny: () => void;
}

const RISK_LABEL: Record<AgentPlanStep["risk"], string> = {
  low:    "低",
  medium: "中",
  high:   "高",
};

export default function PlanApprovalModal({ plan, onApprove, onDeny }: Props) {
  return (
    <div className="modal-overlay">
      <div className="modal-box modal-box-plan">
        <h3 className="modal-title">确认执行计划</h3>

        <div className="plan-approval-goal">
          <strong>任务目标：</strong>
          <span>{plan.goal}</span>
        </div>

        {plan.requires_credentials.length > 0 && (
          <div className="plan-approval-credentials">
            <strong>需要凭证：</strong>
            <ul>
              {plan.requires_credentials.map((cred) => (
                <li key={cred}>{cred}</li>
              ))}
            </ul>
          </div>
        )}

        <ol className="plan-approval-steps">
          {plan.steps.map((step) => (
            <li key={step.id} className={`plan-approval-step plan-approval-step-risk-${step.risk}`}>
              <span className="plan-approval-step-num">{step.index + 1}.</span>
              <span className="plan-approval-step-intent">{step.intent}</span>
              <code className="plan-approval-step-tool">{step.tool}</code>
              <span className={`risk-badge risk-${step.risk}`}>
                风险：{RISK_LABEL[step.risk]}
              </span>
              {step.needs_credential && (
                <span className="plan-approval-cred-hint">🔑 {step.needs_credential}</span>
              )}
            </li>
          ))}
        </ol>

        <div className="modal-actions">
          <button className="btn btn-deny" onClick={onDeny}>
            <Icon name="close" size={14} />
            取消
          </button>
          <button className="btn btn-approve" onClick={onApprove}>
            <Icon name="check" size={14} />
            批准执行
          </button>
        </div>
      </div>
    </div>
  );
}
