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
    params: serde_json::Value,
    agent: State<'_, AgentState>,
    perms: State<'_, PermissionManager>,
    db: State<'_, AuditDb>,
) -> Result<(), String> {
    if cache_session {
        perms.grant_session(&tool);
    }
    let params_json = serde_json::to_string(&params).unwrap_or_else(|_| "{}".into());
    db.log_tool_call(&call_id, agent.session_id(), &tool, &params_json, true)
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
    let params_json = serde_json::to_string(&params).unwrap_or_else(|_| "{}".into());
    db.log_tool_call(&call_id, agent.session_id(), &tool, &params_json, false)
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

/// Retrieve the full RunGraph (nodes + edges) for the current session.
#[tauri::command]
pub fn get_run_graph(
    agent: State<'_, AgentState>,
    db: State<'_, AuditDb>,
) -> Result<serde_json::Value, String> {
    db.get_run_graph(agent.session_id())
        .map_err(|e| e.to_string())
}

/// Mark a graph edge as blocked.
#[tauri::command]
pub fn block_edge(
    edge_id: String,
    agent: State<'_, AgentState>,
    db: State<'_, AuditDb>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    crate::intervention::block_edge(
        &app,
        &db,
        agent.session_id(),
        crate::intervention::BlockEdgeRequest { edge_id },
    )
    .map_err(|e| e.to_string())
}

/// Replace an artifact and rewire selected edges.
#[tauri::command]
pub fn replace_artifact(
    old_artifact_id: String,
    new_data: serde_json::Value,
    rewire_edge_ids: Vec<String>,
    agent: State<'_, AgentState>,
    db: State<'_, AuditDb>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    crate::intervention::replace_artifact(
        &app,
        &db,
        agent.session_id(),
        crate::intervention::ReplaceArtifactRequest {
            old_artifact_id,
            new_data,
            rewire_edge_ids,
        },
    )
    .map_err(|e| e.to_string())
}

/// Insert a verifier node between two existing control-flow nodes.
#[tauri::command]
pub fn insert_verifier(
    src_node_id: String,
    dst_node_id: String,
    verifier: String,
    params: serde_json::Value,
    agent: State<'_, AgentState>,
    db: State<'_, AuditDb>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    crate::intervention::insert_verifier(
        &app,
        &db,
        agent.session_id(),
        crate::intervention::InsertVerifierRequest {
            src_node_id,
            dst_node_id,
            verifier,
            params,
        },
    )
    .map_err(|e| e.to_string())
}

/// Save (create or update) a custom verifier rule.
#[tauri::command]
pub fn save_verifier_rule(
    id: Option<String>,
    scope: Option<String>,
    name: String,
    rule_json: String,
    agent: State<'_, AgentState>,
    db: State<'_, AuditDb>,
) -> Result<String, String> {
    let rule_id = id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let scope_str = scope.as_deref().unwrap_or("task");
    db.upsert_verifier_rule(&rule_id, Some(agent.session_id()), scope_str, &name, &rule_json)
        .map_err(|e| e.to_string())?;
    Ok(rule_id)
}

/// List all saved verifier rules.
#[tauri::command]
pub fn list_verifier_rules(db: State<'_, AuditDb>) -> Result<Vec<serde_json::Value>, String> {
    db.list_verifier_rules().map_err(|e| e.to_string())
}
