//! Tool registry and JSON-schema validation framework.

#![allow(dead_code)]

pub mod cmd;
pub mod desktop;
pub mod fs;
pub mod net;

use anyhow::Result;
use serde_json::Value;
use std::collections::HashMap;

/// A registered tool with its JSON Schema for parameter validation.
pub struct ToolDef {
    pub name: &'static str,
    pub description: &'static str,
    /// JSON Schema (Draft-07) for the `params` object.
    pub params_schema: Value,
}

/// Global tool registry.
pub struct ToolRegistry {
    tools: HashMap<&'static str, ToolDef>,
}

impl ToolRegistry {
    pub fn new() -> Self {
        let mut registry = ToolRegistry {
            tools: HashMap::new(),
        };
        registry.register_all();
        registry
    }

    fn register_all(&mut self) {
        self.register(fs::read_file_def());
        self.register(fs::apply_patch_def());
        self.register(cmd::run_def());
        self.register(net::fetch_def());
        self.register(desktop::screenshot_def());
        self.register(desktop::get_active_window_def());
        self.register(desktop::click_rect_center_def());
        self.register(desktop::ocr_cloud_def());
    }

    fn register(&mut self, def: ToolDef) {
        self.tools.insert(def.name, def);
    }

    pub fn get(&self, name: &str) -> Option<&ToolDef> {
        self.tools.get(name)
    }

    pub fn validate_params(&self, tool: &str, params: &Value) -> Result<()> {
        let def = self
            .get(tool)
            .ok_or_else(|| anyhow::anyhow!("Unknown tool: {tool}"))?;
        let compiled = jsonschema::JSONSchema::compile(&def.params_schema)
            .map_err(|e| anyhow::anyhow!("Schema compile error: {e}"))?;
        if compiled.is_valid(params) {
            return Ok(());
        }
        // Eagerly collect errors before `compiled` is dropped.
        let msg: Vec<String> = compiled
            .validate(params)
            .err()
            .map(|errors| errors.map(|e| e.to_string()).collect())
            .unwrap_or_default();
        Err(anyhow::anyhow!("Param validation failed: {}", msg.join("; ")))
    }

    pub fn list_names(&self) -> Vec<&'static str> {
        self.tools.keys().copied().collect()
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // ── ToolRegistry::list_names ──────────────────────────────────────────────

    #[test]
    fn test_registry_registers_all_expected_tools() {
        let reg = ToolRegistry::new();
        let names = reg.list_names();
        let expected = [
            "fs.readFile",
            "fs.applyPatch",
            "cmd.run",
            "net.fetch",
            "desktop.screenshot",
            "desktop.getActiveWindowInfo",
            "desktop.clickRectCenter",
            "desktop.ocrCloud",
        ];
        for tool in &expected {
            assert!(
                names.contains(tool),
                "expected tool '{tool}' to be registered"
            );
        }
    }

    #[test]
    fn test_get_known_tool_returns_some() {
        let reg = ToolRegistry::new();
        assert!(reg.get("fs.readFile").is_some());
        assert!(reg.get("cmd.run").is_some());
    }

    #[test]
    fn test_get_unknown_tool_returns_none() {
        let reg = ToolRegistry::new();
        assert!(reg.get("unknown.tool").is_none());
        assert!(reg.get("").is_none());
    }

    // ── validate_params: fs.readFile ─────────────────────────────────────────

    #[test]
    fn test_validate_fs_read_file_valid() {
        let reg = ToolRegistry::new();
        assert!(reg
            .validate_params("fs.readFile", &json!({"path": "/tmp/test.txt"}))
            .is_ok());
    }

    #[test]
    fn test_validate_fs_read_file_missing_required_path() {
        let reg = ToolRegistry::new();
        assert!(reg.validate_params("fs.readFile", &json!({})).is_err());
    }

    #[test]
    fn test_validate_fs_read_file_extra_property_rejected() {
        let reg = ToolRegistry::new();
        assert!(reg
            .validate_params("fs.readFile", &json!({"path": "/tmp/x", "extra": 1}))
            .is_err());
    }

    // ── validate_params: fs.applyPatch ───────────────────────────────────────

    #[test]
    fn test_validate_fs_apply_patch_valid() {
        let reg = ToolRegistry::new();
        assert!(reg
            .validate_params("fs.applyPatch", &json!({"path": "/tmp/x", "patch": "--- a\n+++ b"}))
            .is_ok());
    }

    #[test]
    fn test_validate_fs_apply_patch_missing_patch() {
        let reg = ToolRegistry::new();
        assert!(reg
            .validate_params("fs.applyPatch", &json!({"path": "/tmp/x"}))
            .is_err());
    }

