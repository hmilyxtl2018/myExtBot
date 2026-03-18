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
