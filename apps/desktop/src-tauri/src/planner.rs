//! Planner: converts a user prompt into a structured AgentPlan via a single LLM call.

use anyhow::{anyhow, Result};
use serde_json::Value;

use crate::events::{AgentPlan, AgentPlanStep, RiskLevel};
use crate::llm::{LlmClient, Message};
use crate::tools::ToolRegistry;

const SYSTEM_PROMPT_TEMPLATE: &str = r#"
你是 myExtBot 的任务规划器（Planner）。
你的职责是：接收用户的任务描述，然后把它拆解成一份结构化的执行计划（AgentPlan）。

## 可用工具列表
{tools_list}

## 风险评估规则
- High（高风险）：写文件 / 执行命令 / 鼠标点击 / 网络请求（会修改外部状态）
- Medium（中等风险）：读文件 / 截图 / OCR 识别（只读，但涉及本地资源）
- Low（低风险）：纯查询、无副作用操作

## 输出要求
你**必须**只输出合法 JSON，格式如下，**不得**包含任何 markdown 代码块或多余解释：

{
  "id": "<uuid>",
  "goal": "<对用户意图的简短摘要，不超过 80 字>",
  "overall_risk": "low" | "medium" | "high",
  "requires_credentials": ["<如需凭证，在此列出说明；否则为空数组>"],
  "steps": [
    {
      "id": "<uuid>",
      "index": 0,
      "intent": "<人类可读的步骤描述>",
      "tool": "<工具名，如 fs.read_file>",
      "params_preview": { "<预估参数，可含占位符如 \"<待确认>\">": "..." },
      "depends_on": ["<依赖的步骤 id，支持 DAG；无依赖则为空数组>"],
      "risk": "low" | "medium" | "high",
      "needs_credential": null | "<如 'OA系统密码'>"
    }
  ]
}

## 注意事项
1. 如果任务需要凭证（密码、API Key 等），必须在对应步骤的 needs_credential 字段声明，并加入 requires_credentials 列表。
2. overall_risk 取所有步骤中最高的风险级别。
3. depends_on 填写前序步骤的 id（非 index），无依赖时填空数组。
4. 不要凭空发明工具名，只使用上方列出的工具。
5. 如果任务无法用现有工具完成，在 goal 中说明，steps 设为空数组，overall_risk 设为 "low"。
"#;

fn build_system_prompt(tools: &ToolRegistry) -> String {
    let tool_lines: Vec<String> = tools
        .list_names()
        .into_iter()
        .filter_map(|name| tools.get(name))
        .map(|def| format!("- **{}**: {}", def.name, def.description))
        .collect();
    let tools_list = tool_lines.join("\n");
    SYSTEM_PROMPT_TEMPLATE.replace("{tools_list}", &tools_list)
}

/// Run the Planner: ask the LLM to produce a structured AgentPlan for the given prompt.
pub async fn run_planner(
    user_prompt: &str,
    tools: &ToolRegistry,
    llm: &LlmClient,
) -> Result<AgentPlan> {
    let system = build_system_prompt(tools);
    let messages = vec![
        Message::system(system),
        Message::user(user_prompt),
    ];

    let llm_result = llm
        .chat_completion(messages, None)
        .await
        .map_err(|e| anyhow!("{e}"))?;

    let raw_text = match llm_result.result {
        crate::llm::ThinkResult::Reply(text) => text,
        crate::llm::ThinkResult::ToolCalls(_) => {
            return Err(anyhow!("Planner unexpectedly returned tool calls instead of a JSON plan"));
        }
    };

    let plan = parse_plan(&raw_text)?;
    Ok(plan)
}

/// Parse the raw LLM text into an AgentPlan.
fn parse_plan(raw: &str) -> Result<AgentPlan> {
    // Strip optional markdown code fences the model may have added despite instructions
    let json_str = strip_code_fence(raw);

    let val: Value = serde_json::from_str(json_str)
        .map_err(|e| anyhow!("Planner returned invalid JSON: {e}\nRaw: {json_str}"))?;

    // Ensure we got a valid id; if the LLM forgot to generate one, create one ourselves
    let id = val["id"]
        .as_str()
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

    let goal = val["goal"]
        .as_str()
        .unwrap_or("(no goal)")
        .to_string();

    let overall_risk = parse_risk(&val["overall_risk"]).unwrap_or(RiskLevel::Medium);

    let requires_credentials: Vec<String> = val["requires_credentials"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

    let steps = val["steps"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .enumerate()
                .map(|(i, s)| parse_step(s, i))
                .collect::<Result<Vec<_>>>()
        })
        .unwrap_or_else(|| Ok(vec![]))?;

    Ok(AgentPlan {
        id,
        goal,
        steps,
        overall_risk,
        requires_credentials,
    })
}

