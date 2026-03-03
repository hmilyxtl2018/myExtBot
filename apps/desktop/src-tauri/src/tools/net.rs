//! Network fetch tool definition and implementation.

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

/// Perform an HTTP request.
///
/// `headers` should be a JSON object of `{ "Header-Name": "value" }`.
/// `body` must be valid UTF-8 text (JSON, form-encoded, plain text, etc.);
/// binary payloads are not supported.
/// Returns `{ "status": <http status code>, "body": "<response text>" }`.
pub async fn fetch(url: &str, method: &str, headers: &Value, body: Option<&str>) -> Result<Value> {
    let method_parsed = reqwest::Method::from_bytes(method.as_bytes())
        .map_err(|_| anyhow::anyhow!("net.fetch: invalid HTTP method '{method}'"))?;

    let client = reqwest::Client::new();
    let mut req = client.request(method_parsed, url);

    if let Some(h) = headers.as_object() {
        for (k, v) in h {
            if let Some(v_str) = v.as_str() {
                req = req.header(k.as_str(), v_str);
            }
        }
    }

    if let Some(b) = body {
        req = req.body(b.to_string());
    }

    let resp = req
        .send()
        .await
        .map_err(|e| anyhow::anyhow!("HTTP request to {url} failed: {e}"))?;

    let status = resp.status().as_u16();
    let text = resp
        .text()
        .await
        .map_err(|e| anyhow::anyhow!("Failed to read HTTP response body: {e}"))?;

    Ok(json!({ "status": status, "body": text }))
}
