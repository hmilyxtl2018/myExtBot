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
        ",
    )?;
    Ok(())
}
