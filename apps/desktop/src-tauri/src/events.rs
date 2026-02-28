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
