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

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    // ── TaskStatus ────────────────────────────────────────────────────────────

    #[test]
    fn test_task_status_as_str() {
        assert_eq!(TaskStatus::Pending.as_str(),    "pending");
        assert_eq!(TaskStatus::InProgress.as_str(), "in_progress");
        assert_eq!(TaskStatus::Done.as_str(),       "done");
        assert_eq!(TaskStatus::Failed.as_str(),     "failed");
        assert_eq!(TaskStatus::Cancelled.as_str(),  "cancelled");
    }

    #[test]
    fn test_task_status_display() {
        assert_eq!(TaskStatus::Pending.to_string(),    "pending");
        assert_eq!(TaskStatus::InProgress.to_string(), "in_progress");
        assert_eq!(TaskStatus::Done.to_string(),       "done");
    }

    #[test]
    fn test_task_status_try_from_valid_strings() {
        assert_eq!(TaskStatus::try_from("pending").unwrap(),     TaskStatus::Pending);
        assert_eq!(TaskStatus::try_from("in_progress").unwrap(), TaskStatus::InProgress);
        assert_eq!(TaskStatus::try_from("done").unwrap(),        TaskStatus::Done);
        assert_eq!(TaskStatus::try_from("failed").unwrap(),      TaskStatus::Failed);
        assert_eq!(TaskStatus::try_from("cancelled").unwrap(),   TaskStatus::Cancelled);
    }

    #[test]
    fn test_task_status_try_from_invalid_string_is_err() {
        assert!(TaskStatus::try_from("DONE").is_err());
        assert!(TaskStatus::try_from("unknown").is_err());
        assert!(TaskStatus::try_from("").is_err());
    }

    #[test]
    fn test_task_status_round_trip_via_as_str() {
        let statuses = [
            TaskStatus::Pending,
            TaskStatus::InProgress,
            TaskStatus::Done,
            TaskStatus::Failed,
            TaskStatus::Cancelled,
        ];
        for s in &statuses {
            let back = TaskStatus::try_from(s.as_str()).unwrap();
            assert_eq!(back, *s);
        }
    }

    #[test]
    fn test_task_status_serializes_snake_case() {
        let json = serde_json::to_value(TaskStatus::InProgress).unwrap();
        assert_eq!(json.as_str().unwrap(), "in_progress");
        let json = serde_json::to_value(TaskStatus::Cancelled).unwrap();
        assert_eq!(json.as_str().unwrap(), "cancelled");
    }

    // ── MsgType ───────────────────────────────────────────────────────────────

    #[test]
    fn test_msg_type_as_str() {
        assert_eq!(MsgType::TaskAssigned.as_str(), "task_assigned");
        assert_eq!(MsgType::TaskUpdate.as_str(),   "task_update");
        assert_eq!(MsgType::TaskResult.as_str(),   "task_result");
        assert_eq!(MsgType::Ping.as_str(),         "ping");
    }

    #[test]
    fn test_msg_type_try_from_valid_strings() {
        assert_eq!(MsgType::try_from("task_assigned").unwrap(), MsgType::TaskAssigned);
        assert_eq!(MsgType::try_from("task_update").unwrap(),   MsgType::TaskUpdate);
        assert_eq!(MsgType::try_from("task_result").unwrap(),   MsgType::TaskResult);
        assert_eq!(MsgType::try_from("ping").unwrap(),          MsgType::Ping);
    }

    #[test]
    fn test_msg_type_try_from_invalid_string_is_err() {
        assert!(MsgType::try_from("PING").is_err());
        assert!(MsgType::try_from("unknown").is_err());
        assert!(MsgType::try_from("").is_err());
    }

    #[test]
    fn test_msg_type_round_trip_via_as_str() {
        let types = [MsgType::TaskAssigned, MsgType::TaskUpdate, MsgType::TaskResult, MsgType::Ping];
        for t in &types {
            let back = MsgType::try_from(t.as_str()).unwrap();
            assert_eq!(back, *t);
        }
    }

    #[test]
    fn test_msg_type_serializes_snake_case() {
        let json = serde_json::to_value(MsgType::TaskAssigned).unwrap();
        assert_eq!(json.as_str().unwrap(), "task_assigned");
        let json = serde_json::to_value(MsgType::Ping).unwrap();
        assert_eq!(json.as_str().unwrap(), "ping");
    }

    // ── AgentIdentity ─────────────────────────────────────────────────────────

    #[test]
    fn test_agent_identity_round_trips_through_json() {
        let agent = AgentIdentity {
            id: "agent-1".into(),
            name: "Test-bot".into(),
            role: Some("dev".into()),
            endpoint: Some("ws://localhost:9000".into()),
            team_id: "team-alpha".into(),
            is_local: true,
            last_seen: Utc::now(),
        };
        let json = serde_json::to_value(&agent).unwrap();
        let back: AgentIdentity = serde_json::from_value(json).unwrap();
        assert_eq!(back.id, agent.id);
        assert_eq!(back.name, agent.name);
        assert_eq!(back.role, agent.role);
        assert_eq!(back.is_local, agent.is_local);
    }

    #[test]
    fn test_agent_identity_optional_fields_can_be_none() {
        let agent = AgentIdentity {
            id: "a2".into(),
            name: "Minimal-bot".into(),
            role: None,
            endpoint: None,
            team_id: "t1".into(),
            is_local: false,
            last_seen: Utc::now(),
        };
        let json = serde_json::to_value(&agent).unwrap();
        assert!(json["role"].is_null());
        assert!(json["endpoint"].is_null());
    }

    // ── CollabMessage ─────────────────────────────────────────────────────────

    #[test]
    fn test_collab_message_round_trips_through_json() {
        let msg = CollabMessage {
            id: "msg-1".into(),
            from_agent: "a1".into(),
            to_agent: "b1".into(),
            task_id: Some("task-1".into()),
            msg_type: MsgType::TaskAssigned,
            payload: serde_json::json!({"note": "high priority"}),
            timestamp: Utc::now(),
        };
        let json = serde_json::to_value(&msg).unwrap();
        let back: CollabMessage = serde_json::from_value(json).unwrap();
        assert_eq!(back.id, msg.id);
        assert_eq!(back.msg_type, MsgType::TaskAssigned);
        assert_eq!(back.payload["note"], "high priority");
    }
}
