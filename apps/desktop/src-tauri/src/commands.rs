//! Tauri IPC commands exposed to the frontend.

use tauri::{Manager, State};

use crate::agent::AgentState;
use crate::agent_spec::{AgentRouteSuggestion, AgentSpec};
use crate::audit::AuditDb;
use crate::collab::types::{AgentIdentity, CollabMessage, MsgType, TaskStatus};
use crate::collab::{CollabBus, TeamRegistry};
use crate::events::{AgentEvent, AgentStatus, ChatMessage, ToolCallResult};
use crate::permissions::PermissionManager;
use crate::ts_bridge::TsBridge;

/// Send a user chat message and kick off the agent.
///
/// Immediately echoes the user message as a `ChatMessage` event and transitions
/// the agent to `Thinking`.  The actual work is spawned on a background Tokio
/// task so the IPC call returns quickly.
///
/// # Flow
/// 1. Echo user message → emit `ChatMessage`.
/// 2. Call [`crate::planner::plan`] to generate a `Vec<PlanStep>` from the
///    user's input.
/// 3. Emit `AgentEvent::PlanUpdated` with the full plan.
/// 4. Iterate over steps, calling [`crate::executor::execute_step`] for each.
///    Steps without a tool are executed immediately (LLM call); steps *with* a
///    tool emit a `ToolCallRequest` and pause — the actual execution happens
///    when the user accepts via `approve_tool_call`.
/// 5. After all tool-less steps complete, transition to `Completed`.
#[tauri::command]
pub async fn send_message(
    content: String,
    agent: State<'_, AgentState>,
    app_handle: tauri::AppHandle,
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

    agent
        .transition(AgentStatus::Thinking)
        .map_err(|e| e.to_string())?;

    // Spawn the planning + execution pipeline so the IPC call returns immediately.
    tokio::spawn(async move {
        let agent = app_handle.state::<AgentState>();
        let db    = app_handle.state::<AuditDb>();

        // ── 1. Plan ───────────────────────────────────────────────────────────
        let steps = match crate::planner::plan(&content).await {
            Ok(s) => s,
            Err(e) => {
                tracing::error!("Planner error: {e}");
                let err_msg = ChatMessage {
                    id:        uuid::Uuid::new_v4().to_string(),
                    role:      "assistant".into(),
                    content:   format!("⚠️ Planning failed: {e}"),
                    timestamp: chrono::Utc::now(),
                };
                let _ = agent.emit(AgentEvent::ChatMessage { message: err_msg });
                let _ = agent.transition(AgentStatus::Failed);
                return;
            }
        };

        // ── 2. Broadcast the plan to the frontend ─────────────────────────────
        let _ = agent.emit(AgentEvent::PlanUpdated { steps: steps.clone() });

        // ── 3. Execute each step ──────────────────────────────────────────────
        // Use a single mutable vector as the source of truth for step state.
        let mut updated_steps = steps;
        for i in 0..updated_steps.len() {
            updated_steps[i].status = crate::events::PlanStepStatus::Running;
            let _ = agent.emit(AgentEvent::PlanUpdated { steps: updated_steps.clone() });

            // Clone only the data needed to call execute_step without holding
            // a borrow on updated_steps across the await point.
            let step_snapshot = updated_steps[i].clone();

            match crate::executor::execute_step(&step_snapshot, &agent, &db).await {
                Ok(result) => {
                    updated_steps[i].result = Some(result.output.clone());

                    if step_snapshot.tool.is_some() {
                        // Tool step: we have emitted ToolCallRequest and paused.
                        // Leave the step in `Running` status; it will be
                        // finalised by approve_tool_call / deny_tool_call.
                        let _ = agent.emit(AgentEvent::PlanUpdated { steps: updated_steps.clone() });
                        // Do not process further steps until the user responds.
                        return;
                    }

                    // Tool-less step completed — mark as done and continue.
                    updated_steps[i].status = crate::events::PlanStepStatus::Done;
                    let _ = agent.emit(AgentEvent::PlanUpdated { steps: updated_steps.clone() });

                    // Echo the LLM reply as a chat message so the user sees it.
                    let reply = ChatMessage {
                        id:        uuid::Uuid::new_v4().to_string(),
                        role:      "assistant".into(),
                        content:   result.output,
                        timestamp: chrono::Utc::now(),
                    };
                    let _ = agent.emit(AgentEvent::ChatMessage { message: reply });
                }
                Err(e) => {
                    tracing::error!("Executor step {} error: {e}", step_snapshot.index + 1);
                    updated_steps[i].status = crate::events::PlanStepStatus::Failed;
                    let _ = agent.emit(AgentEvent::PlanUpdated { steps: updated_steps.clone() });
                    let err_msg = ChatMessage {
                        id:        uuid::Uuid::new_v4().to_string(),
                        role:      "assistant".into(),
                        content:   format!("⚠️ Step {} failed: {e}", step_snapshot.index + 1),
                        timestamp: chrono::Utc::now(),
                    };
                    let _ = agent.emit(AgentEvent::ChatMessage { message: err_msg });
                    let _ = agent.transition(AgentStatus::Failed);
                    return;
                }
            }
        }

        // ── 4. All steps done ─────────────────────────────────────────────────
        let _ = agent.transition(AgentStatus::Completed);
    });

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
///
/// Grants the permission, transitions the agent to `RunningTool`, then spawns
/// a background task that executes the tool, emits a `ToolCallResult` event,
/// and transitions the agent back to `Completed` or `Failed`.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn approve_tool_call(
    call_id: String,
    cache_session: bool,
    tool: String,
    params: serde_json::Value,
    agent: State<'_, AgentState>,
    perms: State<'_, PermissionManager>,
    db: State<'_, AuditDb>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    if !perms.is_permitted_session(&tool) && cache_session {
        perms.grant_session(&tool);
    }
    // Log permission approval
    db.log_permission_event("tool_call", &tool, "approved", Some(&call_id))
        .map_err(|e| e.to_string())?;

    agent
        .transition(AgentStatus::RunningTool)
        .map_err(|e| e.to_string())?;

    // Execute the tool in a background task so the IPC call returns immediately.
    let tool_name   = tool.clone();
    let params_copy = params.clone();
    let call_id_copy = call_id.clone();

    tokio::spawn(async move {
        let agent = app_handle.state::<AgentState>();
        let db    = app_handle.state::<AuditDb>();

        let start = std::time::Instant::now();
        let result = run_tool(&tool_name, &params_copy).await;
        let duration_ms = start.elapsed().as_millis() as u64;

        match result {
            Ok(output) => {
                let _ = db.log_tool_execution(&tool_name, &params_copy, true, duration_ms, None);
                let ev = ToolCallResult {
                    id:          call_id_copy,
                    tool:        tool_name,
                    success:     true,
                    output:      Some(output),
                    error:       None,
                    duration_ms,
                    timestamp:   chrono::Utc::now(),
                };
                let _ = agent.emit(AgentEvent::ToolCallResult { result: ev });
                let _ = agent.transition(AgentStatus::Completed);
            }
            Err(e) => {
                let err_str = e.to_string();
                let _ = db.log_tool_execution(&tool_name, &params_copy, false, duration_ms, Some(&err_str));
                let ev = ToolCallResult {
                    id:          call_id_copy,
                    tool:        tool_name,
                    success:     false,
                    output:      None,
                    error:       Some(err_str),
                    duration_ms,
                    timestamp:   chrono::Utc::now(),
                };
                let _ = agent.emit(AgentEvent::ToolCallResult { result: ev });
                let _ = agent.transition(AgentStatus::Failed);
            }
        }
    });

    Ok(())
}

