//! Permissions & approval management.
//!
//! - Allowlists per tool category (loaded from config)
//! - Session-scoped permit cache: once approved, cached for the session

use std::collections::HashSet;
use std::sync::Mutex;

/// Manages tool permissions and session-scoped approval cache.
pub struct PermissionManager {
    /// Tools approved for the rest of this session (by tool name).
    session_tool_permits: Mutex<HashSet<String>>,
}

impl PermissionManager {
    pub fn new() -> Self {
        PermissionManager {
            session_tool_permits: Mutex::new(HashSet::new()),
        }
    }

    /// Check whether a tool is already permitted this session.
    pub fn is_permitted_session(&self, tool: &str) -> bool {
        self.session_tool_permits.lock().unwrap().contains(tool)
    }

    /// Grant session-scoped permission for a tool.
    pub fn grant_session(&self, tool: &str) {
        self.session_tool_permits.lock().unwrap().insert(tool.to_string());
    }

    /// Clear all session permits (e.g., on emergency stop).
    pub fn clear_session(&self) {
        self.session_tool_permits.lock().unwrap().clear();
    }
}
