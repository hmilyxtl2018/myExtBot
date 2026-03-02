//! Shared data types for the multi-agent collaboration layer.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

// ── Agent identity ────────────────────────────────────────────────────────────

/// Stable identity for one bot instance in the team.
///
/// Each running myExtBot installation has exactly one `AgentIdentity`.
/// Remote agents are discovered and stored in the local `agents` table so
/// every bot knows all of its teammates.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AgentIdentity {
    /// Stable UUID – assigned once at first launch and persisted.
    pub id: String,
    /// Human-readable label, e.g. `"Alice-bot"`.
    pub name: String,
    /// Optional role tag to help route tasks, e.g. `"backend"` or `"pm"`.
    pub role: Option<String>,
    /// WebSocket or HTTP address used by peer agents to reach this bot.
    /// `None` for the local agent (reachable via in-process [`super::bus::CollabBus`]).
    pub endpoint: Option<String>,
    /// Logical team identifier – all bots on the same team share this string.
    pub team_id: String,
    /// Whether this identity represents the bot running in *this* process.
    pub is_local: bool,
    /// Wall-clock time this entry was last updated.
    pub last_seen: DateTime<Utc>,
}

// ── Task ─────────────────────────────────────────────────────────────────────

/// Lifecycle state of a [`Task`].
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    /// Created but not yet picked up.
    Pending,
    /// Assignee has started working on it.
    InProgress,
    /// Completed successfully.
    Done,
    /// Completed with an error.
    Failed,
    /// Abandoned before completion.
    Cancelled,
}

impl TaskStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            TaskStatus::Pending => "pending",
            TaskStatus::InProgress => "in_progress",
            TaskStatus::Done => "done",
            TaskStatus::Failed => "failed",
            TaskStatus::Cancelled => "cancelled",
        }
    }
}

impl std::fmt::Display for TaskStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl TryFrom<&str> for TaskStatus {
    type Error = anyhow::Error;
    fn try_from(s: &str) -> Result<Self, Self::Error> {
        match s {
            "pending" => Ok(TaskStatus::Pending),
            "in_progress" => Ok(TaskStatus::InProgress),
            "done" => Ok(TaskStatus::Done),
            "failed" => Ok(TaskStatus::Failed),
            "cancelled" => Ok(TaskStatus::Cancelled),
            other => Err(anyhow::anyhow!("unknown task status: {other}")),
        }
    }
}

/// A unit of work that can be delegated from one agent to another.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    /// Stable UUID.
    pub id: String,
    /// Short human-readable title.
    pub title: String,
    /// Optional longer description or acceptance criteria.
    pub description: Option<String>,
    /// Current lifecycle state.
    pub status: TaskStatus,
    /// Agent that has been asked to do this work.
    pub assigned_to: Option<String>,
    /// Agent that created / delegated this task.
    pub delegated_by: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    /// JSON result payload – populated when the task transitions to `Done` or `Failed`.
    pub result: Option<serde_json::Value>,
}

// ── Collaboration messages ────────────────────────────────────────────────────

/// Discriminator for [`CollabMessage`].
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MsgType {
    /// Sender is assigning a task to the recipient.
    TaskAssigned,
    /// Assignee is reporting a status change on an existing task.
    TaskUpdate,
    /// Assignee is delivering the final result for a task.
    TaskResult,
    /// Liveness probe – can be used for presence / heartbeat.
    Ping,
}

impl MsgType {
    pub fn as_str(&self) -> &'static str {
        match self {
            MsgType::TaskAssigned => "task_assigned",
            MsgType::TaskUpdate => "task_update",
            MsgType::TaskResult => "task_result",
            MsgType::Ping => "ping",
        }
    }
}

impl TryFrom<&str> for MsgType {
    type Error = anyhow::Error;
    fn try_from(s: &str) -> Result<Self, Self::Error> {
        match s {
            "task_assigned" => Ok(MsgType::TaskAssigned),
            "task_update" => Ok(MsgType::TaskUpdate),
            "task_result" => Ok(MsgType::TaskResult),
            "ping" => Ok(MsgType::Ping),
            other => Err(anyhow::anyhow!("unknown msg_type: {other}")),
        }
    }
}

/// An immutable envelope exchanged between agents.
///
/// Every message is persisted in the `collab_messages` SQLite table so the
/// full inter-agent dialogue can be audited and replayed.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollabMessage {
    /// Stable UUID assigned at creation time.
    pub id: String,
    /// Agent id of the sender.
    pub from_agent: String,
    /// Agent id of the intended recipient.
    pub to_agent: String,
    /// Task this message concerns (if any).
    pub task_id: Option<String>,
    /// Message discriminator.
    pub msg_type: MsgType,
    /// Arbitrary JSON payload – schema depends on `msg_type`.
    pub payload: serde_json::Value,
    pub timestamp: DateTime<Utc>,
}