/// Dispatch a tool call to the appropriate implementation.
async fn run_tool(tool: &str, params: &serde_json::Value) -> anyhow::Result<serde_json::Value> {
    match tool {
        "fs.readFile" => {
            let path = params["path"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("fs.readFile: missing `path` param"))?;
            crate::tools::fs::read_file(path).await
        }
        "fs.applyPatch" => {
            let path = params["path"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("fs.applyPatch: missing `path` param"))?;
            let patch = params["patch"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("fs.applyPatch: missing `patch` param"))?;
            crate::tools::fs::apply_patch(path, patch).await
        }
        "cmd.run" => {
            let program = params["program"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("cmd.run: missing `program` param"))?;
            let args: Vec<String> = params["args"]
                .as_array()
                .map(|a| {
                    a.iter()
                        .map(|v| {
                            v.as_str()
                                .map(str::to_string)
                                .ok_or_else(|| anyhow::anyhow!("cmd.run: all `args` elements must be strings"))
                        })
                        .collect::<anyhow::Result<Vec<_>>>()
                })
                .transpose()?
                .unwrap_or_default();
            let cwd = params["cwd"].as_str();
            crate::tools::cmd::run(program, &args, cwd).await
        }
        "net.fetch" => {
            let url = params["url"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("net.fetch: missing `url` param"))?;
            let method  = params["method"].as_str().unwrap_or("GET");
            let headers = &params["headers"];
            let body    = params["body"].as_str();
            crate::tools::net::fetch(url, method, headers, body).await
        }
        "desktop.screenshot" => {
            let display = params["display"].as_u64().unwrap_or(0) as u32;
            crate::tools::desktop::screenshot(display).await
        }
        "desktop.clickRectCenter" => {
            let x = params["x"]
                .as_i64()
                .ok_or_else(|| anyhow::anyhow!("desktop.clickRectCenter: missing `x` param"))?
                as i32;
            let y = params["y"]
                .as_i64()
                .ok_or_else(|| anyhow::anyhow!("desktop.clickRectCenter: missing `y` param"))?
                as i32;
            let width = params["width"]
                .as_i64()
                .ok_or_else(|| {
                    anyhow::anyhow!("desktop.clickRectCenter: missing `width` param")
                })?
                as i32;
            let height = params["height"]
                .as_i64()
                .ok_or_else(|| {
                    anyhow::anyhow!("desktop.clickRectCenter: missing `height` param")
                })?
                as i32;
            crate::tools::desktop::click_rect_center(x, y, width, height).await
        }
        "desktop.ocrCloud" => {
            let image_b64 = params["image_b64"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("desktop.ocrCloud: missing `image_b64` param"))?;
            let prompt = params["prompt"].as_str();
            crate::tools::desktop::ocr_cloud(image_b64, prompt).await
        }
        other => Err(anyhow::anyhow!(
            "Tool '{other}' execution is not yet implemented"
        )),
    }
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
        .transition(AgentStatus::Idle)
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

// ── TS Core bridge commands ───────────────────────────────────────────────────

/// Register a full 9-pillar `AgentSpec` with the TS Core `McpServiceListManager`.
///
/// The spec is parsed from a JSON string, forwarded to the TS Core REST API
/// via [`TsBridge`], and also persisted in the local [`TeamRegistry`] for
/// offline access.
///
/// # Arguments
/// * `spec_json` – JSON-serialised [`AgentSpec`]
#[tauri::command]
pub async fn register_agent_spec(
    spec_json: String,
    bridge: State<'_, TsBridge>,
    registry: State<'_, TeamRegistry>,
) -> Result<(), String> {
    // 1. Parse the AgentSpec from the supplied JSON.
    let spec: AgentSpec =
        serde_json::from_str(&spec_json).map_err(|e| format!("Invalid AgentSpec JSON: {e}"))?;

    // 2. Forward to TS Core via the bridge (best-effort; log but don't fail on
    //    connection errors so the desktop app works when the server is offline).
    match bridge.register_agent(&spec).await {
        Ok(()) => {
            tracing::debug!(agent_id = %spec.id, "Registered AgentSpec with TS Core");
        }
        Err(e) => {
            tracing::warn!(agent_id = %spec.id, error = %e, "Could not forward AgentSpec to TS Core");
        }
    }

    // 3. Also persist a minimal identity record in the local TeamRegistry so
    //    the agent is discoverable offline without requiring the TS Core server.
    let identity = AgentIdentity {
        id: spec.id.clone(),
        name: spec.name.clone(),
        role: spec.primary_skill.clone(),
        endpoint: None,
        team_id: "team-default".to_string(),
        is_local: false,
        last_seen: chrono::Utc::now(),
    };
    registry
        .upsert_agent(&identity)
        .map_err(|e| format!("Failed to persist AgentSpec locally: {e}"))?;

    Ok(())
}

/// Route a natural-language query to the best-matching agent(s) via the TS
/// Core routing endpoint.
///
/// Returns a JSON array of [`AgentRouteSuggestion`] objects ranked by score.
/// When the TS Core server is unreachable the command returns an error so the
/// caller can fall back gracefully.
///
/// # Arguments
/// * `query` – natural-language task description
/// * `top_n` – optional cap on the number of suggestions returned
#[tauri::command]
pub async fn route_agent_for_query(
    query: String,
    top_n: Option<usize>,
    bridge: State<'_, TsBridge>,
) -> Result<Vec<AgentRouteSuggestion>, String> {
    bridge
        .route_query(&query, top_n)
        .await
        .map_err(|e| e.to_string())
}
