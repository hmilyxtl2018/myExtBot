import Icon from "./Icon";
import type { IconName } from "./Icon";
import type { AgentEvent, PlanStep } from "../models/events";

const STATUS_ICON: Record<PlanStep["status"], IconName> = {
  pending: "radioEmpty",
  running: "autorenew",
  done:    "checkCircle",
  failed:  "cancel",
  skipped: "skipNext",
};

interface Props {
  events: AgentEvent[];
}

export default function PlanPanel({ events }: Props) {
  const planEvents = events.filter(
    (e): e is Extract<AgentEvent, { type: "PlanUpdated" }> => e.type === "PlanUpdated"
  );
  const steps: PlanStep[] =
    planEvents.length > 0 ? planEvents[planEvents.length - 1].steps : [];

  const total   = steps.length;
  const done    = steps.filter((s) => s.status === "done").length;
  const running = steps.filter((s) => s.status === "running").length;
  const failed  = steps.filter((s) => s.status === "failed").length;
  // Group 'skipped' with 'pending' in the progress bar: both represent
  // steps that did not execute, shown as the trailing gray segment.
  const pending = steps.filter((s) => s.status === "pending" || s.status === "skipped").length;

  return (
    <div className="plan-panel">
      <h2 className="panel-title">执行计划</h2>

      {total > 0 && (
        <div className="plan-summary">
          <div className="plan-summary-bar">
            {done    > 0 && <div className="plan-summary-seg plan-seg-done"    style={{ width: `${(done    / total) * 100}%` }} />}
            {running > 0 && <div className="plan-summary-seg plan-seg-running" style={{ width: `${(running / total) * 100}%` }} />}
            {failed  > 0 && <div className="plan-summary-seg plan-seg-failed"  style={{ width: `${(failed  / total) * 100}%` }} />}
            {pending > 0 && <div className="plan-summary-seg plan-seg-pending" style={{ width: `${(pending / total) * 100}%` }} />}
          </div>
          <span className="plan-summary-label">
            {done}/{total} 步完成{failed > 0 ? ` · ${failed} 步失败` : ""}
          </span>
        </div>
      )}

      {steps.length === 0 ? (
        <p className="placeholder">等待计划生成…</p>
      ) : (
        <ol className="plan-steps">
          {steps.map((step) => (
            <li key={step.id} className={`plan-step plan-step-${step.status}`}>
              <Icon name={STATUS_ICON[step.status]} size={14} className="plan-step-icon" />
              <span className="plan-step-num">{step.index + 1}.</span>
              <span className="plan-step-desc">{step.description}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
