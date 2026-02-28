//! Desktop automation tool definitions (Windows-first).

use super::ToolDef;
use anyhow::Result;
use serde_json::{json, Value};

pub fn screenshot_def() -> ToolDef {
    ToolDef {
        name: "desktop.screenshot",
        description: "Capture a screenshot of the primary display. Returns base64-encoded PNG.",
        params_schema: json!({
            "type": "object",
            "properties": {
                "display": { "type": "integer", "description": "Display index (0 = primary)", "default": 0 }
            },
            "additionalProperties": false
        }),
    }
}

pub fn get_active_window_def() -> ToolDef {
    ToolDef {
        name: "desktop.getActiveWindowInfo",
        description: "Get title and bounding rect of the currently focused window.",
        params_schema: json!({
            "type": "object",
            "properties": {},
            "additionalProperties": false
        }),
    }
}

pub fn click_rect_center_def() -> ToolDef {
    ToolDef {
        name: "desktop.clickRectCenter",
        description: "Click the center of a screen rectangle (x, y, width, height).",
        params_schema: json!({
            "type": "object",
            "properties": {
                "x": { "type": "integer" },
                "y": { "type": "integer" },
                "width": { "type": "integer" },
                "height": { "type": "integer" }
            },
            "required": ["x", "y", "width", "height"],
            "additionalProperties": false
        }),
    }
}

pub fn ocr_cloud_def() -> ToolDef {
    ToolDef {
        name: "desktop.ocrCloud",
        description: "Send a base64 image to an OpenAI-compatible Vision provider and return extracted text.",
        params_schema: json!({
            "type": "object",
            "properties": {
                "image_b64": { "type": "string", "description": "Base64-encoded PNG image" },
                "prompt": { "type": "string", "description": "Optional instruction to the vision model" }
            },
            "required": ["image_b64"],
            "additionalProperties": false
        }),
    }
}

// ── Placeholder implementations ──────────────────────────────────────────────

/// Placeholder: capture a screenshot.
pub async fn screenshot(_display: u32) -> Result<Value> {
    // TODO: implement using Windows GDI / DXGI capture
    Err(anyhow::anyhow!("desktop.screenshot is not yet implemented"))
}

/// Placeholder: get active window info.
pub async fn get_active_window_info() -> Result<Value> {
    // TODO: implement using Windows WinAPI GetForegroundWindow
    Err(anyhow::anyhow!(
        "desktop.getActiveWindowInfo is not yet implemented"
    ))
}

/// Placeholder: click the center of a rect.
pub async fn click_rect_center(x: i32, y: i32, width: i32, height: i32) -> Result<Value> {
    let _ = (x, y, width, height);
    // TODO: implement using Windows SendInput / mouse_event
    Err(anyhow::anyhow!(
        "desktop.clickRectCenter is not yet implemented"
    ))
}

/// Placeholder: OCR via cloud vision API.
pub async fn ocr_cloud(_image_b64: &str, _prompt: Option<&str>) -> Result<Value> {
    // TODO: call OpenAI-compatible vision endpoint
    Err(anyhow::anyhow!("desktop.ocrCloud is not yet implemented"))
}
