//! Tauri IPC commands exposed to the frontend.

use tauri::State;

use crate::agent::AgentState;
use crate::audit::AuditDb;
use crate::collab::types::{AgentIdentity, CollabMessage, MsgType, TaskStatus};
use crate::collab::{CollabBus, TeamRegistry};
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

// ── Multi-agent collaboration commands ───────────────────────────────────────

/// Register (or refresh) a bot identity in the local team registry.
///
/// Call this on startup with the local bot's own details, and again whenever
/// a remote peer announces itself (e.g. via a WebSocket presence ping).
///
/// # Arguments
/// * `id`       – stable UUID for this agent installation
/// * `name`     – human-readable label, e.g. `"Alice-bot"`
/// * `role`     – optional role tag, e.g. `"backend"` or `"pm"`
/// * `endpoint` – optional WebSocket address of this agent
/// * `team_id`  – logical team identifier shared by all teammates
/// * `is_local` – `true` when registering this installation's own bot
#[tauri::command]
pub fn register_agent(
    id: String,
    name: String,
    role: Option<String>,
    endpoint: Option<String>,
    team_id: String,
    is_local: bool,
    registry: State<'_, TeamRegistry>,
) -> Result<(), String> {
    let agent = AgentIdentity {
        id,
        name,
        role,
        endpoint,
        team_id,
        is_local,
        last_seen: chrono::Utc::now(),
    };
    registry.upsert_agent(&agent).map_err(|e| e.to_string())
}

/// Return all agents registered in the given team.
#[tauri::command]
pub fn get_team_agents(
    team_id: String,
    registry: State<'_, TeamRegistry>,
) -> Result<Vec<AgentIdentity>, String> {
    registry.list_agents(&team_id).map_err(|e| e.to_string())
}

/// Delegate a task to a specific agent (or leave unassigned for self-assignment).
///
/// Persists the task in SQLite, emits a `task_assigned` [`CollabMessage`] onto
/// the [`CollabBus`], and records the message for audit.
///
/// # Arguments
/// * `title`           – short task title
/// * `description`     – optional longer description
/// * `assigned_to`     – agent id of the intended assignee (may be `None`)
/// * `delegated_by`    – agent id of the delegating bot
#[tauri::command]
pub fn delegate_task(
    title: String,
    description: Option<String>,
    assigned_to: Option<String>,
    delegated_by: String,
    registry: State<'_, TeamRegistry>,
    bus: State<'_, CollabBus>,
) -> Result<serde_json::Value, String> {
    let task = registry
        .create_task(
            &title,
            description.as_deref(),
            assigned_to.as_deref(),
            Some(&delegated_by),
        )
        .map_err(|e| e.to_string())?;

    // Emit a task_assigned message onto the in-process bus so any listener
    // (e.g. a WebSocket bridge forwarding to remote agents) can act on it.
    if let Some(ref assignee) = assigned_to {
        let msg = CollabMessage {
            id: uuid::Uuid::new_v4().to_string(),
            from_agent: delegated_by.clone(),
            to_agent: assignee.clone(),
            task_id: Some(task.id.clone()),
            msg_type: MsgType::TaskAssigned,
            payload: serde_json::json!({
                "title": title,
                "description": description,
            }),
            timestamp: chrono::Utc::now(),
        };
        // Persist the message for audit; ignore bus send errors (no listeners yet)
        if let Err(e) = registry.save_message(&msg) {
            tracing::warn!("Failed to persist collab message: {e}");
        }
        let _ = bus.publish(msg);
    }

    Ok(serde_json::json!({
        "id":           task.id,
        "title":        task.title,
        "status":       task.status.as_str(),
        "assigned_to":  task.assigned_to,
        "delegated_by": task.delegated_by,
        "created_at":   task.created_at.to_rfc3339(),
    }))
}

/// Update the status of a task and (on completion) record the result payload.
///
/// Publishes a `task_update` or `task_result` message onto the bus so the
/// delegating agent is notified in real-time.
///
/// # Arguments
/// * `task_id`      – UUID of the task to update
/// * `status`       – new status string: `"in_progress"`, `"done"`, `"failed"`, `"cancelled"`
/// * `result`       – optional JSON result (used when `status` is `"done"` or `"failed"`)
/// * `from_agent`   – agent reporting the update
/// * `to_agent`     – agent that should be notified (usually the delegator)
#[tauri::command]
pub fn update_task_status(
    task_id: String,
    status: String,
    result: Option<serde_json::Value>,
    from_agent: String,
    to_agent: String,
    registry: State<'_, TeamRegistry>,
    bus: State<'_, CollabBus>,
) -> Result<(), String> {
    let ts = TaskStatus::try_from(status.as_str()).map_err(|e| e.to_string())?;
    registry
        .update_task_status(&task_id, ts.clone(), result.as_ref())
        .map_err(|e| e.to_string())?;

    let is_final = matches!(ts, TaskStatus::Done | TaskStatus::Failed | TaskStatus::Cancelled);
    let msg_type = if is_final {
        MsgType::TaskResult
    } else {
        MsgType::TaskUpdate
    };
    let msg = CollabMessage {
        id: uuid::Uuid::new_v4().to_string(),
        from_agent: from_agent.clone(),
        to_agent: to_agent.clone(),
        task_id: Some(task_id),
        msg_type,
        payload: serde_json::json!({ "status": status, "result": result }),
        timestamp: chrono::Utc::now(),
    };
    if let Err(e) = registry.save_message(&msg) {
        tracing::warn!("Failed to persist collab message: {e}");
    }
    let _ = bus.publish(msg);
    Ok(())
}

/// Fetch recent tasks with optional pagination.
#[tauri::command]
pub fn get_tasks(
    limit: Option<usize>,
    offset: Option<usize>,
    registry: State<'_, TeamRegistry>,
) -> Result<Vec<serde_json::Value>, String> {
    registry.list_tasks(limit, offset).map_err(|e| e.to_string())
}

/// Fetch recent inter-agent messages with optional pagination.
#[tauri::command]
pub fn get_collab_messages(
    limit: Option<usize>,
    offset: Option<usize>,
    registry: State<'_, TeamRegistry>,
) -> Result<Vec<serde_json::Value>, String> {
    registry
        .list_messages(limit, offset)
        .map_err(|e| e.to_string())
}
