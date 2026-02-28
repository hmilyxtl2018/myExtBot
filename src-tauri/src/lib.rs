pub mod agent;
pub mod commands;
pub mod state_machine;

use agent::AgentManager;
use commands::{approve_tool, get_state, reject_tool, send_message};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AgentManager::new())
        .invoke_handler(tauri::generate_handler![
            send_message,
            approve_tool,
            reject_tool,
            get_state
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
