//! Audit logging to SQLite.
//!
//! Schema:
//!   sessions(id, started_at, ended_at, metadata)
//!   messages(id, session_id, role, content, timestamp)
//!   tool_calls(id, session_id, tool, params, result, approved, timestamp, duration_ms)
//!   artifacts(id, session_id, tool_call_id, kind, data, timestamp)

use anyhow::Result;
use rusqlite::{params, Connection};
use std::sync::Mutex;
use tauri::AppHandle;

pub struct AuditDb {
    conn: Mutex<Connection>,
}

pub fn init_db(_app: &AppHandle) -> Result<AuditDb> {
    // Use in-memory DB for now; production would use app data dir
    let conn = Connection::open_in_memory()?;
    run_migrations(&conn)?;
    Ok(AuditDb {
        conn: Mutex::new(conn),
    })
}

fn run_migrations(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        PRAGMA journal_mode=WAL;
        PRAGMA foreign_keys=ON;

        CREATE TABLE IF NOT EXISTS sessions (
            id          TEXT PRIMARY KEY,
            started_at  TEXT NOT NULL,
            ended_at    TEXT,
            metadata    TEXT
        );

        CREATE TABLE IF NOT EXISTS messages (
            id          TEXT PRIMARY KEY,
            session_id  TEXT NOT NULL REFERENCES sessions(id),
            role        TEXT NOT NULL,
            content     TEXT NOT NULL,
            timestamp   TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS tool_calls (
            id          TEXT PRIMARY KEY,
            session_id  TEXT NOT NULL REFERENCES sessions(id),
            tool        TEXT NOT NULL,
            params      TEXT NOT NULL,
            result      TEXT,
            approved    INTEGER NOT NULL DEFAULT 0,
            timestamp   TEXT NOT NULL,
            duration_ms INTEGER
        );

        CREATE TABLE IF NOT EXISTS artifacts (
            id           TEXT PRIMARY KEY,
            session_id   TEXT NOT NULL REFERENCES sessions(id),
            tool_call_id TEXT REFERENCES tool_calls(id),
            kind         TEXT NOT NULL,
            data         TEXT NOT NULL,
            timestamp    TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS llm_calls (
            id                TEXT PRIMARY KEY,
            session_id        TEXT NOT NULL REFERENCES sessions(id),
            phase             TEXT NOT NULL,
            model             TEXT NOT NULL,
            prompt_tokens     INTEGER,
            completion_tokens INTEGER,
            duration_ms       INTEGER,
            timestamp         TEXT NOT NULL
        );
        ",
    )?;
    Ok(())
}

impl AuditDb {
    pub fn log_session_start(&self, session_id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT OR IGNORE INTO sessions (id, started_at) VALUES (?1, ?2)",
            params![session_id, now],
        )?;
        Ok(())
    }

    pub fn log_message(
        &self,
        id: &str,
        session_id: &str,
        role: &str,
        content: &str,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO messages (id, session_id, role, content, timestamp) VALUES (?1,?2,?3,?4,?5)",
            params![id, session_id, role, content, now],
        )?;
        Ok(())
    }

    pub fn log_tool_call(
        &self,
        id: &str,
        session_id: &str,
        tool: &str,
        params_json: &str,
        approved: bool,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO tool_calls (id, session_id, tool, params, approved, timestamp) VALUES (?1,?2,?3,?4,?5,?6)",
            params![id, session_id, tool, params_json, approved as i32, now],
        )?;
        Ok(())
    }

    pub fn update_tool_call_result(
        &self,
        id: &str,
        result_json: &str,
        duration_ms: u64,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE tool_calls SET result=?1, duration_ms=?2 WHERE id=?3",
            params![result_json, duration_ms as i64, id],
        )?;
        Ok(())
    }

    pub fn log_llm_call(
        &self,
        id: &str,
        session_id: &str,
        phase: &str,
        model: &str,
        prompt_tokens: u32,
        completion_tokens: u32,
        duration_ms: u64,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO llm_calls (id, session_id, phase, model, prompt_tokens, completion_tokens, duration_ms, timestamp) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            params![
                id,
                session_id,
                phase,
                model,
                prompt_tokens as i64,
                completion_tokens as i64,
                duration_ms as i64,
                now
            ],
        )?;
        Ok(())
    }

    /// Retrieve recent audit entries as JSON (for UI).
    pub fn recent_entries(&self, limit: usize) -> Result<Vec<serde_json::Value>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, session_id, tool, params, result, approved, timestamp, duration_ms
             FROM tool_calls ORDER BY timestamp DESC LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit as i64], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "session_id": row.get::<_, String>(1)?,
                "tool": row.get::<_, String>(2)?,
                "params": row.get::<_, String>(3)?,
                "result": row.get::<_, Option<String>>(4)?,
                "approved": row.get::<_, i32>(5)? != 0,
                "timestamp": row.get::<_, String>(6)?,
                "duration_ms": row.get::<_, Option<i64>>(7)?
            }))
        })?;
        let entries: Result<Vec<_>, _> = rows.collect();
        Ok(entries?)
    }
}
