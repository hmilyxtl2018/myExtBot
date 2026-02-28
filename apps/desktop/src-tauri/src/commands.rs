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
    db.log_message(&msg_id, agent.session_id(), "user", &content)
        .map_err(|e| e.to_string())?;

    let msg = ChatMessage {
        id: msg_id,
        role: "user".into(),
        content,
        timestamp: chrono::Utc::now(),
    };
    agent
        .emit(AgentEvent::ChatMessage { message: msg })
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
) -> Result<(), String> {
    perms.clear_session();
    agent.emergency_stop().map_err(|e| e.to_string())
}

/// User approves a pending tool call.
#[tauri::command]
pub fn approve_tool_call(
    call_id: String,
    cache_session: bool,
    tool: String,
    agent: State<'_, AgentState>,
    perms: State<'_, PermissionManager>,
    db: State<'_, AuditDb>,
) -> Result<(), String> {
    if cache_session {
        perms.grant_session(&tool);
    }
    db.log_tool_call(&call_id, agent.session_id(), &tool, "{}", true)
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
    agent: State<'_, AgentState>,
    db: State<'_, AuditDb>,
) -> Result<(), String> {
    db.log_tool_call(&call_id, agent.session_id(), &tool, "{}", false)
        .map_err(|e| e.to_string())?;
    agent
        .transition(crate::events::AgentStatus::Idle)
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Retrieve recent audit log entries.
#[tauri::command]
pub fn get_audit_log(
    limit: Option<usize>,
    db: State<'_, AuditDb>,
) -> Result<Vec<serde_json::Value>, String> {
    db.recent_entries(limit.unwrap_or(50))
        .map_err(|e| e.to_string())
}
