//! SQLite-backed persistence for the multi-agent collaboration layer.
//!
//! [`TeamRegistry`] wraps the three collaboration tables:
//! - `agents`          – known bot identities in the team
//! - `tasks`           – delegated work items
//! - `collab_messages` – immutable inter-agent message log

use anyhow::Result;
use chrono::Utc;
use rusqlite::{params, Connection};
use serde_json::json;
use std::sync::Mutex;

use super::types::{AgentIdentity, CollabMessage, Task, TaskStatus};

/// Thread-safe handle to the SQLite collaboration tables.
pub struct TeamRegistry {
    conn: Mutex<Connection>,
}

impl TeamRegistry {
    /// Create a registry backed by the given open connection.
    ///
    /// The caller is responsible for running [`crate::db::run_migrations`]
    /// before constructing a `TeamRegistry`.
    pub fn new(conn: Connection) -> Self {
        TeamRegistry {
            conn: Mutex::new(conn),
        }
    }

    // ── Agent identity helpers ────────────────────────────────────────────────

    /// Persist (upsert) an agent identity.
    ///
    /// Used both for the local bot on startup and for remote teammates when
    /// their presence announcements are received.
    pub fn upsert_agent(&self, agent: &AgentIdentity) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let last_seen = agent.last_seen.to_rfc3339();
        conn.execute(
            "INSERT INTO agents (id, name, role, endpoint, team_id, is_local, last_seen)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(id) DO UPDATE SET
               name      = excluded.name,
               role      = excluded.role,
               endpoint  = excluded.endpoint,
               team_id   = excluded.team_id,
               is_local  = excluded.is_local,
               last_seen = excluded.last_seen",
            params![
                agent.id,
                agent.name,
                agent.role,
                agent.endpoint,
                agent.team_id,
                agent.is_local as i32,
                last_seen,
            ],
        )?;
        Ok(())
    }

    /// Return all agents in the given team, ordered by name.
    pub fn list_agents(&self, team_id: &str) -> Result<Vec<AgentIdentity>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, role, endpoint, team_id, is_local, last_seen
             FROM agents WHERE team_id = ?1 ORDER BY name",
        )?;
        let rows = stmt.query_map(params![team_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, i32>(5)?,
                row.get::<_, String>(6)?,
            ))
        })?;
        let mut agents = Vec::new();
        for row in rows {
            let (id, name, role, endpoint, team_id, is_local, last_seen_str) = row?;
            let last_seen = chrono::DateTime::parse_from_rfc3339(&last_seen_str)
                .map(|dt| dt.with_timezone(&Utc))
                .unwrap_or_else(|_| Utc::now());
            agents.push(AgentIdentity {
                id,
                name,
                role,
                endpoint,
                team_id,
                is_local: is_local != 0,
                last_seen,
            });
        }
        Ok(agents)
    }

    // ── Task helpers ──────────────────────────────────────────────────────────

    /// Insert a new task row and return the inserted task.
    pub fn create_task(
        &self,
        title: &str,
        description: Option<&str>,
        assigned_to: Option<&str>,
        delegated_by: Option<&str>,
    ) -> Result<Task> {
        let id = uuid::Uuid::new_v4().to_string();
        let now = Utc::now();
        let now_str = now.to_rfc3339();
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO tasks (id, title, description, status, assigned_to, delegated_by, created_at, updated_at)
             VALUES (?1, ?2, ?3, 'pending', ?4, ?5, ?6, ?7)",
            params![id, title, description, assigned_to, delegated_by, now_str, now_str],
        )?;
        Ok(Task {
            id,
            title: title.to_string(),
            description: description.map(str::to_string),
            status: TaskStatus::Pending,
            assigned_to: assigned_to.map(str::to_string),
            delegated_by: delegated_by.map(str::to_string),
            created_at: now,
            updated_at: now,
            result: None,
        })
    }

    /// Update the status (and optionally the result JSON) of an existing task.
    pub fn update_task_status(
        &self,
        task_id: &str,
        status: TaskStatus,
        result: Option<&serde_json::Value>,
    ) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        let result_str = result.map(|v| v.to_string());
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE tasks SET status = ?1, result = ?2, updated_at = ?3 WHERE id = ?4",
            params![status.as_str(), result_str, now, task_id],
        )?;
        Ok(())
    }

    /// Fetch tasks, ordered newest-first, with optional pagination.
    pub fn list_tasks(
        &self,
        limit: Option<usize>,
        offset: Option<usize>,
    ) -> Result<Vec<serde_json::Value>> {
        let limit = limit.unwrap_or(50) as i64;
        let offset = offset.unwrap_or(0) as i64;
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, title, description, status, assigned_to, delegated_by,
                    created_at, updated_at, result
             FROM tasks
             ORDER BY created_at DESC
             LIMIT ?1 OFFSET ?2",
        )?;
        let rows = stmt.query_map(params![limit, offset], |row| {
            Ok(json!({
                "id":           row.get::<_, String>(0)?,
                "title":        row.get::<_, String>(1)?,
                "description":  row.get::<_, Option<String>>(2)?,
                "status":       row.get::<_, String>(3)?,
                "assigned_to":  row.get::<_, Option<String>>(4)?,
                "delegated_by": row.get::<_, Option<String>>(5)?,
                "created_at":   row.get::<_, String>(6)?,
                "updated_at":   row.get::<_, String>(7)?,
                "result":       row.get::<_, Option<String>>(8)?,
            }))
        })?;
        let tasks: Result<Vec<_>, _> = rows.collect();
        Ok(tasks?)
    }

    // ── Collab message helpers ────────────────────────────────────────────────

    /// Persist an inter-agent message (immutable; never updated after insert).
    pub fn save_message(&self, msg: &CollabMessage) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let payload_str = serde_json::to_string(&msg.payload)?;
        conn.execute(
            "INSERT INTO collab_messages (id, from_agent, to_agent, task_id, msg_type, payload, timestamp)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                msg.id,
                msg.from_agent,
                msg.to_agent,
                msg.task_id,
                msg.msg_type.as_str(),
                payload_str,
                msg.timestamp.to_rfc3339(),
            ],
        )?;
        Ok(())
    }

    /// Retrieve recent inter-agent messages, newest-first.
    pub fn list_messages(
        &self,
        limit: Option<usize>,
        offset: Option<usize>,
    ) -> Result<Vec<serde_json::Value>> {
        let limit = limit.unwrap_or(50) as i64;
        let offset = offset.unwrap_or(0) as i64;
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, from_agent, to_agent, task_id, msg_type, payload, timestamp
             FROM collab_messages
             ORDER BY timestamp DESC
             LIMIT ?1 OFFSET ?2",
        )?;
        let rows = stmt.query_map(params![limit, offset], |row| {
            let payload_str: String = row.get(5)?;
            let payload: serde_json::Value =
                serde_json::from_str(&payload_str).unwrap_or(serde_json::Value::Null);
            Ok(json!({
                "id":         row.get::<_, String>(0)?,
                "from_agent": row.get::<_, String>(1)?,
                "to_agent":   row.get::<_, String>(2)?,
                "task_id":    row.get::<_, Option<String>>(3)?,
                "msg_type":   row.get::<_, String>(4)?,
                "payload":    payload,
                "timestamp":  row.get::<_, String>(6)?,
            }))
        })?;
        let msgs: Result<Vec<_>, _> = rows.collect();
        Ok(msgs?)
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::collab::types::MsgType;
    use rusqlite::Connection;

    fn in_memory_registry() -> TeamRegistry {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::run_migrations(&conn).unwrap();
        TeamRegistry::new(conn)
    }

    fn make_agent(id: &str, name: &str, is_local: bool) -> AgentIdentity {
        AgentIdentity {
            id: id.to_string(),
            name: name.to_string(),
            role: Some("dev".into()),
            endpoint: None,
            team_id: "team-1".to_string(),
            is_local,
            last_seen: Utc::now(),
        }
    }

    // ── Agent tests ───────────────────────────────────────────────────────────

    #[test]
    fn test_upsert_and_list_agents() {
        let reg = in_memory_registry();
        let alice = make_agent("a1", "Alice-bot", true);
        let bob = make_agent("b1", "Bob-bot", false);

        reg.upsert_agent(&alice).unwrap();
        reg.upsert_agent(&bob).unwrap();

        let agents = reg.list_agents("team-1").unwrap();
        assert_eq!(agents.len(), 2);
        // Ordered by name
        assert_eq!(agents[0].name, "Alice-bot");
        assert_eq!(agents[1].name, "Bob-bot");
    }

    #[test]
    fn test_upsert_agent_updates_existing() {
        let reg = in_memory_registry();
        let mut alice = make_agent("a1", "Alice-bot", true);
        reg.upsert_agent(&alice).unwrap();

        alice.role = Some("pm".into());
        reg.upsert_agent(&alice).unwrap();

        let agents = reg.list_agents("team-1").unwrap();
        assert_eq!(agents.len(), 1);
        assert_eq!(agents[0].role, Some("pm".into()));
    }

    #[test]
    fn test_list_agents_filters_by_team() {
        let reg = in_memory_registry();
        let mut charlie = make_agent("c1", "Charlie-bot", false);
        charlie.team_id = "team-2".to_string();

        reg.upsert_agent(&make_agent("a1", "Alice-bot", true))
            .unwrap();
        reg.upsert_agent(&charlie).unwrap();

        let t1 = reg.list_agents("team-1").unwrap();
        let t2 = reg.list_agents("team-2").unwrap();
        assert_eq!(t1.len(), 1);
        assert_eq!(t2.len(), 1);
        assert_eq!(t2[0].name, "Charlie-bot");
    }

    // ── Task tests ────────────────────────────────────────────────────────────

    #[test]
    fn test_create_and_list_tasks() {
        let reg = in_memory_registry();
        // Need agents for FK constraints
        reg.upsert_agent(&make_agent("a1", "Alice-bot", true))
            .unwrap();
        reg.upsert_agent(&make_agent("b1", "Bob-bot", false))
            .unwrap();

        reg.create_task("Write tests", Some("Add unit tests"), Some("b1"), Some("a1"))
            .unwrap();

        let tasks = reg.list_tasks(None, None).unwrap();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0]["title"], "Write tests");
        assert_eq!(tasks[0]["status"], "pending");
        assert_eq!(tasks[0]["assigned_to"], "b1");
    }

    #[test]
    fn test_update_task_status() {
        let reg = in_memory_registry();
        reg.upsert_agent(&make_agent("a1", "Alice-bot", true))
            .unwrap();
        reg.upsert_agent(&make_agent("b1", "Bob-bot", false))
            .unwrap();

        let task = reg
            .create_task("Deploy service", None, Some("b1"), Some("a1"))
            .unwrap();
        let result_json = json!({"url": "https://example.com"});
        reg.update_task_status(&task.id, TaskStatus::Done, Some(&result_json))
            .unwrap();

        let tasks = reg.list_tasks(None, None).unwrap();
        assert_eq!(tasks[0]["status"], "done");
        // result is stored as a JSON string in SQLite; non-null
        assert!(tasks[0]["result"].is_string());
    }

    #[test]
    fn test_task_pagination() {
        let reg = in_memory_registry();
        reg.upsert_agent(&make_agent("a1", "Alice-bot", true))
            .unwrap();
        for i in 0..6 {
            reg.create_task(&format!("Task {i}"), None, None, Some("a1"))
                .unwrap();
        }
        let page1 = reg.list_tasks(Some(3), Some(0)).unwrap();
        let page2 = reg.list_tasks(Some(3), Some(3)).unwrap();
        assert_eq!(page1.len(), 3);
        assert_eq!(page2.len(), 3);
    }

    // ── Collab message tests ──────────────────────────────────────────────────

    #[test]
    fn test_save_and_list_messages() {
        let reg = in_memory_registry();
        reg.upsert_agent(&make_agent("a1", "Alice-bot", true))
            .unwrap();
        reg.upsert_agent(&make_agent("b1", "Bob-bot", false))
            .unwrap();

        let task = reg
            .create_task("Code review", None, Some("b1"), Some("a1"))
            .unwrap();

        let msg = CollabMessage {
            id: uuid::Uuid::new_v4().to_string(),
            from_agent: "a1".into(),
            to_agent: "b1".into(),
            task_id: Some(task.id.clone()),
            msg_type: MsgType::TaskAssigned,
            payload: json!({"priority": "high"}),
            timestamp: Utc::now(),
        };
        reg.save_message(&msg).unwrap();

        let msgs = reg.list_messages(None, None).unwrap();
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0]["from_agent"], "a1");
        assert_eq!(msgs[0]["msg_type"], "task_assigned");
        assert_eq!(msgs[0]["payload"]["priority"], "high");
    }

    #[test]
    fn test_ping_message_no_task() {
        let reg = in_memory_registry();
        reg.upsert_agent(&make_agent("a1", "Alice-bot", true))
            .unwrap();
        reg.upsert_agent(&make_agent("b1", "Bob-bot", false))
            .unwrap();

        let msg = CollabMessage {
            id: uuid::Uuid::new_v4().to_string(),
            from_agent: "a1".into(),
            to_agent: "b1".into(),
            task_id: None,
            msg_type: MsgType::Ping,
            payload: json!({}),
            timestamp: Utc::now(),
        };
        reg.save_message(&msg).unwrap();

        let msgs = reg.list_messages(None, None).unwrap();
        assert_eq!(msgs[0]["msg_type"], "ping");
        assert!(msgs[0]["task_id"].is_null());
    }

    // ── Additional edge-case tests ────────────────────────────────────────────

    #[test]
    fn test_list_agents_empty_team_returns_empty() {
        let reg = in_memory_registry();
        let agents = reg.list_agents("nonexistent-team").unwrap();
        assert!(agents.is_empty());
    }

    #[test]
    fn test_create_task_defaults_to_pending() {
        let reg = in_memory_registry();
        reg.upsert_agent(&make_agent("a1", "Alice-bot", true))
            .unwrap();
        let task = reg
            .create_task("Check logs", None, None, Some("a1"))
            .unwrap();
        assert_eq!(task.status, TaskStatus::Pending);
        assert!(task.result.is_none());
    }

    #[test]
    fn test_update_task_status_in_progress() {
        let reg = in_memory_registry();
        reg.upsert_agent(&make_agent("a1", "Alice-bot", true))
            .unwrap();
        let task = reg.create_task("Build", None, None, Some("a1")).unwrap();
        reg.update_task_status(&task.id, TaskStatus::InProgress, None)
            .unwrap();
        let tasks = reg.list_tasks(None, None).unwrap();
        assert_eq!(tasks[0]["status"], "in_progress");
    }

    #[test]
    fn test_update_task_status_cancelled() {
        let reg = in_memory_registry();
        reg.upsert_agent(&make_agent("a1", "Alice-bot", true))
            .unwrap();
        let task = reg.create_task("Cancelled work", None, None, Some("a1")).unwrap();
        reg.update_task_status(&task.id, TaskStatus::Cancelled, None)
            .unwrap();
        let tasks = reg.list_tasks(None, None).unwrap();
        assert_eq!(tasks[0]["status"], "cancelled");
    }

    #[test]
    fn test_update_task_status_failed_with_error_result() {
        let reg = in_memory_registry();
        reg.upsert_agent(&make_agent("a1", "Alice-bot", true))
            .unwrap();
        let task = reg.create_task("Risky task", None, None, Some("a1")).unwrap();
        let error_json = json!({"error": "timeout"});
        reg.update_task_status(&task.id, TaskStatus::Failed, Some(&error_json))
            .unwrap();
        let tasks = reg.list_tasks(None, None).unwrap();
        assert_eq!(tasks[0]["status"], "failed");
        assert!(tasks[0]["result"].is_string());
    }

    #[test]
    fn test_list_tasks_empty_on_fresh_registry() {
        let reg = in_memory_registry();
        let tasks = reg.list_tasks(None, None).unwrap();
        assert!(tasks.is_empty());
    }

    #[test]
    fn test_list_messages_empty_on_fresh_registry() {
        let reg = in_memory_registry();
        let msgs = reg.list_messages(None, None).unwrap();
        assert!(msgs.is_empty());
    }

    #[test]
    fn test_message_pagination() {
        let reg = in_memory_registry();
        reg.upsert_agent(&make_agent("a1", "Alice-bot", true))
            .unwrap();
        reg.upsert_agent(&make_agent("b1", "Bob-bot", false))
            .unwrap();
        // Insert 8 ping messages
        for _ in 0..8 {
            let msg = CollabMessage {
                id: uuid::Uuid::new_v4().to_string(),
                from_agent: "a1".into(),
                to_agent: "b1".into(),
                task_id: None,
                msg_type: MsgType::Ping,
                payload: json!({}),
                timestamp: Utc::now(),
            };
            reg.save_message(&msg).unwrap();
        }
        let page1 = reg.list_messages(Some(4), Some(0)).unwrap();
        let page2 = reg.list_messages(Some(4), Some(4)).unwrap();
        assert_eq!(page1.len(), 4);
        assert_eq!(page2.len(), 4);
        // No id overlap
        let ids1: Vec<String> = page1.iter().map(|m| m["id"].as_str().unwrap().to_string()).collect();
        let ids2: Vec<String> = page2.iter().map(|m| m["id"].as_str().unwrap().to_string()).collect();
        assert!(ids1.iter().all(|id| !ids2.contains(id)));
    }

    #[test]
    fn test_save_task_result_and_task_update_messages() {
        let reg = in_memory_registry();
        reg.upsert_agent(&make_agent("a1", "Alice-bot", true))
            .unwrap();
        reg.upsert_agent(&make_agent("b1", "Bob-bot", false))
            .unwrap();
        let task = reg
            .create_task("Analysis", None, Some("b1"), Some("a1"))
            .unwrap();

        let update_msg = CollabMessage {
            id: uuid::Uuid::new_v4().to_string(),
            from_agent: "b1".into(),
            to_agent: "a1".into(),
            task_id: Some(task.id.clone()),
            msg_type: MsgType::TaskUpdate,
            payload: json!({"status": "in_progress"}),
            timestamp: Utc::now(),
        };
        reg.save_message(&update_msg).unwrap();

        let result_msg = CollabMessage {
            id: uuid::Uuid::new_v4().to_string(),
            from_agent: "b1".into(),
            to_agent: "a1".into(),
            task_id: Some(task.id.clone()),
            msg_type: MsgType::TaskResult,
            payload: json!({"summary": "done"}),
            timestamp: Utc::now(),
        };
        reg.save_message(&result_msg).unwrap();

        let msgs = reg.list_messages(None, None).unwrap();
        assert_eq!(msgs.len(), 2);
        let types: Vec<&str> = msgs.iter().map(|m| m["msg_type"].as_str().unwrap()).collect();
        assert!(types.contains(&"task_update"));
        assert!(types.contains(&"task_result"));
    }
}
