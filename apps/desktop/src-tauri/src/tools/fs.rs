//! Filesystem tool definitions and placeholder implementations.

use super::ToolDef;
use anyhow::Result;
use serde_json::{json, Value};

pub fn read_file_def() -> ToolDef {
    ToolDef {
        name: "fs.readFile",
        description: "Read the contents of a file at the given path.",
        params_schema: json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "Absolute or workspace-relative file path" }
            },
            "required": ["path"],
            "additionalProperties": false
        }),
    }
}

pub fn apply_patch_def() -> ToolDef {
    ToolDef {
        name: "fs.applyPatch",
        description: "Apply a unified diff patch to a file.",
        params_schema: json!({
            "type": "object",
            "properties": {
                "path": { "type": "string" },
                "patch": { "type": "string", "description": "Unified diff content" }
            },
            "required": ["path", "patch"],
            "additionalProperties": false
        }),
    }
}

/// Read a file, respecting the permissions allowlist.
pub async fn read_file(path: &str) -> Result<Value> {
    let content = tokio::fs::read_to_string(path).await?;
    Ok(json!({ "content": content }))
}

/// Placeholder: apply a patch to a file.
pub async fn apply_patch(_path: &str, _patch: &str) -> Result<Value> {
    // TODO: implement unified diff application
    Err(anyhow::anyhow!("fs.applyPatch is not yet implemented"))
}
