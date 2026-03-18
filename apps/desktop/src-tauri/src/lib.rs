mod agent;
mod audit;
mod commands;
mod events;
mod graph;
mod intervention;
mod executor;
mod llm;
mod permissions;
mod planner;
mod tools;
mod verifier;

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
            // Initialize graph builder
            let graph_builder = graph::GraphBuilder::new(
                app_handle.clone(),
                agent.session_id().to_string(),
            );
            app.manage(db);
            app.manage(agent);
            app.manage(graph_builder);
            // Initialize permissions
            let perms = permissions::PermissionManager::new();
            app.manage(perms);
            // Initialize tool registry
            let tools = tools::ToolRegistry::new();
            app.manage(tools);
            // Initialize LLM client from environment
            let llm_client = llm::client_from_env();
            app.manage(llm_client);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::send_message,
            commands::emergency_stop,
            commands::approve_tool_call,
            commands::deny_tool_call,
            commands::approve_plan,
            commands::deny_plan,
            commands::get_audit_log,
            commands::get_run_graph,
            commands::block_edge,
            commands::replace_artifact,
            commands::insert_verifier,
            commands::save_verifier_rule,
            commands::list_verifier_rules,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
