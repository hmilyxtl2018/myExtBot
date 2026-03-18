//! Executor: iterates over an AgentPlan, calling the LLM once per step to
//! determine precise parameters, then dispatching the actual tool call.

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;

use anyhow::{anyhow, Result};
use serde_json::{json, Value};

use crate::agent::AgentState;
use crate::audit::AuditDb;
use crate::events::{AgentEvent, AgentPlan, AgentStatus, ToolCallRequest, ToolCallResult};
use crate::llm::{LlmClient, Message, ThinkResult};
use crate::tools::ToolRegistry;

const EXECUTOR_SYSTEM: &str = r#"
你是 myExtBot 的执行器（Executor）。
你的职责是：根据给定的步骤意图，精确确定工具调用的参数，然后调用对应工具。
请只调用一个工具，并选择最合适的参数。不要解释，直接发出工具调用。
"#;

/// Approval gate: given a ToolCallRequest, returns true if the user approved.
pub type ApprovalGate = Box<
    dyn Fn(ToolCallRequest) -> Pin<Box<dyn Future<Output = bool> + Send>> + Send + Sync,
>;

/// Execute an AgentPlan step-by-step.
///
/// For each step:
/// 1. Build a focused context (system + intent + prior results summary).
/// 2. Call the LLM to get precise tool parameters.
/// 3. Ask the approval gate (may wait for user input).
/// 4. Execute the tool (or record failure and continue).
/// 5. Emit events and log to audit DB after each step.
pub async fn run_executor(
    plan: &AgentPlan,
    tools: &ToolRegistry,
    llm: &LlmClient,
    agent: &AgentState,
    db: &AuditDb,
    approval_gate: &ApprovalGate,
) -> Result<()> {
    // Topological ordering: simple approach — iterate until all steps are scheduled.
    let ordered = topological_sort(plan)?;

    // step_id → output Value from tool execution
    let mut step_results: HashMap<String, Value> = HashMap::new();

    for step in &ordered {
        // Build a summary of prior steps
        let prior_summary = build_prior_summary(&ordered, &step_results, &step.id);

        let messages = vec![
            Message::system(format!(
                "{}\n\n## 当前步骤\n{}\n\n## 前序结果摘要\n{}",
                EXECUTOR_SYSTEM.trim(),
                step.intent,
                prior_summary
            )),
            Message::user(format!(
                "请调用工具「{}」完成当前步骤：{}",
                step.tool, step.intent
            )),
        ];

        // Build tool list scoped to the required tool only (plus all tools as fallback)
        let tool_schemas = crate::llm::tools_schema(tools);

        agent
            .transition(AgentStatus::Thinking)
            .map_err(|e| anyhow!("{e}"))?;

        let llm_result = match llm.chat_completion(messages, Some(tool_schemas)).await {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!("LLM call failed for step {}: {e}", step.id);
                record_step_failure(agent, db, &step.id, &step.tool, &e.to_string())?;
                step_results.insert(step.id.clone(), json!({"error": e.to_string()}));
                continue;
            }
        };

        // Log the LLM call
        let llm_call_id = uuid::Uuid::new_v4().to_string();
        let _ = db.log_llm_call(
            &llm_call_id,
            agent.session_id(),
            "executing",
            llm.model(),
            llm_result.usage.prompt_tokens,
            llm_result.usage.completion_tokens,
            llm_result.duration_ms,
        );

        let tool_calls = match llm_result.result {
            ThinkResult::ToolCalls(tc) => tc,
            ThinkResult::Reply(text) => {
                // LLM gave a text reply instead of tool call; record as step result
                tracing::warn!("Executor step {} got text reply instead of tool call: {}", step.id, text);
                step_results.insert(step.id.clone(), json!({"reply": text}));
                continue;
            }
        };

        let tc = match tool_calls.into_iter().next() {
            Some(tc) => tc,
            None => {
                step_results.insert(step.id.clone(), json!({"error": "no tool call returned"}));
                continue;
            }
        };

        // Parse arguments
        let params: Value = serde_json::from_str(&tc.function.arguments)
            .unwrap_or(json!({}));

        let risk = step.risk.clone();

        // Build the approval request
        let call_id = uuid::Uuid::new_v4().to_string();
        let request = ToolCallRequest {
            id: call_id.clone(),
            tool: tc.function.name.clone(),
            params: params.clone(),
            risk,
            description: step.intent.clone(),
            timestamp: chrono::Utc::now(),
        };

        // Transition to WaitingApproval and invoke the approval gate.
        // The gate is responsible for emitting the ToolCallRequest event to the UI.
        agent
            .transition(AgentStatus::WaitingApproval)
            .map_err(|e| anyhow!("{e}"))?;

        let approved = approval_gate(request.clone()).await;

        if !approved {
            let params_json = serde_json::to_string(&params).unwrap_or_default();
            let _ = db.log_tool_call(&call_id, agent.session_id(), &tc.function.name, &params_json, false);
            tracing::info!("Step {} denied by user", step.id);
            step_results.insert(step.id.clone(), json!({"error": "denied by user"}));
            continue;
        }

        // Log approved tool call
        let params_json = serde_json::to_string(&params).unwrap_or_default();
        let _ = db.log_tool_call(&call_id, agent.session_id(), &tc.function.name, &params_json, true);

        agent
            .transition(AgentStatus::RunningTool)
            .map_err(|e| anyhow!("{e}"))?;

        let tool_start = std::time::Instant::now();
        let exec_result = dispatch_tool(tools, &tc.function.name, &params).await;
        let duration_ms = tool_start.elapsed().as_millis() as u64;

        let (success, output, error) = match exec_result {
            Ok(val) => (true, Some(val), None),
            Err(e) => (false, None, Some(e.to_string())),
        };

        let result_event = ToolCallResult {
            id: call_id.clone(),
            tool: tc.function.name.clone(),
            success,
            output: output.clone(),
            error: error.clone(),
            duration_ms,
            timestamp: chrono::Utc::now(),
        };

        agent
            .emit(AgentEvent::ToolCallResult {
                result: result_event,
            })
            .map_err(|e| anyhow!("{e}"))?;

        let result_json = serde_json::to_string(&output).unwrap_or_default();
        let _ = db.update_tool_call_result(&call_id, &result_json, duration_ms);

        // Store step result
        if success {
            step_results.insert(
                step.id.clone(),
                output.unwrap_or(json!({"success": true})),
            );
        } else {
            let err_str = error.as_deref().unwrap_or("unknown error");
            tracing::warn!("Step {} tool call failed: {}", step.id, err_str);
            step_results.insert(step.id.clone(), json!({"error": err_str}));
        }
    }

    Ok(())
}