    // ── validate_params: cmd.run ─────────────────────────────────────────────

    #[test]
    fn test_validate_cmd_run_valid_without_cwd() {
        let reg = ToolRegistry::new();
        assert!(reg
            .validate_params("cmd.run", &json!({"program": "ls", "args": ["-la"]}))
            .is_ok());
    }

    #[test]
    fn test_validate_cmd_run_valid_with_cwd() {
        let reg = ToolRegistry::new();
        assert!(reg
            .validate_params(
                "cmd.run",
                &json!({"program": "cargo", "args": ["test"], "cwd": "/tmp"})
            )
            .is_ok());
    }

    #[test]
    fn test_validate_cmd_run_missing_program() {
        let reg = ToolRegistry::new();
        assert!(reg
            .validate_params("cmd.run", &json!({"args": []}))
            .is_err());
    }

    #[test]
    fn test_validate_cmd_run_args_must_be_array() {
        let reg = ToolRegistry::new();
        assert!(reg
            .validate_params("cmd.run", &json!({"program": "ls", "args": "not-an-array"}))
            .is_err());
    }

    // ── validate_params: net.fetch ───────────────────────────────────────────

    #[test]
    fn test_validate_net_fetch_valid_minimal() {
        let reg = ToolRegistry::new();
        assert!(reg
            .validate_params("net.fetch", &json!({"url": "https://example.com"}))
            .is_ok());
    }

    #[test]
    fn test_validate_net_fetch_valid_with_method_and_headers() {
        let reg = ToolRegistry::new();
        assert!(reg
            .validate_params(
                "net.fetch",
                &json!({
                    "url": "https://api.example.com/data",
                    "method": "POST",
                    "headers": {"Content-Type": "application/json"},
                    "body": "{\"key\":\"value\"}"
                })
            )
            .is_ok());
    }

    #[test]
    fn test_validate_net_fetch_missing_url() {
        let reg = ToolRegistry::new();
        assert!(reg
            .validate_params("net.fetch", &json!({"method": "GET"}))
            .is_err());
    }

    #[test]
    fn test_validate_net_fetch_invalid_method() {
        let reg = ToolRegistry::new();
        // "CONNECT" is not in the enum
        assert!(reg
            .validate_params("net.fetch", &json!({"url": "https://x.com", "method": "CONNECT"}))
            .is_err());
    }

    // ── validate_params: desktop tools ───────────────────────────────────────

    #[test]
    fn test_validate_desktop_screenshot_empty_params_valid() {
        let reg = ToolRegistry::new();
        // display is optional
        assert!(reg.validate_params("desktop.screenshot", &json!({})).is_ok());
    }

    #[test]
    fn test_validate_desktop_screenshot_with_display_index() {
        let reg = ToolRegistry::new();
        assert!(reg
            .validate_params("desktop.screenshot", &json!({"display": 0}))
            .is_ok());
    }

    #[test]
    fn test_validate_desktop_click_rect_center_valid() {
        let reg = ToolRegistry::new();
        assert!(reg
            .validate_params(
                "desktop.clickRectCenter",
                &json!({"x": 100, "y": 200, "width": 300, "height": 150})
            )
            .is_ok());
    }

    #[test]
    fn test_validate_desktop_click_rect_center_missing_required_field() {
        let reg = ToolRegistry::new();
        // height is missing
        assert!(reg
            .validate_params(
                "desktop.clickRectCenter",
                &json!({"x": 100, "y": 200, "width": 300})
            )
            .is_err());
    }

    #[test]
    fn test_validate_desktop_ocr_cloud_valid() {
        let reg = ToolRegistry::new();
        assert!(reg
            .validate_params("desktop.ocrCloud", &json!({"image_b64": "abc123=="}))
            .is_ok());
    }

    #[test]
    fn test_validate_desktop_ocr_cloud_with_prompt() {
        let reg = ToolRegistry::new();
        assert!(reg
            .validate_params(
                "desktop.ocrCloud",
                &json!({"image_b64": "abc123==", "prompt": "extract all text"})
            )
            .is_ok());
    }

    #[test]
    fn test_validate_desktop_ocr_cloud_missing_image() {
        let reg = ToolRegistry::new();
        assert!(reg
            .validate_params("desktop.ocrCloud", &json!({}))
            .is_err());
    }

    // ── validate_params: unknown tool ────────────────────────────────────────

    #[test]
    fn test_validate_unknown_tool_returns_err() {
        let reg = ToolRegistry::new();
        assert!(reg
            .validate_params("unknown.tool", &json!({"foo": "bar"}))
            .is_err());
    }
}
