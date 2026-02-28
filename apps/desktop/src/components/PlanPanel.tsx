import type { AgentEvent, PlanStep } from "../models/events";

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
      <h2 className="panel-title">Plan</h2>
      {steps.length === 0 ? (
        <p className="placeholder">No plan yet.</p>
      ) : (
        <ol className="plan-steps">
          {steps.map((step) => (
            <li key={step.id} className={`plan-step plan-step-${step.status}`}>
              {step.description}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
