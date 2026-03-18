use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;

use crate::state_machine::{validate_transition, AgentState};

// ── IPC event names ────────────────────────────────────────────────────────────

pub const EVENT_STATE_CHANGED: &str = "agent://state-changed";
pub const EVENT_MESSAGE: &str = "agent://message";
pub const EVENT_APPROVAL_REQUESTED: &str = "agent://approval-requested";

// ── Payloads sent to the frontend ─────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StateChangedPayload {
    pub state: AgentState,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessagePayload {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApprovalRequestedPayload {
    pub tool_name: String,
    pub args: serde_json::Value,
}

// ── Managed state ─────────────────────────────────────────────────────────────

/// Pending approval: a channel that the approval command resolves.
type ApprovalSender = oneshot::Sender<bool>;

pub struct AgentManager {
    pub state: Mutex<AgentState>,
    /// When `Some`, the agent is suspended at `WaitingApproval` and the sender
    /// will be resolved by `approve_tool` / `reject_tool`.
    pub approval_tx: Mutex<Option<ApprovalSender>>,
}

impl AgentManager {
    pub fn new() -> Self {
        Self {
            state: Mutex::new(AgentState::Idle),
            approval_tx: Mutex::new(None),
        }
    }

    /// Attempt a validated state transition and, on success, broadcast the new
    /// state to all frontend windows via the `agent://state-changed` event.
    pub fn transition(&self, app: &AppHandle, to: AgentState) -> Result<(), String> {
        let mut current = self.state.lock().unwrap();
        validate_transition(&current, &to).map_err(|e| e.to_string())?;
        *current = to.clone();
        app.emit(EVENT_STATE_CHANGED, StateChangedPayload { state: to })
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Broadcast a message (assistant / tool output) to the frontend.
    pub fn send_message(&self, app: &AppHandle, role: &str, content: &str) -> Result<(), String> {
        app.emit(
            EVENT_MESSAGE,
            MessagePayload {
                role: role.to_string(),
                content: content.to_string(),
            },
        )
        .map_err(|e| e.to_string())
    }
}
