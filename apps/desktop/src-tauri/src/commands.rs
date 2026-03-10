//! Tauri IPC commands exposed to the frontend.

use std::pin::Pin;
use std::future::Future;
use std::sync::{Arc, Mutex};

use tauri::{Emitter, State};
use tokio::sync::oneshot;

use crate::agent::AgentState;
use crate::audit::AuditDb;
use crate::events::{AgentEvent, AgentPlan, AgentStatus, ChatMessage, ToolCallRequest};
use crate::executor::{run_executor, ApprovalGate};
use crate::llm::LlmClient;
use crate::permissions::PermissionManager;
use crate::planner::run_planner;
use crate::tools::ToolRegistry;

/// Send a user chat message and kick off the Planner → Executor pipeline.
#[tauri::command]
pub async fn send_message(
    content: String,
    agent: State<'_, AgentState>,
    db: State<'_, AuditDb>,
    llm: State<'_, LlmClient>,
    tools: State<'_, ToolRegistry>,
) -> Result<(), String> {
    // 1. Log user message and broadcast ChatMessage event
    let msg_id = uuid::Uuid::new_v4().to_string();
    db.log_message(&msg_id, agent.session_id(), "user", &content)
        .map_err(|e| e.to_string())?;

    let msg = ChatMessage {
        id: msg_id,
        role: "user".into(),
        content: content.clone(),
        timestamp: chrono::Utc::now(),
    };
    agent
        .emit(AgentEvent::ChatMessage { message: msg })
        .map_err(|e| e.to_string())?;

    // 2. Transition Idle → Planning, emit PlanningStarted
    agent
        .transition(AgentStatus::Planning)
        .map_err(|e| e.to_string())?;
    agent
        .emit(AgentEvent::PlanningStarted)
        .map_err(|e| e.to_string())?;

    // 3. Run planner — graceful degradation if no API key
    let plan: AgentPlan = match run_planner(&content, &tools, &llm).await {
        Ok(p) => p,
        Err(e) => {
            let err_msg = e.to_string();
            agent
                .transition(AgentStatus::Failed)
                .map_err(|f| f.to_string())?;
            let err_id = uuid::Uuid::new_v4().to_string();
            let chat_err = ChatMessage {
                id: err_id,
                role: "assistant".into(),
                content: format!("规划失败：{err_msg}"),
                timestamp: chrono::Utc::now(),
            };
            let _ = agent.emit(AgentEvent::ChatMessage { message: chat_err });
            return Ok(());
        }
    };

    // Log the planning LLM call (token counts not tracked at this level)
    let plan_llm_id = uuid::Uuid::new_v4().to_string();
    let _ = db.log_llm_call(
        &plan_llm_id,
        agent.session_id(),
        "planning",
        llm.model(),
        0,
        0,
        0,
    );

    // 4. Emit PlanReady and transition → WaitingPlanApproval
    agent
        .emit(AgentEvent::PlanReady { plan: plan.clone() })
        .map_err(|e| e.to_string())?;
    agent
        .transition(AgentStatus::WaitingPlanApproval)
        .map_err(|e| e.to_string())?;

    // 5. Wait for approve_plan / deny_plan from the frontend
    let approval_rx = agent.register_plan_approval();
    let approved = approval_rx.await.unwrap_or(false);

    if !approved {
        agent
            .transition(AgentStatus::Idle)
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    // 6. User approved — transition → Thinking, start executor
    agent
        .transition(AgentStatus::Thinking)
        .map_err(|e| e.to_string())?;

    // Build the approval gate using cloneable handles — no unsafe pointer needed.
    // When the executor needs user approval for a tool call, it invokes this gate,
    // which registers a oneshot channel, emits the ToolCallRequest event, and
    // waits until approve_tool_call / deny_tool_call resolves the channel.
    let agent_ref: &AgentState = &*agent;
    let app_handle = agent_ref.app_handle();
    let tool_approval_arc: Arc<Mutex<Option<oneshot::Sender<bool>>>> =
        agent_ref.tool_approval_arc();
    let approval_gate: ApprovalGate = Box::new(move |req: ToolCallRequest| -> Pin<Box<dyn Future<Output = bool> + Send>> {
        let app_h = app_handle.clone();
        let tx_arc = tool_approval_arc.clone();
        Box::pin(async move {
            let (tx, rx) = oneshot::channel();
            *tx_arc.lock().unwrap() = Some(tx);
            // Emit event so the UI can show the approval dialog
            let _ = app_h.emit(AgentEvent::EVENT_NAME, &AgentEvent::ToolCallRequest { request: req });
            rx.await.unwrap_or(false)
        })
    });

    // 7. Execute the plan
    let exec_result = run_executor(&plan, &tools, &llm, agent_ref, &db, &approval_gate).await;

    // 8. Transition to Completed or Failed
    match exec_result {
        Ok(_) => {
            agent
                .transition(AgentStatus::Completed)
                .map_err(|e| e.to_string())?;
        }
        Err(e) => {
            agent
                .transition(AgentStatus::Failed)
                .map_err(|e2| e2.to_string())?;
            let err_id = uuid::Uuid::new_v4().to_string();
            let chat_err = ChatMessage {
                id: err_id,
                role: "assistant".into(),
                content: format!("执行失败：{}", e),
                timestamp: chrono::Utc::now(),
            };
            let _ = agent.emit(AgentEvent::ChatMessage { message: chat_err });
        }
    }

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
    // Signal the executor that the tool call was approved
    agent.resolve_tool_approval(true);
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
    // Signal the executor that the tool call was denied
    agent.resolve_tool_approval(false);
    agent
        .transition(crate::events::AgentStatus::Idle)
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// User approves the proposed plan.
#[tauri::command]
pub fn approve_plan(agent: State<'_, AgentState>) -> Result<(), String> {
    agent.resolve_plan_approval(true);
    Ok(())
}

/// User denies (cancels) the proposed plan.
#[tauri::command]
pub fn deny_plan(agent: State<'_, AgentState>) -> Result<(), String> {
    agent.resolve_plan_approval(false);
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

