import type { AgentEvent, PlanStep } from "../models/events";

const STATUS_ICON: Record<PlanStep["status"], string> = {
  pending:  "⏳",
  running:  "⚙️",
  done:     "✅",
  failed:   "❌",
  skipped:  "⏭️",
};

interface Props {
  events: AgentEvent[];
}

export default function PlanPanel({ events }: Props) {
  // Use the latest PlanUpdated event
  const planEvents = events.filter(
    (e): e is Extract<AgentEvent, { type: "PlanUpdated" }> => e.type === "PlanUpdated"
  );
  const steps: PlanStep[] =
    planEvents.length > 0 ? planEvents[planEvents.length - 1].steps : [];

  return (
    <div className="plan-panel">
      <h2 className="panel-title">执行计划</h2>
      {steps.length === 0 ? (
        <p className="placeholder">等待计划生成…</p>
      ) : (
        <ol className="plan-steps">
          {steps.map((step) => (
            <li key={step.id} className={`plan-step plan-step-${step.status}`}>
              <span className="plan-step-icon">{STATUS_ICON[step.status]}</span>
              <span className="plan-step-desc">{step.description}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
