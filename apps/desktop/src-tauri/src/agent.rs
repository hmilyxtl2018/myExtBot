//! Agent state machine.
//!
//! States: Idle → Thinking → WaitingApproval → RunningTool → Completed/Failed
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
}

impl AgentState {
    pub fn new(app: AppHandle) -> Self {
        let session_id = uuid::Uuid::new_v4().to_string();
        AgentState {
            app,
            status: Arc::new(Mutex::new(AgentStatus::Idle)),
            cancel_token: Arc::new(Mutex::new(None)),
            session_id,
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
        self.transition(AgentStatus::Stopped)?;
        self.emit(AgentEvent::EmergencyStop)?;
        Ok(())
    }
}