fn parse_step(val: &Value, fallback_index: usize) -> Result<AgentPlanStep> {
    let id = val["id"]
        .as_str()
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

    let index = val["index"].as_u64().unwrap_or(fallback_index as u64) as usize;

    let intent = val["intent"]
        .as_str()
        .unwrap_or("(no description)")
        .to_string();

    let tool = val["tool"].as_str().unwrap_or("").to_string();

    let params_preview = val["params_preview"].clone();

    let depends_on: Vec<String> = val["depends_on"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

    let risk = parse_risk(&val["risk"]).unwrap_or(RiskLevel::Medium);

    let needs_credential = if val["needs_credential"].is_null() {
        None
    } else {
        val["needs_credential"]
            .as_str()
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
    };

    Ok(AgentPlanStep {
        id,
        index,
        intent,
        tool,
        params_preview,
        depends_on,
        risk,
        needs_credential,
    })
}

fn parse_risk(val: &Value) -> Option<RiskLevel> {
    match val.as_str()? {
        "low" => Some(RiskLevel::Low),
        "medium" => Some(RiskLevel::Medium),
        "high" => Some(RiskLevel::High),
        _ => None,
    }
}

/// Remove markdown code fences if the model wrapped its output.
fn strip_code_fence(s: &str) -> &str {
    let s = s.trim();
    // ```json ... ``` or ``` ... ```
    if s.starts_with("```") {
        let after_fence = s.trim_start_matches('`');
        // skip optional language tag (e.g. "json\n")
        let after_lang = after_fence
            .find('\n')
            .map(|pos| &after_fence[pos + 1..])
            .unwrap_or(after_fence);
        // strip trailing ```
        let stripped = after_lang.trim_end().trim_end_matches('`').trim_end();
        stripped
    } else {
        s
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_strip_code_fence() {
        let raw = "```json\n{\"foo\":1}\n```";
        assert_eq!(strip_code_fence(raw), "{\"foo\":1}");
    }

    #[test]
    fn test_strip_no_fence() {
        let raw = "{\"foo\":1}";
        assert_eq!(strip_code_fence(raw), "{\"foo\":1}");
    }

    #[test]
    fn test_parse_plan_minimal() {
        let raw = r#"{
            "id": "plan-1",
            "goal": "test goal",
            "overall_risk": "low",
            "requires_credentials": [],
            "steps": []
        }"#;
        let plan = parse_plan(raw).unwrap();
        assert_eq!(plan.id, "plan-1");
        assert_eq!(plan.goal, "test goal");
        assert!(plan.steps.is_empty());
    }

    #[test]
    fn test_parse_plan_with_steps() {
        let raw = r#"{
            "id": "plan-2",
            "goal": "read a file",
            "overall_risk": "medium",
            "requires_credentials": [],
            "steps": [
                {
                    "id": "step-1",
                    "index": 0,
                    "intent": "read the file",
                    "tool": "fs.read_file",
                    "params_preview": {"path": "/tmp/test.txt"},
                    "depends_on": [],
                    "risk": "medium",
                    "needs_credential": null
                }
            ]
        }"#;
        let plan = parse_plan(raw).unwrap();
        assert_eq!(plan.steps.len(), 1);
        assert_eq!(plan.steps[0].tool, "fs.read_file");
    }

    #[test]
    fn test_parse_plan_invalid_json() {
        let raw = "not json";
        assert!(parse_plan(raw).is_err());
    }

    #[test]
    fn test_parse_plan_with_code_fence() {
        let raw = "```json\n{\"id\":\"p1\",\"goal\":\"g\",\"overall_risk\":\"low\",\"requires_credentials\":[],\"steps\":[]}\n```";
        let plan = parse_plan(raw).unwrap();
        assert_eq!(plan.id, "p1");
    }
}
