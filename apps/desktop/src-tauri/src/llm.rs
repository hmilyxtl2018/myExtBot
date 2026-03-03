//! LLM provider integration.
//!
//! Reads configuration from environment variables (loaded from `.env` by
//! `dotenvy` at startup in `lib.rs`):
//!
//! | Variable           | Default                         | Description                                     |
//! |--------------------|---------------------------------|-------------------------------------------------|
//! | `LLM_PROVIDER`     | `openai`                        | `openai` \| `anthropic` \| `ollama`             |
//! | `OPENAI_API_KEY`   | —                               | OpenAI secret key (or compatible proxy key)     |
//! | `OPENAI_BASE_URL`  | `https://api.openai.com`        | Override to use an OpenAI-compatible proxy      |
//! | `OPENAI_MODEL`     | `gpt-4o`                        | Model name                                      |
//! | `ANTHROPIC_API_KEY`| —                               | Anthropic secret key                            |
//! | `ANTHROPIC_MODEL`  | `claude-3-5-sonnet-20241022`    | Model name                                      |
//! | `OLLAMA_BASE_URL`  | `http://localhost:11434`        | Ollama server base URL                          |
//! | `OLLAMA_MODEL`     | `llama3.2`                      | Model pulled in Ollama                          |

use anyhow::{anyhow, Result};
use serde_json::json;
use std::time::Instant;

/// Result of one LLM completion call.
pub struct LlmResponse {
    pub text: String,
    pub model: String,
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    pub duration_ms: u64,
}

/// Dispatch to the configured LLM provider and return the assistant reply.
///
/// Reads `LLM_PROVIDER` from the environment (default: `"openai"`).
pub async fn complete(user_message: &str) -> Result<LlmResponse> {
    let provider = std::env::var("LLM_PROVIDER").unwrap_or_else(|_| "openai".into());
    match provider.to_lowercase().as_str() {
        "openai"    => openai_complete(user_message).await,
        "anthropic" => anthropic_complete(user_message).await,
        "ollama"    => ollama_complete(user_message).await,
        other => Err(anyhow!(
            "Unknown LLM provider: {other:?}. \
             Set LLM_PROVIDER=openai|anthropic|ollama in your .env file."
        )),
    }
}

// ── OpenAI ────────────────────────────────────────────────────────────────────

async fn openai_complete(user_message: &str) -> Result<LlmResponse> {
    let api_key = std::env::var("OPENAI_API_KEY")
        .map_err(|_| anyhow!("OPENAI_API_KEY is not set. See .env.example."))?;
    if api_key.is_empty() {
        return Err(anyhow!("OPENAI_API_KEY is empty. See .env.example."));
    }
    let model = std::env::var("OPENAI_MODEL").unwrap_or_else(|_| "gpt-4o".into());
    let base_url = std::env::var("OPENAI_BASE_URL")
        .unwrap_or_else(|_| "https://api.openai.com".into());
    let endpoint = format!("{}/v1/chat/completions", base_url.trim_end_matches('/'));

    let start = Instant::now();
    let client = reqwest::Client::new();
    let body = json!({
        "model": model,
        "messages": [{"role": "user", "content": user_message}],
    });

    let resp = client
        .post(&endpoint)
        .bearer_auth(&api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| anyhow!("OpenAI request failed: {e}"))?
        .error_for_status()
        .map_err(|e| anyhow!("OpenAI API error: {e}"))?;

    let duration_ms = start.elapsed().as_millis() as u64;
    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| anyhow!("OpenAI response parse error: {e}"))?;

    let text = json["choices"][0]["message"]["content"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| anyhow!("OpenAI returned an empty or malformed response: {json}"))?
        .to_string();
    let prompt_tokens = json["usage"]["prompt_tokens"].as_u64().unwrap_or(0) as u32;
    let completion_tokens = json["usage"]["completion_tokens"].as_u64().unwrap_or(0) as u32;

    Ok(LlmResponse { text, model, prompt_tokens, completion_tokens, duration_ms })
}

// ── Anthropic ─────────────────────────────────────────────────────────────────

async fn anthropic_complete(user_message: &str) -> Result<LlmResponse> {
    let api_key = std::env::var("ANTHROPIC_API_KEY")
        .map_err(|_| anyhow!("ANTHROPIC_API_KEY is not set. See .env.example."))?;
    if api_key.is_empty() {
        return Err(anyhow!("ANTHROPIC_API_KEY is empty. See .env.example."));
    }
    let model = std::env::var("ANTHROPIC_MODEL")
        .unwrap_or_else(|_| "claude-3-5-sonnet-20241022".into());

    let start = Instant::now();
    let client = reqwest::Client::new();
    let body = json!({
        "model": model,
        "max_tokens": 4096,
        "messages": [{"role": "user", "content": user_message}],
    });

    let resp = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", &api_key)
        .header("anthropic-version", "2023-06-01")
        .json(&body)
        .send()
        .await
        .map_err(|e| anyhow!("Anthropic request failed: {e}"))?
        .error_for_status()
        .map_err(|e| anyhow!("Anthropic API error: {e}"))?;

    let duration_ms = start.elapsed().as_millis() as u64;
    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| anyhow!("Anthropic response parse error: {e}"))?;

    let text = json["content"][0]["text"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| anyhow!("Anthropic returned an empty or malformed response: {json}"))?
        .to_string();
    let prompt_tokens = json["usage"]["input_tokens"].as_u64().unwrap_or(0) as u32;
    let completion_tokens = json["usage"]["output_tokens"].as_u64().unwrap_or(0) as u32;

    Ok(LlmResponse { text, model, prompt_tokens, completion_tokens, duration_ms })
}

// ── Ollama ────────────────────────────────────────────────────────────────────

async fn ollama_complete(user_message: &str) -> Result<LlmResponse> {
    let base_url = std::env::var("OLLAMA_BASE_URL")
        .unwrap_or_else(|_| "http://localhost:11434".into());
    let model = std::env::var("OLLAMA_MODEL").unwrap_or_else(|_| "llama3.2".into());

    let start = Instant::now();
    let client = reqwest::Client::new();
    let body = json!({
        "model": model,
        "messages": [{"role": "user", "content": user_message}],
        "stream": false,
    });

    let resp = client
        .post(format!("{base_url}/api/chat"))
        .json(&body)
        .send()
        .await
        .map_err(|e| anyhow!("Ollama request failed: {e}. Is `ollama serve` running?"))?
        .error_for_status()
        .map_err(|e| anyhow!("Ollama API error: {e}"))?;

    let duration_ms = start.elapsed().as_millis() as u64;
    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| anyhow!("Ollama response parse error: {e}"))?;

    let text = json["message"]["content"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| anyhow!("Ollama returned an empty or malformed response: {json}"))?
        .to_string();
    let prompt_tokens = json["prompt_eval_count"].as_u64().unwrap_or(0) as u32;
    let completion_tokens = json["eval_count"].as_u64().unwrap_or(0) as u32;

    Ok(LlmResponse { text, model, prompt_tokens, completion_tokens, duration_ms })
}
