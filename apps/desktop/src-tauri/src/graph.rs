//! RunGraph builder — creates nodes and edges for tool calls and screenshots.
//!
//! The builder is a lightweight helper that:
//! 1. Creates a `RunNode` record in the DB and emits `graph.node_added`.
//! 2. Optionally creates a `RunEdge` from the previous node and emits `graph.edge_added`.
//! 3. Updates a node's status/outputs and emits `graph.node_updated`.
//! 4. Automatically inserts a `verify.screen_changed` verifier node after any
//!    `desktop.clickRectCenter` or `desktop.typeText` tool execution (default behavior).

#![allow(dead_code)]

use anyhow::Result;
use std::sync::{Arc, Mutex};
use tauri::AppHandle;
use uuid::Uuid;

use crate::audit::AuditDb;
use crate::events::{AgentEvent, EdgeKind, RunEdge, RunNode, RunNodeKind, RunNodeStatus};

/// Shared graph builder managed by Tauri.
pub struct GraphBuilder {
    app: AppHandle,
    session_id: String,
    last_node_id: Arc<Mutex<Option<String>>>,
}

impl GraphBuilder {
    pub fn new(app: AppHandle, session_id: String) -> Self {
        GraphBuilder {
            app,
            session_id,
            last_node_id: Arc::new(Mutex::new(None)),
        }
    }

    /// Create a new run node, persist it, and emit `GraphNodeAdded`.
    pub fn add_node(
        &self,
        db: &AuditDb,
        kind: RunNodeKind,
        tool: Option<String>,
        inputs: Option<serde_json::Value>,
    ) -> Result<String> {
        let id = Uuid::new_v4().to_string();
        let inputs_json = inputs
            .as_ref()
            .map(|v| serde_json::to_string(v))
            .transpose()?;
        db.insert_run_node(
            &id,
            &self.session_id,
            node_kind_str(&kind),
            tool.as_deref(),
            inputs_json.as_deref(),
        )?;

        let node = RunNode {
            id: id.clone(),
            session_id: self.session_id.clone(),
            kind,
            tool,
            status: RunNodeStatus::Pending,
            confidence: None,
            inputs,
            outputs: None,
            timestamp: chrono::Utc::now(),
        };
        self.emit(AgentEvent::GraphNodeAdded { node })?;

        // Auto-link to previous node via a control edge
        let prev = {
            let mut lock = self.last_node_id.lock().unwrap();
            let prev = lock.clone();
            *lock = Some(id.clone());
            prev
        };
        if let Some(src) = prev {
            self.add_edge(db, &src, &id, EdgeKind::Control)?;
        }

        Ok(id)
    }

    /// Update node status/outputs, persist, and emit `GraphNodeUpdated`.
    pub fn update_node(
        &self,
        db: &AuditDb,
        id: &str,
        status: RunNodeStatus,
        outputs: Option<serde_json::Value>,
        confidence: Option<f64>,
        kind: RunNodeKind,
        tool: Option<String>,
        inputs: Option<serde_json::Value>,
    ) -> Result<()> {
        let outputs_json = outputs
            .as_ref()
            .map(|v| serde_json::to_string(v))
            .transpose()?;
        db.update_run_node(
            id,
            node_status_str(&status),
            outputs_json.as_deref(),
            confidence,
        )?;

        let node = RunNode {
            id: id.to_string(),
            session_id: self.session_id.clone(),
            kind,
            tool,
            status,
            confidence,
            inputs,
            outputs,
            timestamp: chrono::Utc::now(),
        };
        self.emit(AgentEvent::GraphNodeUpdated { node })
    }

    /// Add an explicit directed edge, persist, and emit `GraphEdgeAdded`.
    pub fn add_edge(
        &self,
        db: &AuditDb,
        src: &str,
        dst: &str,
        kind: EdgeKind,
    ) -> Result<String> {
        let id = Uuid::new_v4().to_string();
        let kind_str = match &kind {
            EdgeKind::Control => "control",
            EdgeKind::Data => "data",
            EdgeKind::Verification => "verification",
        };
        db.insert_run_edge(&id, &self.session_id, src, dst, kind_str)?;

        let edge = RunEdge {
            id: id.clone(),
            session_id: self.session_id.clone(),
            src: src.to_string(),
            dst: dst.to_string(),
            kind,
            blocked: false,
            timestamp: chrono::Utc::now(),
        };
        self.emit(AgentEvent::GraphEdgeAdded { edge })?;
        Ok(id)
    }

    /// Returns true for high-risk desktop tools that require auto-verify.
    pub fn needs_auto_verify(tool: &str) -> bool {
        matches!(tool, "desktop.clickRectCenter" | "desktop.typeText")
    }

    fn emit(&self, event: AgentEvent) -> Result<()> {
        use tauri::Emitter;
        self.app
            .emit(AgentEvent::EVENT_NAME, &event)
            .map_err(|e| anyhow::anyhow!("emit error: {e}"))
    }
}

fn node_kind_str(kind: &RunNodeKind) -> &'static str {
    match kind {
        RunNodeKind::ToolCall => "tool_call",
        RunNodeKind::Screenshot => "screenshot",
        RunNodeKind::Verifier => "verifier",
        RunNodeKind::UserMessage => "user_message",
        RunNodeKind::AgentMessage => "agent_message",
    }
}

fn node_status_str(status: &RunNodeStatus) -> &'static str {
    match status {
        RunNodeStatus::Pending => "pending",
        RunNodeStatus::Running => "running",
        RunNodeStatus::Completed => "completed",
        RunNodeStatus::Failed => "failed",
        RunNodeStatus::Blocked => "blocked",
    }
}
