//! Audit logging to SQLite.
//!
//! Schema:
//!   sessions(id, started_at, ended_at, metadata)
//!   messages(id, session_id, role, content, timestamp)
//!   tool_calls(id, session_id, tool, params, result, approved, timestamp, duration_ms, run_node_id)
//!   artifacts(id, session_id, tool_call_id, kind, data, timestamp, run_node_id)
//!   run_nodes(id, session_id, kind, tool, status, confidence, inputs_json, outputs_json, timestamp)
//!   run_edges(id, session_id, src_node_id, dst_node_id, edge_kind, blocked, timestamp)
//!   claims(id, session_id, run_node_id, verifier, result, score, detail, timestamp)
//!   interventions(id, session_id, kind, payload_json, timestamp)
//!   verifier_rules(id, session_id, scope, name, rule_json, timestamp)

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

        CREATE TABLE IF NOT EXISTS run_nodes (
            id           TEXT PRIMARY KEY,
            session_id   TEXT NOT NULL REFERENCES sessions(id),
            kind         TEXT NOT NULL,
            tool         TEXT,
            status       TEXT NOT NULL DEFAULT 'pending',
            confidence   REAL,
            inputs_json  TEXT,
            outputs_json TEXT,
            timestamp    TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS run_edges (
            id          TEXT PRIMARY KEY,
            session_id  TEXT NOT NULL REFERENCES sessions(id),
            src_node_id TEXT NOT NULL REFERENCES run_nodes(id),
            dst_node_id TEXT NOT NULL REFERENCES run_nodes(id),
            edge_kind   TEXT NOT NULL DEFAULT 'control',
            blocked     INTEGER NOT NULL DEFAULT 0,
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
            duration_ms INTEGER,
            run_node_id TEXT REFERENCES run_nodes(id)
        );

        CREATE TABLE IF NOT EXISTS artifacts (
            id           TEXT PRIMARY KEY,
            session_id   TEXT NOT NULL REFERENCES sessions(id),
            tool_call_id TEXT REFERENCES tool_calls(id),
            kind         TEXT NOT NULL,
            data         TEXT NOT NULL,
            timestamp    TEXT NOT NULL,
            run_node_id  TEXT REFERENCES run_nodes(id)
        );

        CREATE TABLE IF NOT EXISTS claims (
            id          TEXT PRIMARY KEY,
            session_id  TEXT NOT NULL REFERENCES sessions(id),
            run_node_id TEXT NOT NULL REFERENCES run_nodes(id),
            verifier    TEXT NOT NULL,
            result      TEXT NOT NULL,
            score       REAL,
            detail      TEXT,
            timestamp   TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS interventions (
            id           TEXT PRIMARY KEY,
            session_id   TEXT NOT NULL REFERENCES sessions(id),
            kind         TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            timestamp    TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS verifier_rules (
            id           TEXT PRIMARY KEY,
            session_id   TEXT,
            scope        TEXT NOT NULL DEFAULT 'task',
            name         TEXT NOT NULL,
            rule_json    TEXT NOT NULL,
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

    // ── RunGraph persistence ──────────────────────────────────────────────────

    pub fn insert_run_node(
        &self,
        id: &str,
        session_id: &str,
        kind: &str,
        tool: Option<&str>,
        inputs_json: Option<&str>,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO run_nodes (id, session_id, kind, tool, inputs_json, timestamp)
             VALUES (?1,?2,?3,?4,?5,?6)",
            params![id, session_id, kind, tool, inputs_json, now],
        )?;
        Ok(())
    }

    pub fn update_run_node(
        &self,
        id: &str,
        status: &str,
        outputs_json: Option<&str>,
        confidence: Option<f64>,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE run_nodes SET status=?1, outputs_json=?2, confidence=?3 WHERE id=?4",
            params![status, outputs_json, confidence, id],
        )?;
        Ok(())
    }

    pub fn insert_run_edge(
        &self,
        id: &str,
        session_id: &str,
        src_node_id: &str,
        dst_node_id: &str,
        edge_kind: &str,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO run_edges (id, session_id, src_node_id, dst_node_id, edge_kind, timestamp)
             VALUES (?1,?2,?3,?4,?5,?6)",
            params![id, session_id, src_node_id, dst_node_id, edge_kind, now],
        )?;
        Ok(())
    }

    pub fn block_edge(&self, edge_id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("UPDATE run_edges SET blocked=1 WHERE id=?1", params![edge_id])?;
        Ok(())
    }

    pub fn insert_claim(
        &self,
        id: &str,
        session_id: &str,
        run_node_id: &str,
        verifier: &str,
        result: &str,
        score: Option<f64>,
        detail: Option<&str>,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO claims (id, session_id, run_node_id, verifier, result, score, detail, timestamp)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            params![id, session_id, run_node_id, verifier, result, score, detail, now],
        )?;
        Ok(())
    }

    pub fn insert_intervention(
        &self,
        id: &str,
        session_id: &str,
        kind: &str,
        payload_json: &str,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO interventions (id, session_id, kind, payload_json, timestamp)
             VALUES (?1,?2,?3,?4,?5)",
            params![id, session_id, kind, payload_json, now],
        )?;
        Ok(())
    }

    pub fn upsert_verifier_rule(
        &self,
        id: &str,
        session_id: Option<&str>,
        scope: &str,
        name: &str,
        rule_json: &str,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT OR REPLACE INTO verifier_rules (id, session_id, scope, name, rule_json, timestamp)
             VALUES (?1,?2,?3,?4,?5,?6)",
            params![id, session_id, scope, name, rule_json, now],
        )?;
        Ok(())
    }

    pub fn list_verifier_rules(&self) -> Result<Vec<serde_json::Value>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, session_id, scope, name, rule_json, timestamp
             FROM verifier_rules ORDER BY timestamp DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "session_id": row.get::<_, Option<String>>(1)?,
                "scope": row.get::<_, String>(2)?,
                "name": row.get::<_, String>(3)?,
                "rule_json": row.get::<_, String>(4)?,
                "timestamp": row.get::<_, String>(5)?
            }))
        })?;
        let rules: Result<Vec<_>, _> = rows.collect();
        Ok(rules?)
    }

    pub fn get_run_graph(&self, session_id: &str) -> Result<serde_json::Value> {
        let conn = self.conn.lock().unwrap();
        let mut node_stmt = conn.prepare(
            "SELECT id, kind, tool, status, confidence, inputs_json, outputs_json, timestamp
             FROM run_nodes WHERE session_id=?1 ORDER BY timestamp ASC",
        )?;
        let nodes: Vec<serde_json::Value> = node_stmt
            .query_map(params![session_id], |row| {
                Ok(serde_json::json!({
                    "id": row.get::<_, String>(0)?,
                    "kind": row.get::<_, String>(1)?,
                    "tool": row.get::<_, Option<String>>(2)?,
                    "status": row.get::<_, String>(3)?,
                    "confidence": row.get::<_, Option<f64>>(4)?,
                    "inputs_json": row.get::<_, Option<String>>(5)?,
                    "outputs_json": row.get::<_, Option<String>>(6)?,
                    "timestamp": row.get::<_, String>(7)?
                }))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;

        let mut edge_stmt = conn.prepare(
            "SELECT id, src_node_id, dst_node_id, edge_kind, blocked, timestamp
             FROM run_edges WHERE session_id=?1 ORDER BY timestamp ASC",
        )?;
        let edges: Vec<serde_json::Value> = edge_stmt
            .query_map(params![session_id], |row| {
                Ok(serde_json::json!({
                    "id": row.get::<_, String>(0)?,
                    "src": row.get::<_, String>(1)?,
                    "dst": row.get::<_, String>(2)?,
                    "kind": row.get::<_, String>(3)?,
                    "blocked": row.get::<_, i32>(4)? != 0,
                    "timestamp": row.get::<_, String>(5)?
                }))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;

        Ok(serde_json::json!({ "nodes": nodes, "edges": edges }))
    }
}
