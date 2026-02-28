//! Audit logging to SQLite.
//!
//! All audit events are written to the `audit_logs` table with columns:
//!   id          INTEGER PRIMARY KEY AUTOINCREMENT
//!   timestamp   DATETIME NOT NULL
//!   event_type  TEXT     NOT NULL   ('model_usage' | 'tool_call' | 'permission_check')
//!   details     TEXT     NOT NULL   (JSON-serialized payload)
//!
//! Three high-level helpers cover the three audit categories:
//!   - `log_model_usage`      – LLM prompt/completion token counts and latency
//!   - `log_tool_execution`   – tool name, arguments, success/failure, duration
//!   - `log_permission_event` – guardrail blocks or approval decisions

use anyhow::Result;
use rusqlite::{params, Connection};
use serde_json::json;
use std::sync::Mutex;
use tauri::AppHandle;

/// Thread-safe handle to the audit database connection.
pub struct AuditDb {
    conn: Mutex<Connection>,
}

/// Initialize the audit database, returning a managed [`AuditDb`] handle.
///
/// Uses [`crate::db::open`] so the file is placed in the app's local data
/// directory and all schema migrations are applied before first use.
pub fn init_db(app: &AppHandle) -> Result<AuditDb> {
    let conn = crate::db::open(app)?;
    Ok(AuditDb {
        conn: Mutex::new(conn),
    })
}

// ── Internal helper ───────────────────────────────────────────────────────────

