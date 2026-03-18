//! Filesystem tool definitions and placeholder implementations.

#![allow(dead_code)]

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

/// Apply a unified diff patch to a file and write the result back to disk.
///
/// # Errors
/// Returns an error when the file cannot be read, the patch cannot be parsed
/// (malformed unified-diff syntax), or the patch does not apply cleanly
/// (e.g. context lines no longer match the on-disk content).
pub async fn apply_patch(path: &str, patch: &str) -> Result<Value> {
    let original = tokio::fs::read_to_string(path).await?;
    let parsed = diffy::Patch::from_str(patch)
        .map_err(|e| anyhow::anyhow!("fs.applyPatch: failed to parse patch: {e}"))?;
    let patched = diffy::apply(&original, &parsed)
        .map_err(|e| anyhow::anyhow!("fs.applyPatch: patch did not apply cleanly: {e}"))?;
    tokio::fs::write(path, &patched).await?;
    Ok(json!({ "lines": patched.lines().count() }))
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    /// Write `content` to a temp file and return the file handle (keeps it alive).
    fn make_temp(content: &str) -> NamedTempFile {
        let mut f = NamedTempFile::new().unwrap();
        f.write_all(content.as_bytes()).unwrap();
        f
    }

    // ── read_file ─────────────────────────────────────────────────────────────

    #[tokio::test]
    async fn test_read_file_returns_content() {
        let f = make_temp("hello world\n");
        let result = read_file(f.path().to_str().unwrap()).await.unwrap();
        assert_eq!(result["content"], "hello world\n");
    }

    #[tokio::test]
    async fn test_read_file_missing_path_returns_error() {
        let result = read_file("/nonexistent/path/to/file.txt").await;
        assert!(result.is_err());
    }

    // ── apply_patch ───────────────────────────────────────────────────────────

    #[tokio::test]
    async fn test_apply_patch_adds_line() {
        let original = "line1\nline2\n";
        let f = make_temp(original);
        let path = f.path().to_str().unwrap();

        // A valid unified diff that adds "line3\n" after "line2\n".
        let patch = "--- a\n+++ b\n@@ -1,2 +1,3 @@\n line1\n line2\n+line3\n";
        apply_patch(path, patch).await.unwrap();

        let written = tokio::fs::read_to_string(path).await.unwrap();
        assert_eq!(written, "line1\nline2\nline3\n");
    }

    #[tokio::test]
    async fn test_apply_patch_removes_line() {
        let original = "keep\nremove\n";
        let f = make_temp(original);
        let path = f.path().to_str().unwrap();

        let patch = "--- a\n+++ b\n@@ -1,2 +1,1 @@\n keep\n-remove\n";
        apply_patch(path, patch).await.unwrap();

        let written = tokio::fs::read_to_string(path).await.unwrap();
        assert_eq!(written, "keep\n");
    }

    #[tokio::test]
    async fn test_apply_patch_replaces_line() {
        let original = "old\nstable\n";
        let f = make_temp(original);
        let path = f.path().to_str().unwrap();

        let patch = "--- a\n+++ b\n@@ -1,2 +1,2 @@\n-old\n+new\n stable\n";
        apply_patch(path, patch).await.unwrap();

        let written = tokio::fs::read_to_string(path).await.unwrap();
        assert_eq!(written, "new\nstable\n");
    }

    #[tokio::test]
    async fn test_apply_patch_returns_line_count() {
        let original = "a\nb\n";
        let f = make_temp(original);
        let path = f.path().to_str().unwrap();

        let patch = "--- a\n+++ b\n@@ -1,2 +1,3 @@\n a\n b\n+c\n";
        let result = apply_patch(path, patch).await.unwrap();
        assert_eq!(result["lines"], 3);
    }

    #[tokio::test]
    async fn test_apply_patch_malformed_patch_returns_error() {
        // A patch with an invalid `@@` hunk header (non-numeric range count `xyz`)
        // must be rejected at parse time.
        let f = make_temp("anything\n");
        let malformed = "--- a\n+++ b\n@@ -1,xyz +1,1 @@\n-old\n";
        let result = apply_patch(f.path().to_str().unwrap(), malformed).await;
        assert!(result.is_err());
        let msg = result.unwrap_err().to_string();
        assert!(msg.contains("parse patch"), "error should mention parse failure: {msg}");
    }

    #[tokio::test]
    async fn test_apply_patch_context_mismatch_returns_error() {
        // The patch expects "line1" but the file contains "different"
        let f = make_temp("different\n");
        let patch = "--- a\n+++ b\n@@ -1,1 +1,2 @@\n line1\n+line2\n";
        let result = apply_patch(f.path().to_str().unwrap(), patch).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_apply_patch_nonexistent_file_returns_error() {
        let patch = "--- a\n+++ b\n@@ -1,1 +1,1 @@\n-old\n+new\n";
        let result = apply_patch("/nonexistent/path.txt", patch).await;
        assert!(result.is_err());
    }
}

