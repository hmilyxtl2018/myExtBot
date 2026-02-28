//! Permissions & approval management.
//!
//! - Allowlists per tool category (loaded from config)
//! - Session-scoped permit cache: once approved, cached for the session

use std::collections::HashSet;
use std::sync::Mutex;

/// Determines the scope at which an approval is cached.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ApprovalScope {
    /// Ask every time.
    Once,
    /// Cache approval for the rest of the session.
    Session,
    /// Never auto-approve (always ask).
    Never,
}

/// Manages tool permissions and session-scoped approval cache.
pub struct PermissionManager {
    /// Set of (tool_name, params_hash) pairs approved for this session.
    session_permits: Mutex<HashSet<String>>,
    /// Tools approved "always" for this session (tool name only).
    session_tool_permits: Mutex<HashSet<String>>,
}

impl PermissionManager {
    pub fn new() -> Self {
        PermissionManager {
            session_permits: Mutex::new(HashSet::new()),
            session_tool_permits: Mutex::new(HashSet::new()),
        }
    }

    /// Check whether a tool call is already permitted this session.
    pub fn is_permitted_session(&self, tool: &str) -> bool {
        let permits = self.session_tool_permits.lock().unwrap();
        permits.contains(tool)
    }

    /// Grant session-scoped permission for a tool.
    pub fn grant_session(&self, tool: &str) {
        let mut permits = self.session_tool_permits.lock().unwrap();
        permits.insert(tool.to_string());
    }

    /// Revoke session-scoped permission for a tool.
    pub fn revoke_session(&self, tool: &str) {
        let mut permits = self.session_tool_permits.lock().unwrap();
        permits.remove(tool);
    }

    /// Clear all session permits (e.g., on emergency stop).
    pub fn clear_session(&self) {
        let mut permits = self.session_tool_permits.lock().unwrap();
        permits.clear();
    }
}
