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

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_manager_has_no_permits() {
        let pm = PermissionManager::new();
        assert!(!pm.is_permitted_session("fs.readFile"));
        assert!(!pm.is_permitted_session("cmd.run"));
    }

    #[test]
    fn test_grant_makes_tool_permitted() {
        let pm = PermissionManager::new();
        pm.grant_session("fs.readFile");
        assert!(pm.is_permitted_session("fs.readFile"));
    }

    #[test]
    fn test_grant_does_not_permit_other_tools() {
        let pm = PermissionManager::new();
        pm.grant_session("fs.readFile");
        assert!(!pm.is_permitted_session("cmd.run"));
        assert!(!pm.is_permitted_session("net.fetch"));
    }

    #[test]
    fn test_grant_same_tool_twice_is_idempotent() {
        let pm = PermissionManager::new();
        pm.grant_session("fs.readFile");
        pm.grant_session("fs.readFile");
        assert!(pm.is_permitted_session("fs.readFile"));
    }

    #[test]
    fn test_clear_revokes_all_permits() {
        let pm = PermissionManager::new();
        pm.grant_session("fs.readFile");
        pm.grant_session("cmd.run");
        pm.clear_session();
        assert!(!pm.is_permitted_session("fs.readFile"));
        assert!(!pm.is_permitted_session("cmd.run"));
    }

    #[test]
    fn test_re_grant_after_clear_works() {
        let pm = PermissionManager::new();
        pm.grant_session("net.fetch");
        pm.clear_session();
        assert!(!pm.is_permitted_session("net.fetch"));
        pm.grant_session("net.fetch");
        assert!(pm.is_permitted_session("net.fetch"));
    }
}
