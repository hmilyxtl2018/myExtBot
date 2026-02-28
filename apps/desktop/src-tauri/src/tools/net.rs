//! Network fetch tool definition and placeholder.

#![allow(dead_code)]

use super::ToolDef;
use anyhow::Result;
use serde_json::{json, Value};

pub fn fetch_def() -> ToolDef {
    ToolDef {
        name: "net.fetch",
        description: "Perform an HTTP request to an allowed URL.",
        params_schema: json!({
            "type": "object",
            "properties": {
                "url": { "type": "string", "format": "uri" },
                "method": {
                    "type": "string",
                    "enum": ["GET", "POST", "PUT", "PATCH", "DELETE"],
                    "default": "GET"
                },
                "headers": {
                    "type": "object",
                    "additionalProperties": { "type": "string" }
                },
                "body": { "type": "string" }
            },
            "required": ["url"],
            "additionalProperties": false
        }),
    }
}

/// Placeholder: perform an HTTP request.
pub async fn fetch(_url: &str, _method: &str, _headers: &Value, _body: Option<&str>) -> Result<Value> {
    // TODO: implement using reqwest with allowlist check
    Err(anyhow::anyhow!("net.fetch is not yet implemented"))
}
