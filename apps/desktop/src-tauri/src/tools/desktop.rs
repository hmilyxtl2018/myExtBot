//! Desktop automation tool definitions (cross-platform).

#![allow(dead_code)]

use super::ToolDef;
use anyhow::Result;
use base64::Engine;
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

// ── Implementations ───────────────────────────────────────────────────────────

/// Capture a screenshot of the specified display (0 = primary).
///
/// Uses the `screenshots` crate for cross-platform screen capture.  Returns a
/// JSON object with the base64-encoded PNG data, width and height:
/// `{ "data": "<base64>", "format": "png", "width": <w>, "height": <h> }`.
///
/// Returns a descriptive error in headless / display-unavailable environments
/// rather than panicking.
pub async fn screenshot(display: u32) -> Result<Value> {
    use image::ImageFormat;
    use std::io::Cursor;

    let screens = screenshots::Screen::all()
        .map_err(|e| anyhow::anyhow!("No display available: {e}"))?;

    if screens.is_empty() {
        return Err(anyhow::anyhow!("No display available"));
    }

    let screen = screens
        .into_iter()
        .nth(display as usize)
        .ok_or_else(|| anyhow::anyhow!("Display index {display} not found"))?;

    let capture = screen
        .capture()
        .map_err(|e| anyhow::anyhow!("Screen capture failed: {e}"))?;

    let width = capture.width();
    let height = capture.height();

    let mut png_bytes: Vec<u8> = Vec::new();
    capture
        .write_to(&mut Cursor::new(&mut png_bytes), ImageFormat::Png)
        .map_err(|e| anyhow::anyhow!("Failed to encode screenshot as PNG: {e}"))?;

    let b64 = base64::engine::general_purpose::STANDARD.encode(&png_bytes);

    Ok(json!({
        "data":   b64,
        "format": "png",
        "width":  width,
        "height": height,
    }))
}

/// Get active window info — not yet implemented on this platform.
pub async fn get_active_window_info() -> Result<Value> {
    // TODO: implement using platform-specific window APIs
    Err(anyhow::anyhow!(
        "desktop.getActiveWindowInfo is not yet implemented"
    ))
}

/// Click the center of the given screen rectangle `(x, y, width, height)`.
///
/// Calculates `cx = x + width/2`, `cy = y + height/2`, moves the cursor to
/// that point, and fires a left-mouse-button click via the `enigo` crate.
///
/// Returns `{ "clicked_at": { "x": <cx>, "y": <cy> } }` on success, or a
/// descriptive error in headless / input-simulation-unavailable environments.
pub async fn click_rect_center(x: i32, y: i32, width: i32, height: i32) -> Result<Value> {
    use enigo::{Button, Coordinate, Direction, Enigo, Mouse, Settings};

    let cx = x + width / 2;
    let cy = y + height / 2;

    let mut enigo = Enigo::new(&Settings::default())
        .map_err(|e| anyhow::anyhow!("Input simulation unavailable: {e}"))?;

    enigo
        .move_mouse(cx, cy, Coordinate::Abs)
        .map_err(|e| anyhow::anyhow!("Failed to move mouse to ({cx}, {cy}): {e}"))?;

    enigo
        .button(Button::Left, Direction::Click)
        .map_err(|e| anyhow::anyhow!("Failed to click at ({cx}, {cy}): {e}"))?;

    Ok(json!({ "clicked_at": { "x": cx, "y": cy } }))
}

/// OCR via a cloud vision API (OpenAI-compatible by default).
///
/// `image_b64` must be a base64-encoded PNG/JPEG image.
/// `prompt` is an optional instruction passed to the vision model.
///
/// * When `OCR_API_KEY` is **not** set the function returns a `[stub]` result
///   instead of returning an error, enabling offline / CI use.
/// * `OCR_PROVIDER` selects the backend; currently only `"openai"` (default)
///   is supported.
/// * The API key is read **exclusively** from the `OCR_API_KEY` environment
///   variable — it is never hard-coded.
pub async fn ocr_cloud(image_b64: &str, prompt: Option<&str>) -> Result<Value> {
    if image_b64.is_empty() {
        return Err(anyhow::anyhow!("ocr_cloud: image_b64 must not be empty"));
    }

    let api_key = std::env::var("OCR_API_KEY").unwrap_or_default();

    if api_key.is_empty() {
        // No API key — return a stub result so CI / offline environments work.
        return Ok(json!({
            "text":     "[stub] OCR result — set OCR_API_KEY to enable real OCR",
            "provider": "stub",
        }));
    }

    let provider = std::env::var("OCR_PROVIDER").unwrap_or_else(|_| "openai".into());

    match provider.as_str() {
        "openai" => {
            let instruction = prompt.unwrap_or("Extract all text from this image.");
            let client = reqwest::Client::new();

            let body = json!({
                "model": "gpt-4o",
                "messages": [{
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": format!("data:image/png;base64,{image_b64}")
                            }
                        },
                        {
                            "type": "text",
                            "text": instruction
                        }
                    ]
                }],
                "max_tokens": 4096
            });

            let resp = client
                .post("https://api.openai.com/v1/chat/completions")
                .bearer_auth(&api_key)
                .json(&body)
                .send()
                .await
                .map_err(|e| anyhow::anyhow!("OCR API request failed: {e}"))?;

            if !resp.status().is_success() {
                let status = resp.status().as_u16();
                let text = resp.text().await.unwrap_or_default();
                return Err(anyhow::anyhow!("OCR API returned HTTP {status}: {text}"));
            }

            let json_resp: Value = resp
                .json()
                .await
                .map_err(|e| anyhow::anyhow!("Failed to parse OCR API response: {e}"))?;

            let text = json_resp["choices"][0]["message"]["content"]
                .as_str()
                .unwrap_or("")
                .to_string();

            Ok(json!({ "text": text, "provider": "openai" }))
        }
        other => Err(anyhow::anyhow!(
            "Unknown OCR_PROVIDER '{other}'. Supported values: openai"
        )),
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_ocr_cloud_empty_image_returns_error() {
        std::env::remove_var("OCR_API_KEY");
        let result = ocr_cloud("", None).await;
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("must not be empty"));
    }

    #[tokio::test]
    async fn test_ocr_cloud_no_api_key_returns_stub() {
        std::env::remove_var("OCR_API_KEY");
        let result = ocr_cloud("abc123==", None).await;
        assert!(result.is_ok());
        let val = result.unwrap();
        assert_eq!(val["provider"], "stub");
        assert!(val["text"]
            .as_str()
            .unwrap_or("")
            .starts_with("[stub]"));
    }

    #[tokio::test]
    async fn test_ocr_cloud_unknown_provider_returns_error() {
        std::env::set_var("OCR_API_KEY", "dummy-key");
        std::env::set_var("OCR_PROVIDER", "unsupported_provider");
        let result = ocr_cloud("abc123==", None).await;
        std::env::remove_var("OCR_API_KEY");
        std::env::remove_var("OCR_PROVIDER");
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("Unknown OCR_PROVIDER"));
    }
}