/// Simple topological sort using Kahn's algorithm.
fn topological_sort(plan: &AgentPlan) -> Result<Vec<crate::events::AgentPlanStep>> {
    use crate::events::AgentPlanStep;
    use std::collections::{HashSet, VecDeque};

    let steps = &plan.steps;
    if steps.is_empty() {
        return Ok(vec![]);
    }

    // Build id → index map
    let id_to_idx: HashMap<&str, usize> = steps
        .iter()
        .enumerate()
        .map(|(i, s)| (s.id.as_str(), i))
        .collect();

    // In-degree
    let mut in_degree: Vec<usize> = vec![0; steps.len()];
    let mut adj: Vec<Vec<usize>> = vec![vec![]; steps.len()];

    for (i, step) in steps.iter().enumerate() {
        for dep in &step.depends_on {
            if let Some(&dep_idx) = id_to_idx.get(dep.as_str()) {
                adj[dep_idx].push(i);
                in_degree[i] += 1;
            }
        }
    }

    let mut queue: VecDeque<usize> = (0..steps.len())
        .filter(|&i| in_degree[i] == 0)
        .collect();

    let mut ordered: Vec<AgentPlanStep> = Vec::with_capacity(steps.len());
    let mut visited: HashSet<usize> = HashSet::new();

    while let Some(idx) = queue.pop_front() {
        if visited.contains(&idx) {
            continue;
        }
        visited.insert(idx);
        ordered.push(steps[idx].clone());
        for &next in &adj[idx] {
            in_degree[next] -= 1;
            if in_degree[next] == 0 {
                queue.push_back(next);
            }
        }
    }

    if ordered.len() != steps.len() {
        return Err(anyhow!("Plan contains a dependency cycle"));
    }

    Ok(ordered)
}

