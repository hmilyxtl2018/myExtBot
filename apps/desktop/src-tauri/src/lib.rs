mod agent;
mod audit;
mod collab;
mod commands;
mod db;
mod events;
mod permissions;
mod tools;

use tauri::Manager;
use tracing_subscriber::{fmt, EnvFilter};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize tracing
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
