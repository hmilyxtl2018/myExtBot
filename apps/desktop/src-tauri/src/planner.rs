//! Planning layer: converts a user goal into a structured execution plan.
//!
//! The planner sends the user's goal to the configured LLM with a system
//! prompt that instructs the model to respond with a JSON array of steps.
//! Each step may optionally name a tool to invoke.  If the LLM response
//! cannot be parsed, a single-step fallback plan is returned instead.

use crate::events::{PlanStep, PlanStepStatus};
use anyhow::Result;
use tracing::warn;

/// System prompt used to elicit a structured JSON plan from the LLM.
const PLANNING_SYSTEM_PROMPT: &str = r#"You are a planning agent.
Given a goal, output ONLY a valid JSON array of steps (no markdown, no explanation).
Each element must have:
  "description": string  — what this step does
  "tool": null or one of "fs.readFile" | "fs.applyPatch" | "cmd.run" | "net.fetch"
  "params": object or null — tool parameters if tool is set, otherwise null

Example output:
[
  {"description": "Fetch the page", "tool": "net.fetch", "params": {"url": "https://example.com", "method": "GET"}},
  {"description": "Summarise the result", "tool": null, "params": null}
]"#;

/// Raw step shape deserialized from the LLM JSON output.
#[derive(Debug, serde::Deserialize)]
struct RawStep {
    description: String,
    #[serde(default)]
    tool: Option<String>,
    #[serde(default)]
    params: Option<serde_json::Value>,
}

/// Parse the LLM text into a list of [`PlanStep`]s.
///
/// Looks for the first `[…]` JSON array in `text` and tries to deserialize
/// it.  Returns `None` if no valid array is found.
fn parse_plan(text: &str) -> Option<Vec<PlanStep>> {
    // Find the first '[' and last ']' to extract the JSON array even if the
    // LLM wraps the output in markdown code fences or prose.
    let start = text.find('[')?;
    let end   = text.rfind(']')?;
    if end < start {
        return None;
    }
    let slice = &text[start..=end];
    let raw: Vec<RawStep> = serde_json::from_str(slice).ok()?;
    if raw.is_empty() {
        return None;
    }
    let steps = raw
        .into_iter()
        .enumerate()
        .map(|(i, r)| PlanStep {
            id:          uuid::Uuid::new_v4().to_string(),
            index:       i,
            description: r.description,
            status:      PlanStepStatus::Pending,
            tool:        r.tool,
            params:      r.params,
            result:      None,
        })
        .collect();
    Some(steps)
}

/// Build a fallback single-step plan when the LLM does not return valid JSON.
fn fallback_plan(goal: &str) -> Vec<PlanStep> {
    vec![PlanStep {
        id:          uuid::Uuid::new_v4().to_string(),
        index:       0,
        description: goal.to_string(),
        status:      PlanStepStatus::Pending,
        tool:        None,
        params:      None,
        result:      None,
    }]
}

/// Ask the LLM to produce a structured execution plan for `goal`.
///
/// Sends a chat completion request whose system prompt instructs the model to
/// reply with a JSON array of steps.  If the response cannot be parsed, a
/// single-step fallback plan is returned so the caller can always proceed.
pub async fn plan(goal: &str) -> Result<Vec<PlanStep>> {
    // Combine system prompt + user goal into a single message because
    // `llm::complete` only accepts a single user message string.
    let prompt = format!("{PLANNING_SYSTEM_PROMPT}\n\nGoal: {goal}");
    let resp = crate::llm::complete(&prompt).await?;

    match parse_plan(&resp.text) {
        Some(steps) => Ok(steps),
        None => {
            warn!(
                "Planner: could not parse LLM output as JSON plan, using fallback. \
                 Raw output: {:?}",
                resp.text
            );
            Ok(fallback_plan(goal))
        }
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── parse_plan ────────────────────────────────────────────────────────────

    #[test]
    fn test_parse_plan_valid_json_array() {
        let text = r#"[{"description":"Step one","tool":null,"params":null},{"description":"Step two","tool":"net.fetch","params":{"url":"https://example.com"}}]"#;
        let steps = parse_plan(text).expect("should parse");
        assert_eq!(steps.len(), 2);
        assert_eq!(steps[0].description, "Step one");
        assert_eq!(steps[0].tool, None);
        assert_eq!(steps[1].tool.as_deref(), Some("net.fetch"));
        assert_eq!(steps[1].params.as_ref().unwrap()["url"], "https://example.com");
    }

    #[test]
    fn test_parse_plan_extracts_array_from_prose() {
        // LLM sometimes wraps the JSON in explanation text.
        let text = r#"Here is your plan:
[{"description":"Read file","tool":"fs.readFile","params":{"path":"/tmp/a.txt"}}]
Done."#;
        let steps = parse_plan(text).expect("should parse embedded array");
        assert_eq!(steps.len(), 1);
        assert_eq!(steps[0].tool.as_deref(), Some("fs.readFile"));
    }

    #[test]
    fn test_parse_plan_extracts_array_from_markdown_fence() {
        let text = "```json\n[{\"description\":\"Think\",\"tool\":null,\"params\":null}]\n```";
        let steps = parse_plan(text).expect("should parse inside code fence");
        assert_eq!(steps.len(), 1);
        assert_eq!(steps[0].description, "Think");
    }

    #[test]
    fn test_parse_plan_assigns_sequential_indices() {
        let text = r#"[
          {"description":"A","tool":null,"params":null},
          {"description":"B","tool":null,"params":null},
          {"description":"C","tool":null,"params":null}
        ]"#;
        let steps = parse_plan(text).unwrap();
        assert_eq!(steps[0].index, 0);
        assert_eq!(steps[1].index, 1);
        assert_eq!(steps[2].index, 2);
    }

    #[test]
    fn test_parse_plan_all_steps_start_as_pending() {
        let text = r#"[{"description":"X","tool":null,"params":null}]"#;
        let steps = parse_plan(text).unwrap();
        assert!(matches!(steps[0].status, PlanStepStatus::Pending));
    }

    #[test]
    fn test_parse_plan_result_field_is_none() {
        let text = r#"[{"description":"Y","tool":null,"params":null}]"#;
        let steps = parse_plan(text).unwrap();
        assert!(steps[0].result.is_none());
    }

    #[test]
    fn test_parse_plan_returns_none_for_empty_array() {
        assert!(parse_plan("[]").is_none());
    }

    #[test]
    fn test_parse_plan_returns_none_for_invalid_json() {
        assert!(parse_plan("not json at all").is_none());
    }

    #[test]
    fn test_parse_plan_returns_none_when_no_brackets() {
        assert!(parse_plan("description: do a thing").is_none());
    }

    // ── fallback_plan ─────────────────────────────────────────────────────────

    #[test]
    fn test_fallback_plan_returns_single_step() {
        let steps = fallback_plan("do something");
        assert_eq!(steps.len(), 1);
        assert_eq!(steps[0].description, "do something");
        assert_eq!(steps[0].index, 0);
        assert!(steps[0].tool.is_none());
        assert!(steps[0].params.is_none());
        assert!(steps[0].result.is_none());
        assert!(matches!(steps[0].status, PlanStepStatus::Pending));
    }
}
