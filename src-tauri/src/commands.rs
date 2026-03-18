use tauri::State;
use tokio::sync::oneshot;

use crate::agent::{
    AgentManager, ApprovalRequestedPayload, EVENT_APPROVAL_REQUESTED,
};
use crate::state_machine::AgentState;
use tauri::{AppHandle, Emitter};

// ── send_message ───────────────────────────────────────────────────────────────

/// Called by the React UI when the user submits a new message.
/// Transitions the agent to `Thinking` and begins a simulated processing loop.
#[tauri::command]
pub async fn send_message(
    app: AppHandle,
    manager: State<'_, AgentManager>,
    message: String,
) -> Result<(), String> {
    // Transition: Idle -> Thinking
    manager.transition(&app, AgentState::Thinking)?;
    manager.send_message(&app, "user", &message)?;

    // Simulate the agent deciding it needs a tool that requires approval.
    manager.send_message(&app, "assistant", "I need to run a tool. Requesting approval…")?;
    manager.transition(&app, AgentState::WaitingApproval)?;

    // Build a one-shot channel so the approval commands can wake us up.
    let (tx, rx) = oneshot::channel::<bool>();
    {
        let mut lock = manager.approval_tx.lock().unwrap();
        *lock = Some(tx);
    }

    // Broadcast the approval-requested event to the frontend.
    app.emit(
        EVENT_APPROVAL_REQUESTED,
        ApprovalRequestedPayload {
            tool_name: "example_tool".to_string(),
            args: serde_json::json!({ "input": message }),
        },
    )
    .map_err(|e| e.to_string())?;

    // Suspend: wait for the user's decision.
    let approved = rx.await.unwrap_or(false);

    if approved {
        // Transition: WaitingApproval -> RunningTool
        manager.transition(&app, AgentState::RunningTool)?;
        manager.send_message(&app, "assistant", "Tool approved. Running…")?;

        // Simulate tool execution.
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        manager.send_message(&app, "tool", "Tool finished successfully.")?;

        // Transition: RunningTool -> Completed
        manager.transition(&app, AgentState::Completed)?;
    } else {
        // Transition: WaitingApproval -> Failed (user denied)
        manager.transition(&app, AgentState::Failed)?;
        manager.send_message(&app, "assistant", "Tool execution was rejected by the user.")?;
    }

    Ok(())
}

// ── approve_tool ──────────────────────────────────────────────────────────────

/// Called by the React Approval Modal when the user clicks "Approve".
#[tauri::command]
pub fn approve_tool(manager: State<'_, AgentManager>) -> Result<(), String> {
    let mut lock = manager.approval_tx.lock().unwrap();
    if let Some(tx) = lock.take() {
        let _ = tx.send(true);
        Ok(())
    } else {
        Err("No pending approval request".to_string())
    }
}

// ── reject_tool ───────────────────────────────────────────────────────────────

/// Called by the React Approval Modal when the user clicks "Reject".
#[tauri::command]
pub fn reject_tool(manager: State<'_, AgentManager>) -> Result<(), String> {
    let mut lock = manager.approval_tx.lock().unwrap();
    if let Some(tx) = lock.take() {
        let _ = tx.send(false);
        Ok(())
    } else {
        Err("No pending approval request".to_string())
    }
}

// ── get_state ─────────────────────────────────────────────────────────────────

/// Returns the current agent state (useful for initial UI hydration).
#[tauri::command]
pub fn get_state(manager: State<'_, AgentManager>) -> AgentState {
    manager.state.lock().unwrap().clone()
}
