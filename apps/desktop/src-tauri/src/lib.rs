mod agent;
mod audit;
mod commands;
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
            // Initialize audit database
            let db = audit::init_db(&app_handle)?;
            // Initialize agent state — must be created before managing the DB so we
            // have a session_id to insert into the sessions table before any FK references.
            let agent = agent::AgentState::new(app_handle.clone());
            // Record session start in audit DB before any tool calls can arrive
            db.log_session_start(agent.session_id())?;
            app.manage(db);
            app.manage(agent);
            // Initialize permissions
            let perms = permissions::PermissionManager::new();
            app.manage(perms);
            // Initialize tool registry
            let tools = tools::ToolRegistry::new();
            app.manage(tools);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::send_message,
            commands::emergency_stop,
            commands::approve_tool_call,
            commands::deny_tool_call,
            commands::get_audit_log,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
