//! Agent state machine.
//!
//! States: Idle → Planning → WaitingPlanApproval → Thinking → WaitingApproval → RunningTool → Completed/Failed
//!         Any state → Stopped (emergency stop)

#![allow(dead_code)]

use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;

use crate::events::{AgentEvent, AgentStatus};

/// Cancel token for in-flight operations.
pub struct CancelToken {
    sender: Option<oneshot::Sender<()>>,
}

impl CancelToken {
    pub fn new() -> (Self, oneshot::Receiver<()>) {
        let (tx, rx) = oneshot::channel();
        (CancelToken { sender: Some(tx) }, rx)
    }

    pub fn cancel(&mut self) {
        if let Some(tx) = self.sender.take() {
            let _ = tx.send(());
        }
    }
}

/// Shared agent state, managed by Tauri.
pub struct AgentState {
    app: AppHandle,
    status: Arc<Mutex<AgentStatus>>,
    cancel_token: Arc<Mutex<Option<CancelToken>>>,
    session_id: String,
    /// Oneshot sender for plan approval (true = approved, false = denied).
    plan_approval_tx: Arc<Mutex<Option<oneshot::Sender<bool>>>>,
    /// Oneshot sender for tool-call approval (true = approved, false = denied).
    tool_approval_tx: Arc<Mutex<Option<oneshot::Sender<bool>>>>,
}

impl AgentState {
    pub fn new(app: AppHandle) -> Self {
        let session_id = uuid::Uuid::new_v4().to_string();
        AgentState {
            app,
            status: Arc::new(Mutex::new(AgentStatus::Idle)),
            cancel_token: Arc::new(Mutex::new(None)),
            session_id,
            plan_approval_tx: Arc::new(Mutex::new(None)),
            tool_approval_tx: Arc::new(Mutex::new(None)),
        }
    }

    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    pub fn status(&self) -> AgentStatus {
        self.status.lock().unwrap().clone()
    }

    pub fn transition(&self, new_status: AgentStatus) -> anyhow::Result<()> {
        {
            let mut s = self.status.lock().unwrap();
            *s = new_status.clone();
        }
        self.emit(AgentEvent::StatusChanged { status: new_status })?;
        Ok(())
    }

    pub fn emit(&self, event: AgentEvent) -> anyhow::Result<()> {
        self.app
            .emit(AgentEvent::EVENT_NAME, &event)
            .map_err(|e| anyhow::anyhow!("emit error: {e}"))?;
        Ok(())
    }

    /// Initiate emergency stop: cancel any running operation and transition to Stopped.
    pub fn emergency_stop(&self) -> anyhow::Result<()> {
        {
            let mut ct = self.cancel_token.lock().unwrap();
            if let Some(ref mut token) = *ct {
                token.cancel();
            }
            *ct = None;
        }
        // Also cancel any pending plan or tool approval
        self.resolve_plan_approval(false);
        self.resolve_tool_approval(false);
        self.transition(AgentStatus::Stopped)?;
        self.emit(AgentEvent::EmergencyStop)?;
        Ok(())
    }

    /// Returns a clone of the AppHandle (for use in closures).
    pub fn app_handle(&self) -> tauri::AppHandle {
        self.app.clone()
    }

    /// Returns a clone of the tool_approval Arc for use in approval gate closures.
    pub fn tool_approval_arc(&self) -> Arc<Mutex<Option<oneshot::Sender<bool>>>> {
        self.tool_approval_tx.clone()
    }

    /// Register a plan-approval channel and return the receiver.
    /// The caller awaits the receiver; the frontend calls `approve_plan`/`deny_plan`
    /// which resolves it via `resolve_plan_approval`.
    pub fn register_plan_approval(&self) -> oneshot::Receiver<bool> {
        let (tx, rx) = oneshot::channel();
        *self.plan_approval_tx.lock().unwrap() = Some(tx);
        rx
    }

    /// Resolve the pending plan approval (true = approved, false = denied/cancelled).
    pub fn resolve_plan_approval(&self, approved: bool) {
        if let Some(tx) = self.plan_approval_tx.lock().unwrap().take() {
            let _ = tx.send(approved);
        }
    }

    /// Register a tool-approval channel and return the receiver.
    pub fn register_tool_approval(&self) -> oneshot::Receiver<bool> {
        let (tx, rx) = oneshot::channel();
        *self.tool_approval_tx.lock().unwrap() = Some(tx);
        rx
    }

    /// Resolve the pending tool approval (true = approved, false = denied).
    pub fn resolve_tool_approval(&self, approved: bool) {
        if let Some(tx) = self.tool_approval_tx.lock().unwrap().take() {
            let _ = tx.send(approved);
        }
    }
}