/// Build a short summary of prior step results for the LLM context.
fn build_prior_summary(
    ordered: &[crate::events::AgentPlanStep],
    results: &HashMap<String, Value>,
    current_id: &str,
) -> String {
    let mut lines = Vec::new();
    for step in ordered {
        if step.id == current_id {
            break;
        }
        if let Some(result) = results.get(&step.id) {
            // Truncate large outputs safely (respecting UTF-8 character boundaries)
            let result_str = result.to_string();
            let truncated = if result_str.len() > 300 {
                let safe: String = result_str.chars().take(300).collect();
                format!("{}…(truncated)", safe)
            } else {
                result_str
            };
            lines.push(format!("- 步骤「{}」({}): {}", step.index + 1, step.intent, truncated));
        }
    }
    if lines.is_empty() {
        "（无前序步骤）".to_string()
    } else {
        lines.join("\n")
    }
}

/// Record a step failure event without crashing the overall executor.
fn record_step_failure(
    agent: &AgentState,
    _db: &AuditDb,
    step_id: &str,
    tool: &str,
    error: &str,
) -> Result<()> {
    tracing::warn!("Step {step_id} ({tool}) failed: {error}");
    // Emit a synthetic failed ToolCallResult so the UI can show the failure
    let result = ToolCallResult {
        id: step_id.to_string(),
        tool: tool.to_string(),
        success: false,
        output: None,
        error: Some(error.to_string()),
        duration_ms: 0,
        timestamp: chrono::Utc::now(),
    };
    agent
        .emit(AgentEvent::ToolCallResult { result })
        .map_err(|e| anyhow!("{e}"))?;
    Ok(())
}

/// Dispatch a tool call to the actual tool implementation.
/// Returns Ok(Value) on success or Err on failure.
async fn dispatch_tool(registry: &ToolRegistry, tool_name: &str, params: &Value) -> Result<Value> {
    // Validate params first
    registry.validate_params(tool_name, params)?;

    match tool_name {
        "fs.readFile" => {
            let path = params["path"]
                .as_str()
                .ok_or_else(|| anyhow!("missing path"))?;
            crate::tools::fs::read_file(path).await
        }
        "fs.applyPatch" => {
            let path = params["path"].as_str().ok_or_else(|| anyhow!("missing path"))?;
            let patch = params["patch"].as_str().ok_or_else(|| anyhow!("missing patch"))?;
            crate::tools::fs::apply_patch(path, patch).await
        }
        "cmd.run" => {
            let program = params["program"].as_str().ok_or_else(|| anyhow!("missing program"))?;
            let args: Vec<String> = params["args"]
                .as_array()
                .map(|a| a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
                .unwrap_or_default();
            let cwd = params["cwd"].as_str();
            crate::tools::cmd::run(program, &args, cwd).await
        }
        "net.fetch" => {
            let url = params["url"].as_str().ok_or_else(|| anyhow!("missing url"))?;
            let method = params["method"].as_str().unwrap_or("GET");
            let headers = &params["headers"];
            let body = params["body"].as_str();
            crate::tools::net::fetch(url, method, headers, body).await
        }
        "desktop.screenshot" => {
            let display = params["display"].as_u64().unwrap_or(0) as u32;
            crate::tools::desktop::screenshot(display).await
        }
        "desktop.getActiveWindowInfo" => {
            crate::tools::desktop::get_active_window_info().await
        }
        "desktop.clickRectCenter" => {
            let x = params["x"].as_i64().ok_or_else(|| anyhow!("missing x"))? as i32;
            let y = params["y"].as_i64().ok_or_else(|| anyhow!("missing y"))? as i32;
            let w = params["width"].as_i64().ok_or_else(|| anyhow!("missing width"))? as i32;
            let h = params["height"].as_i64().ok_or_else(|| anyhow!("missing height"))? as i32;
            crate::tools::desktop::click_rect_center(x, y, w, h).await
        }
        "desktop.ocrCloud" => {
            let image_b64 = params["image_b64"].as_str().ok_or_else(|| anyhow!("missing image_b64"))?;
            let prompt = params["prompt"].as_str();
            crate::tools::desktop::ocr_cloud(image_b64, prompt).await
        }
        other => Err(anyhow!("Unknown tool: {other}")),
    }
}
