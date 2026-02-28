//! Command execution tool definition and placeholder.

use super::ToolDef;
use anyhow::Result;
use serde_json::{json, Value};

pub fn run_def() -> ToolDef {
    ToolDef {
        name: "cmd.run",
        description: "Run a system command. Structured as program + args array to prevent shell injection.",
        params_schema: json!({
            "type": "object",
            "properties": {
                "program": { "type": "string", "description": "Executable name or absolute path" },
                "args": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "Argument list (no shell expansion)"
                },
                "cwd": { "type": "string", "description": "Working directory (optional)" }
            },
            "required": ["program", "args"],
            "additionalProperties": false
        }),
    }
}

/// Execute a command. Requires prior allowlist check.
pub async fn run(program: &str, args: &[String], cwd: Option<&str>) -> Result<Value> {
    // Enforcement hook placeholder: call permissions check before running
    let mut cmd = tokio::process::Command::new(program);
    cmd.args(args);
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    let output = cmd.output().await?;
    Ok(json!({
        "exit_code": output.status.code(),
        "stdout": String::from_utf8_lossy(&output.stdout),
        "stderr": String::from_utf8_lossy(&output.stderr)
    }))
}
