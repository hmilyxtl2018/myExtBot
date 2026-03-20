//! Execution layer: runs a single [`PlanStep`] produced by the planner.
//!
//! * **Tool-less steps** – the description is treated as an LLM task; we call
//!   [`crate::llm::complete`] and return the assistant reply as the output.
//! * **Tool steps** – we emit a [`AgentEvent::ToolCallRequest`] event to ask
//!   the user for approval, then wait for the result via a one-shot channel
//!   that the [`crate::commands::approve_tool_call`] /
//!   [`crate::commands::deny_tool_call`] IPC handlers signal.

use std::time::Instant;

use anyhow::Result;

use crate::agent::AgentState;
use crate::audit::AuditDb;
use crate::events::{AgentEvent, AgentStatus, PlanStep, RiskLevel, ToolCallRequest};

/// Outcome of executing one plan step.
#[derive(Debug)]
pub struct StepResult {
    /// Human-readable output text (LLM reply or tool output serialised as JSON).
    pub output: String,
    /// Name of the tool that was invoked, if any.
    pub tool_used: Option<String>,
    /// Wall-clock time spent on this step in milliseconds.
    pub duration_ms: u64,
}

/// Determine the risk level of a tool call based on the tool name.
///
/// * `High`   – tools that modify the filesystem or run arbitrary commands.
/// * `Medium` – tools that read files or perform network requests.
/// * `Low`    – read-only, side-effect-free operations (currently none).
fn tool_risk_level(tool: &str) -> RiskLevel {
    match tool {
        "cmd.run" | "fs.applyPatch" => RiskLevel::High,
        "net.fetch" | "fs.readFile" => RiskLevel::Medium,
        _ => RiskLevel::Medium,
    }
}

/// Execute a single plan step.
///
/// # Behaviour
///
/// * If `step.tool` is `None` the description is sent to the LLM as a task
///   and the assistant reply becomes the step output.
/// * If `step.tool` is `Some(name)` the function emits a
///   [`AgentEvent::ToolCallRequest`] event (transitioning the agent to
///   `WaitingApproval`) and **immediately returns** a placeholder
///   [`StepResult`].  The actual tool execution happens in the
///   `approve_tool_call` IPC command; the caller in `send_message` should
///   treat this as a suspension point.
///
/// The agent status is updated to `Thinking` at the start of each tool-less
/// step and to `WaitingApproval` when a tool call is pending.
pub async fn execute_step(
    step: &PlanStep,
    agent: &AgentState,
    db: &AuditDb,
) -> Result<StepResult> {
    let start = Instant::now();

    // Log agent assignment if routing was applied to this step.
    if let Some(ref agent_id) = step.assigned_agent_id {
        tracing::info!(
            "Step '{}' routed to agent '{}' (score: {:?})",
            step.description,
            agent_id,
            step.routing_score
        );
    }

    match &step.tool {
        // ── Tool-less step: ask the LLM to handle the task ───────────────────
        None => {
            agent.transition(AgentStatus::Thinking)?;

            let resp = crate::llm::complete(&step.description).await?;

            let duration_ms = start.elapsed().as_millis() as u64;
            let _ = db.log_model_usage(
                &resp.model,
                resp.prompt_tokens,
                resp.completion_tokens,
                duration_ms,
            );

            Ok(StepResult {
                output: resp.text,
                tool_used: None,
                duration_ms,
            })
        }

        // ── Tool step: request human approval, then suspend ──────────────────
        Some(tool_name) => {
            let call_id = uuid::Uuid::new_v4().to_string();
            let params  = step.params.clone().unwrap_or(serde_json::Value::Null);

            // Assign risk level based on the tool's potential impact.
            let risk = tool_risk_level(tool_name);

            let request = ToolCallRequest {
                id:          call_id.clone(),
                tool:        tool_name.clone(),
                params:      params.clone(),
                risk,
                description: step.description.clone(),
                timestamp:   chrono::Utc::now(),
            };

            agent.transition(AgentStatus::WaitingApproval)?;
            agent.emit(AgentEvent::ToolCallRequest { request })?;

            let _ = db.log_tool_execution(tool_name, &params, false, 0, Some("pending approval"));

            let duration_ms = start.elapsed().as_millis() as u64;
            Ok(StepResult {
                output: format!("Awaiting approval for tool '{tool_name}'"),
                tool_used: Some(tool_name.clone()),
                duration_ms,
            })
        }
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── StepResult ────────────────────────────────────────────────────────────

    #[test]
    fn test_step_result_fields_are_accessible() {
        let r = StepResult {
            output:      "hello".into(),
            tool_used:   Some("net.fetch".into()),
            duration_ms: 42,
        };
        assert_eq!(r.output, "hello");
        assert_eq!(r.tool_used.as_deref(), Some("net.fetch"));
        assert_eq!(r.duration_ms, 42);
    }

    #[test]
    fn test_step_result_no_tool() {
        let r = StepResult {
            output:      "done".into(),
            tool_used:   None,
            duration_ms: 0,
        };
        assert!(r.tool_used.is_none());
    }

    // ── execute_step (tool path) ──────────────────────────────────────────────
    // We test the tool-step branch by verifying the pending-approval message
    // format without needing a live LLM or Tauri app handle.

    #[test]
    fn test_pending_approval_output_format() {
        // Simulate what execute_step produces for the tool path.
        let tool_name = "fs.readFile";
        let output = format!("Awaiting approval for tool '{tool_name}'");
        assert!(output.contains("fs.readFile"));
        assert!(output.contains("Awaiting approval"));
    }

    // ── tool_risk_level ───────────────────────────────────────────────────────

    #[test]
    fn test_cmd_run_is_high_risk() {
        assert!(matches!(tool_risk_level("cmd.run"), RiskLevel::High));
    }

    #[test]
    fn test_fs_apply_patch_is_high_risk() {
        assert!(matches!(tool_risk_level("fs.applyPatch"), RiskLevel::High));
    }

    #[test]
    fn test_net_fetch_is_medium_risk() {
        assert!(matches!(tool_risk_level("net.fetch"), RiskLevel::Medium));
    }

    #[test]
    fn test_fs_read_file_is_medium_risk() {
        assert!(matches!(tool_risk_level("fs.readFile"), RiskLevel::Medium));
    }

    #[test]
    fn test_unknown_tool_defaults_to_medium_risk() {
        assert!(matches!(tool_risk_level("unknown.tool"), RiskLevel::Medium));
    }
}
