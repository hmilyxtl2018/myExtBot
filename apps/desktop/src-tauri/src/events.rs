use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// All agent lifecycle states.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AgentStatus {
    Idle,
    Thinking,
    WaitingApproval,
    RunningTool,
    Stopped,
    Completed,
    Failed,
}

/// Risk level of a proposed tool call.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RiskLevel {
    Low,
    Medium,
    High,
}

/// A tool call proposed by the agent, awaiting user approval.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallRequest {
    pub id: String,
    pub tool: String,
    pub params: serde_json::Value,
    pub risk: RiskLevel,
    pub description: String,
    pub timestamp: DateTime<Utc>,
}

/// Result after a tool call completes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallResult {
    pub id: String,
    pub tool: String,
    pub success: bool,
    pub output: Option<serde_json::Value>,
    pub error: Option<String>,
    pub duration_ms: u64,
    pub timestamp: DateTime<Utc>,
}

/// A chat message from user or agent.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub id: String,
    pub role: String, // "user" | "assistant" | "system"
    pub content: String,
    pub timestamp: DateTime<Utc>,
}

/// A single plan step.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanStep {
    pub id: String,
    pub index: usize,
    pub description: String,
    pub status: PlanStepStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PlanStepStatus {
    Pending,
    Running,
    Done,
    Failed,
    Skipped,
}

/// Union of all events emitted to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum AgentEvent {
    StatusChanged { status: AgentStatus },
    ChatMessage { message: ChatMessage },
    PlanUpdated { steps: Vec<PlanStep> },
    ToolCallRequest { request: ToolCallRequest },
    ToolCallResult { result: ToolCallResult },
    EmergencyStop,
}

impl AgentEvent {
    pub const EVENT_NAME: &'static str = "agent-event";
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── AgentStatus ───────────────────────────────────────────────────────────

    #[test]
    fn test_agent_status_variants_are_distinct() {
        assert_ne!(AgentStatus::Idle, AgentStatus::Thinking);
        assert_ne!(AgentStatus::Thinking, AgentStatus::WaitingApproval);
        assert_ne!(AgentStatus::WaitingApproval, AgentStatus::RunningTool);
        assert_ne!(AgentStatus::RunningTool, AgentStatus::Completed);
        assert_ne!(AgentStatus::Completed, AgentStatus::Failed);
        assert_ne!(AgentStatus::Failed, AgentStatus::Stopped);
    }

    #[test]
    fn test_agent_status_clone_equals_original() {
        let s = AgentStatus::RunningTool;
        assert_eq!(s.clone(), AgentStatus::RunningTool);
    }

    #[test]
    fn test_agent_status_serializes_to_string() {
        let json = serde_json::to_value(AgentStatus::Thinking).unwrap();
        assert_eq!(json.as_str().unwrap(), "Thinking");
        let json = serde_json::to_value(AgentStatus::WaitingApproval).unwrap();
        assert_eq!(json.as_str().unwrap(), "WaitingApproval");
    }

    #[test]
    fn test_agent_status_round_trips_through_json() {
        let statuses = [
            AgentStatus::Idle,
            AgentStatus::Thinking,
            AgentStatus::WaitingApproval,
            AgentStatus::RunningTool,
            AgentStatus::Stopped,
            AgentStatus::Completed,
            AgentStatus::Failed,
        ];
        for s in &statuses {
            let json = serde_json::to_value(s).unwrap();
            let back: AgentStatus = serde_json::from_value(json).unwrap();
            assert_eq!(back, *s);
        }
    }

    // ── AgentEvent ────────────────────────────────────────────────────────────

    #[test]
    fn test_event_name_constant() {
        assert_eq!(AgentEvent::EVENT_NAME, "agent-event");
    }

    #[test]
    fn test_status_changed_event_serializes_with_type_tag() {
        let event = AgentEvent::StatusChanged {
            status: AgentStatus::Idle,
        };
        let json = serde_json::to_value(&event).unwrap();
        assert_eq!(json["type"], "StatusChanged");
        assert_eq!(json["status"], "Idle");
    }

    #[test]
    fn test_emergency_stop_event_serializes_with_type_tag() {
        let event = AgentEvent::EmergencyStop;
        let json = serde_json::to_value(&event).unwrap();
        assert_eq!(json["type"], "EmergencyStop");
    }

    #[test]
    fn test_chat_message_event_contains_message_field() {
        let msg = ChatMessage {
            id: "msg-1".into(),
            role: "user".into(),
            content: "hello".into(),
            timestamp: chrono::Utc::now(),
        };
        let event = AgentEvent::ChatMessage { message: msg };
        let json = serde_json::to_value(&event).unwrap();
        assert_eq!(json["type"], "ChatMessage");
        assert_eq!(json["message"]["role"], "user");
        assert_eq!(json["message"]["content"], "hello");
    }

    // ── RiskLevel ─────────────────────────────────────────────────────────────

    #[test]
    fn test_risk_level_serializes_lowercase() {
        assert_eq!(
            serde_json::to_value(RiskLevel::Low).unwrap().as_str().unwrap(),
            "low"
        );
        assert_eq!(
            serde_json::to_value(RiskLevel::Medium).unwrap().as_str().unwrap(),
            "medium"
        );
        assert_eq!(
            serde_json::to_value(RiskLevel::High).unwrap().as_str().unwrap(),
            "high"
        );
    }

    // ── PlanStepStatus ────────────────────────────────────────────────────────

    #[test]
    fn test_plan_step_status_serializes_lowercase() {
        assert_eq!(
            serde_json::to_value(PlanStepStatus::Pending).unwrap().as_str().unwrap(),
            "pending"
        );
        assert_eq!(
            serde_json::to_value(PlanStepStatus::Done).unwrap().as_str().unwrap(),
            "done"
        );
        assert_eq!(
            serde_json::to_value(PlanStepStatus::Failed).unwrap().as_str().unwrap(),
            "failed"
        );
        assert_eq!(
            serde_json::to_value(PlanStepStatus::Skipped).unwrap().as_str().unwrap(),
            "skipped"
        );
    }
}
