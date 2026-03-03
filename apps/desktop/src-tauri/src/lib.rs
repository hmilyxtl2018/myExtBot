mod agent;
mod audit;
mod collab;
mod commands;
mod db;
mod events;
mod llm;
mod permissions;
mod tools;

use tauri::Manager;
use tracing_subscriber::{fmt, EnvFilter};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Load .env file from the working directory (silently ignored if absent).
    dotenvy::dotenv().ok();

    // Initialize tracing (respects RUST_LOG env var).
    fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let app_handle = app.handle().clone();
            // Initialize audit database (opens/creates the SQLite file in app data dir)
            let db = audit::init_db(&app_handle)?;
            // Initialize agent state — session_id is needed before any FK references.
            let agent = agent::AgentState::new(app_handle.clone());
            // Record session start in audit DB
            db.log_session_start(agent.session_id())?;
            app.manage(db);
            app.manage(agent);
            // Initialize permissions
            let perms = permissions::PermissionManager::new();
            app.manage(perms);
            // Initialize tool registry
            let tools = tools::ToolRegistry::new();
            app.manage(tools);
            // Initialize multi-agent collaboration layer
            let collab_conn = db::open(&app_handle)?;
            let registry = collab::TeamRegistry::new(collab_conn);

            // Register the local bot identity from env vars (or sensible defaults).
            let agent_id = std::env::var("AGENT_ID")
                .unwrap_or_else(|_| uuid::Uuid::new_v4().to_string());
            let agent_name = std::env::var("AGENT_NAME")
                .unwrap_or_else(|_| "MyBot".into());
            let team_id = std::env::var("AGENT_TEAM_ID")
                .unwrap_or_else(|_| "team-default".into());
            let agent_role = std::env::var("AGENT_ROLE").ok();

            let identity = collab::AgentIdentity {
                id:       agent_id,
                name:     agent_name,
                role:     agent_role,
                endpoint: None,
                team_id,
                is_local: true,
                last_seen: chrono::Utc::now(),
            };
            if let Err(e) = registry.upsert_agent(&identity) {
                tracing::warn!("Could not register local agent identity: {e}");
            }

            app.manage(registry);
            let bus = collab::CollabBus::new();
            app.manage(bus);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::send_message,
            commands::emergency_stop,
            commands::approve_tool_call,
            commands::deny_tool_call,
            commands::get_audit_logs,
            // Multi-agent collaboration
            commands::register_agent,
            commands::get_team_agents,
            commands::delegate_task,
            commands::update_task_status,
            commands::get_tasks,
            commands::get_collab_messages,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
