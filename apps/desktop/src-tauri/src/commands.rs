//! Tauri IPC commands exposed to the frontend.

use tauri::State;

use crate::agent::AgentState;
use crate::audit::AuditDb;
use crate::events::{AgentEvent, AgentStatus, ChatMessage};
use crate::permissions::PermissionManager;

/// Send a user chat message and kick off the agent.
#[tauri::command]
pub async fn send_message(
    content: String,
    agent: State<'_, AgentState>,
    db: State<'_, AuditDb>,
) -> Result<(), String> {
    let msg_id = uuid::Uuid::new_v4().to_string();

    let msg = ChatMessage {
        id: msg_id,
        role: "user".into(),
        content: content.clone(),
        timestamp: chrono::Utc::now(),
    };
    agent
        .emit(AgentEvent::ChatMessage { message: msg })
        .map_err(|e| e.to_string())?;

    // Log the state transition to Thinking, recording it as a model_usage event
    // placeholder so the audit trail shows when LLM calls begin.
    db.log_model_usage("pending", 0, 0, 0)
        .map_err(|e| e.to_string())?;

    // Transition to Thinking (LLM call would happen here)
    agent
        .transition(AgentStatus::Thinking)
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Emergency stop: cancel any running tool call and halt the agent.
#[tauri::command]
pub fn emergency_stop(
    agent: State<'_, AgentState>,
    perms: State<'_, PermissionManager>,
    db: State<'_, AuditDb>,
) -> Result<(), String> {
    perms.clear_session();
    // Log the emergency stop as a permission event
    db.log_permission_event("emergency_stop", "*", "blocked_by_guardrail", Some("user triggered emergency stop"))
        .map_err(|e| e.to_string())?;
    agent.emergency_stop().map_err(|e| e.to_string())
}

/// User approves a pending tool call.
#[tauri::command]
pub fn approve_tool_call(
    call_id: String,
    cache_session: bool,
    tool: String,
    params: serde_json::Value,
    agent: State<'_, AgentState>,
    perms: State<'_, PermissionManager>,
    db: State<'_, AuditDb>,
) -> Result<(), String> {
    if cache_session {
        perms.grant_session(&tool);
    }
    // Log permission approval
    db.log_permission_event("tool_call", &tool, "approved", Some(&call_id))
        .map_err(|e| e.to_string())?;
    // Log tool execution start (duration will be filled in when result arrives)
    db.log_tool_execution(&tool, &params, true, 0, None)
        .map_err(|e| e.to_string())?;
    agent
        .transition(crate::events::AgentStatus::RunningTool)
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// User denies a pending tool call.
#[tauri::command]
pub fn deny_tool_call(
    call_id: String,
    tool: String,
    params: serde_json::Value,
    agent: State<'_, AgentState>,
    db: State<'_, AuditDb>,
) -> Result<(), String> {
    // Log permission denial
    db.log_permission_event("tool_call", &tool, "denied", Some(&call_id))
        .map_err(|e| e.to_string())?;
    // Log tool execution as rejected (not run)
    db.log_tool_execution(&tool, &params, false, 0, Some("denied by user"))
        .map_err(|e| e.to_string())?;
    agent
        .transition(crate::events::AgentStatus::Idle)
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Retrieve recent audit log entries for the `AuditTimeline` UI.
///
/// # Arguments
/// * `limit`  – max rows to return (default: 50)
/// * `offset` – rows to skip for pagination (default: 0)
#[tauri::command]
pub fn get_audit_logs(
    limit: Option<usize>,
    offset: Option<usize>,
    db: State<'_, AuditDb>,
) -> Result<Vec<serde_json::Value>, String> {
    db.get_audit_logs(limit, offset)
        .map_err(|e| e.to_string())
}
