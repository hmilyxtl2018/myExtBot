//! Database initialization.
//!
//! Opens (or creates) the SQLite database file in the app's local data directory
//! and runs all schema migrations.

use anyhow::Result;
use rusqlite::Connection;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri::Manager;

/// Return the path to the audit database file, creating parent directories as needed.
pub fn db_path(app: &AppHandle) -> Result<PathBuf> {
    let data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| anyhow::anyhow!("could not resolve app data dir: {e}"))?;
    std::fs::create_dir_all(&data_dir)?;
    Ok(data_dir.join("audit.db"))
}

/// Open the database at the app's local data directory, creating it if absent,
/// and run all pending schema migrations.
pub fn open(app: &AppHandle) -> Result<Connection> {
    let path = db_path(app)?;
    let conn = Connection::open(path)?;
    run_migrations(&conn)?;
    Ok(conn)
}

pub(crate) fn run_migrations(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        PRAGMA journal_mode=WAL;
        PRAGMA foreign_keys=ON;

        -- Generic audit log table as required by the audit logging specification.
        -- event_type: 'model_usage' | 'tool_call' | 'permission_check'
        -- details: JSON-serialized event-specific payload
        CREATE TABLE IF NOT EXISTS audit_logs (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp   DATETIME NOT NULL,
            event_type  TEXT     NOT NULL,
            details     TEXT     NOT NULL
        );

        -- Session tracking table
        CREATE TABLE IF NOT EXISTS sessions (
            id          TEXT PRIMARY KEY,
            started_at  TEXT NOT NULL,
            ended_at    TEXT,
            metadata    TEXT
        );

        -- Multi-agent collaboration tables

        -- Known team members (local registry of all bots in the same team).
        -- Each running myExtBot instance registers itself here on startup.
        CREATE TABLE IF NOT EXISTS agents (
            id          TEXT PRIMARY KEY,          -- UUID stable per installation
            name        TEXT NOT NULL,             -- human-readable label, e.g. 'Alice-bot'
            role        TEXT,                      -- optional role tag, e.g. 'backend', 'pm'
            endpoint    TEXT,                      -- ws:// or http:// address (NULL = local)
            team_id     TEXT NOT NULL,             -- logical team identifier
            is_local    INTEGER NOT NULL DEFAULT 0, -- 1 = this installation's own bot
            last_seen   TEXT NOT NULL
        );

        -- Collaborative tasks that can be delegated between agents.
        -- status: 'pending' | 'in_progress' | 'done' | 'failed' | 'cancelled'
        CREATE TABLE IF NOT EXISTS tasks (
            id              TEXT PRIMARY KEY,
            title           TEXT NOT NULL,
            description     TEXT,
            status          TEXT NOT NULL DEFAULT 'pending',
            assigned_to     TEXT REFERENCES agents(id),
            delegated_by    TEXT REFERENCES agents(id),
            created_at      TEXT NOT NULL,
            updated_at      TEXT NOT NULL,
            result          TEXT    -- JSON result payload (populated on completion)
        );

        -- Inter-agent messages (immutable log for audit / replay).
        -- msg_type: 'task_assigned' | 'task_update' | 'task_result' | 'ping'
        CREATE TABLE IF NOT EXISTS collab_messages (
            id          TEXT PRIMARY KEY,
            from_agent  TEXT NOT NULL REFERENCES agents(id),
            to_agent    TEXT NOT NULL REFERENCES agents(id),
            task_id     TEXT REFERENCES tasks(id),
            msg_type    TEXT NOT NULL,
            payload     TEXT NOT NULL,   -- JSON
            timestamp   TEXT NOT NULL
        );
        ",
    )?;
    Ok(())
}