impl AuditDb {
    /// Insert a row into `audit_logs`.
    fn insert(&self, event_type: &str, details: serde_json::Value) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        let details_str = serde_json::to_string(&details)?;
        conn.execute(
            "INSERT INTO audit_logs (timestamp, event_type, details) VALUES (?1, ?2, ?3)",
            params![now, event_type, details_str],
        )?;
        Ok(())
    }

    // ── Public logging functions ──────────────────────────────────────────────

    /// Log LLM model usage: prompt tokens, completion tokens, and wall-clock duration.
    ///
    /// # Arguments
    /// * `model`             – model identifier (e.g. `"gpt-4o"`)
    /// * `prompt_tokens`     – number of tokens in the prompt
    /// * `completion_tokens` – number of tokens in the completion
    /// * `duration_ms`       – wall-clock latency in milliseconds
    pub fn log_model_usage(
        &self,
        model: &str,
        prompt_tokens: u32,
        completion_tokens: u32,
        duration_ms: u64,
    ) -> Result<()> {
        self.insert(
            "model_usage",
            json!({
                "model": model,
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "duration_ms": duration_ms,
            }),
        )
    }

    /// Log a tool API execution event.
    ///
    /// # Arguments
    /// * `tool`        – tool name (e.g. `"fs.readFile"`)
    /// * `arguments`   – JSON-serialized tool arguments
    /// * `success`     – whether the call succeeded
    /// * `duration_ms` – execution time in milliseconds
    /// * `error`       – optional error message when `success` is `false`
    pub fn log_tool_execution(
        &self,
        tool: &str,
        arguments: &serde_json::Value,
        success: bool,
        duration_ms: u64,
        error: Option<&str>,
    ) -> Result<()> {
        self.insert(
            "tool_call",
            json!({
                "tool": tool,
                "arguments": arguments,
                "success": success,
                "duration_ms": duration_ms,
                "error": error,
            }),
        )
    }

    /// Log a permission or guardrail event.
    ///
    /// # Arguments
    /// * `action`   – the action that was evaluated (e.g. `"tool_call"`)
    /// * `resource` – the specific resource or tool involved
    /// * `decision` – `"approved"`, `"denied"`, or `"blocked_by_guardrail"`
    /// * `reason`   – optional human-readable explanation
    pub fn log_permission_event(
        &self,
        action: &str,
        resource: &str,
        decision: &str,
        reason: Option<&str>,
    ) -> Result<()> {
        self.insert(
            "permission_check",
            json!({
                "action": action,
                "resource": resource,
                "decision": decision,
                "reason": reason,
            }),
        )
    }

    // ── Query helpers ─────────────────────────────────────────────────────────

    /// Retrieve recent audit log entries, newest-first.
    ///
    /// # Arguments
    /// * `limit`  – maximum number of rows to return (defaults to 50)
    /// * `offset` – number of rows to skip for pagination (defaults to 0)
    pub fn get_audit_logs(
        &self,
        limit: Option<usize>,
        offset: Option<usize>,
    ) -> Result<Vec<serde_json::Value>> {
        let limit = limit.unwrap_or(50) as i64;
        let offset = offset.unwrap_or(0) as i64;
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, timestamp, event_type, details
             FROM audit_logs
             ORDER BY id DESC
             LIMIT ?1 OFFSET ?2",
        )?;
        let rows = stmt.query_map(params![limit, offset], |row| {
            let details_str: String = row.get(3)?;
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                details_str,
            ))
        })?;
        let mut entries = Vec::new();
        for row in rows {
            let (id, timestamp, event_type, details_str) = row?;
            let details: serde_json::Value =
                serde_json::from_str(&details_str).unwrap_or(serde_json::Value::Null);
            entries.push(json!({
                "id": id,
                "timestamp": timestamp,
                "event_type": event_type,
                "details": details,
            }));
        }
        Ok(entries)
    }

    // ── Session helpers (used by agent) ───────────────────────────────────────

    /// Record the start of a new agent session.
    pub fn log_session_start(&self, session_id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT OR IGNORE INTO sessions (id, started_at) VALUES (?1, ?2)",
            params![session_id, now],
        )?;
        Ok(())
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    /// Create an in-memory AuditDb for testing.
    fn in_memory_db() -> AuditDb {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::run_migrations(&conn).unwrap();
        AuditDb {
            conn: Mutex::new(conn),
        }
    }

    #[test]
    fn test_log_model_usage_inserted() {
        let db = in_memory_db();
        db.log_model_usage("gpt-4o", 100, 50, 1200).unwrap();

        let logs = db.get_audit_logs(None, None).unwrap();
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0]["event_type"], "model_usage");
        assert_eq!(logs[0]["details"]["model"], "gpt-4o");
        assert_eq!(logs[0]["details"]["prompt_tokens"], 100);
        assert_eq!(logs[0]["details"]["completion_tokens"], 50);
        assert_eq!(logs[0]["details"]["duration_ms"], 1200);
    }

    #[test]
    fn test_log_tool_execution_success() {
        let db = in_memory_db();
        let args = serde_json::json!({"path": "/tmp/file.txt"});
        db.log_tool_execution("fs.readFile", &args, true, 42, None)
            .unwrap();

        let logs = db.get_audit_logs(None, None).unwrap();
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0]["event_type"], "tool_call");
        assert_eq!(logs[0]["details"]["tool"], "fs.readFile");
        assert_eq!(logs[0]["details"]["success"], true);
        assert_eq!(logs[0]["details"]["duration_ms"], 42);
        assert!(logs[0]["details"]["error"].is_null());
    }

    #[test]
    fn test_log_tool_execution_failure() {
        let db = in_memory_db();
        let args = serde_json::json!({});
        db.log_tool_execution("cmd.run", &args, false, 5, Some("denied by user"))
            .unwrap();

        let logs = db.get_audit_logs(None, None).unwrap();
        assert_eq!(logs[0]["details"]["success"], false);
        assert_eq!(logs[0]["details"]["error"], "denied by user");
    }

    #[test]
    fn test_log_permission_event() {
        let db = in_memory_db();
        db.log_permission_event(
            "tool_call",
            "fs.readFile",
            "approved",
            Some("call-id-123"),
        )
        .unwrap();

        let logs = db.get_audit_logs(None, None).unwrap();
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0]["event_type"], "permission_check");
        assert_eq!(logs[0]["details"]["action"], "tool_call");
        assert_eq!(logs[0]["details"]["resource"], "fs.readFile");
        assert_eq!(logs[0]["details"]["decision"], "approved");
    }

    #[test]
    fn test_get_audit_logs_pagination() {
        let db = in_memory_db();
        for i in 0..10u32 {
            db.log_model_usage("model", i, i, u64::from(i)).unwrap();
        }

        let page1 = db.get_audit_logs(Some(5), Some(0)).unwrap();
        let page2 = db.get_audit_logs(Some(5), Some(5)).unwrap();
        assert_eq!(page1.len(), 5);
        assert_eq!(page2.len(), 5);
        // Ensure no overlap – rows are ordered newest-first by id, so page1 ids > page2 ids
        let ids1: Vec<i64> = page1.iter().map(|r| r["id"].as_i64().unwrap()).collect();
        let ids2: Vec<i64> = page2.iter().map(|r| r["id"].as_i64().unwrap()).collect();
        assert!(ids1.iter().all(|id| !ids2.contains(id)));
    }

    #[test]
    fn test_get_audit_logs_returns_newest_first() {
        let db = in_memory_db();
        db.log_model_usage("first", 1, 1, 1).unwrap();
        db.log_model_usage("second", 2, 2, 2).unwrap();

        let logs = db.get_audit_logs(None, None).unwrap();
        // Newest (highest id) should be first
        let id0 = logs[0]["id"].as_i64().unwrap();
        let id1 = logs[1]["id"].as_i64().unwrap();
        assert!(id0 > id1);
    }
}
