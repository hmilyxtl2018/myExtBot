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
#[derive(Debug)]
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
    complete_inner(None, user_message).await
}

/// Dispatch to the configured LLM provider with an explicit system prompt.
///
/// Reads `LLM_PROVIDER` from the environment (default: `"openai"`).
/// For OpenAI and Ollama, the system prompt is sent as a `system` role message.
/// For Anthropic, it is sent in the top-level `"system"` field.
pub async fn complete_with_system(system_prompt: &str, user_message: &str) -> Result<LlmResponse> {
    complete_inner(Some(system_prompt), user_message).await
}

async fn complete_inner(system_prompt: Option<&str>, user_message: &str) -> Result<LlmResponse> {
    let provider = std::env::var("LLM_PROVIDER").unwrap_or_else(|_| "openai".into());
    match provider.to_lowercase().as_str() {
        "openai"    => openai_complete(system_prompt, user_message).await,
        "anthropic" => anthropic_complete(system_prompt, user_message).await,
        "ollama"    => ollama_complete(system_prompt, user_message).await,
        other => Err(anyhow!(
            "Unknown LLM provider: {other:?}. \
             Set LLM_PROVIDER=openai|anthropic|ollama in your .env file."
        )),
    }
}

// ── OpenAI ────────────────────────────────────────────────────────────────────

async fn openai_complete(system_prompt: Option<&str>, user_message: &str) -> Result<LlmResponse> {
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
    let mut messages = serde_json::Value::Array(vec![]);
    if let Some(sp) = system_prompt {
        messages.as_array_mut().unwrap().push(json!({"role": "system", "content": sp}));
    }
    messages.as_array_mut().unwrap().push(json!({"role": "user", "content": user_message}));
    let body = json!({
        "model": model,
        "messages": messages,
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

async fn anthropic_complete(system_prompt: Option<&str>, user_message: &str) -> Result<LlmResponse> {
    let api_key = std::env::var("ANTHROPIC_API_KEY")
        .map_err(|_| anyhow!("ANTHROPIC_API_KEY is not set. See .env.example."))?;
    if api_key.is_empty() {
        return Err(anyhow!("ANTHROPIC_API_KEY is empty. See .env.example."));
    }
    let model = std::env::var("ANTHROPIC_MODEL")
        .unwrap_or_else(|_| "claude-3-5-sonnet-20241022".into());

    let start = Instant::now();
    let client = reqwest::Client::new();
    let mut body = json!({
        "model": model,
        "max_tokens": 4096,
        "messages": [{"role": "user", "content": user_message}],
    });
    if let Some(sp) = system_prompt {
        body["system"] = serde_json::Value::String(sp.to_string());
    }

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

async fn ollama_complete(system_prompt: Option<&str>, user_message: &str) -> Result<LlmResponse> {
    let base_url = std::env::var("OLLAMA_BASE_URL")
        .unwrap_or_else(|_| "http://localhost:11434".into());
    let model = std::env::var("OLLAMA_MODEL").unwrap_or_else(|_| "llama3.2".into());

    let start = Instant::now();
    let client = reqwest::Client::new();
    let mut messages = serde_json::Value::Array(vec![]);
    if let Some(sp) = system_prompt {
        messages.as_array_mut().unwrap().push(json!({"role": "system", "content": sp}));
    }
    messages.as_array_mut().unwrap().push(json!({"role": "user", "content": user_message}));
    let body = json!({
        "model": model,
        "messages": messages,
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

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    // These tests verify env-var guard behaviour without making real network
    // calls. They manipulate environment variables, so they must run
    // sequentially (serial) or with isolated env state. We use std::env::set_var
    // in a controlled way: each test clears only the vars it touches.

    use super::*;

    /// Run an async closure on a single-threaded Tokio runtime so we can call
    /// `complete()` (which is async) from synchronous test functions.
    fn run<F: std::future::Future>(f: F) -> F::Output {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(f)
    }

    /// Serialize all env-var–mutating tests so they don't race each other.
    fn env_lock() -> std::sync::MutexGuard<'static, ()> {
        static LOCK: std::sync::OnceLock<std::sync::Mutex<()>> = std::sync::OnceLock::new();
        LOCK.get_or_init(|| std::sync::Mutex::new(())).lock().unwrap()
    }

    #[test]
    fn test_unknown_provider_returns_error() {
        let _g = env_lock();
        std::env::set_var("LLM_PROVIDER", "foobar");
        let result = run(complete("hello"));
        std::env::remove_var("LLM_PROVIDER");
        assert!(result.is_err());
        let msg = result.unwrap_err().to_string();
        assert!(msg.contains("foobar"), "error should name the bad provider");
    }

    #[test]
    fn test_openai_missing_key_returns_error() {
        let _g = env_lock();
        std::env::set_var("LLM_PROVIDER", "openai");
        std::env::remove_var("OPENAI_API_KEY");
        let result = run(complete("hello"));
        std::env::remove_var("LLM_PROVIDER");
        assert!(result.is_err());
        let msg = result.unwrap_err().to_string();
        assert!(
            msg.to_lowercase().contains("openai_api_key"),
            "error should mention the missing env var, got: {msg}"
        );
    }

    #[test]
    fn test_openai_empty_key_returns_error() {
        let _g = env_lock();
        std::env::set_var("LLM_PROVIDER", "openai");
        std::env::set_var("OPENAI_API_KEY", "");
        let result = run(complete("hello"));
        std::env::remove_var("LLM_PROVIDER");
        std::env::remove_var("OPENAI_API_KEY");
        assert!(result.is_err());
        let msg = result.unwrap_err().to_string();
        assert!(
            msg.to_lowercase().contains("empty"),
            "error should mention empty key, got: {msg}"
        );
    }

    #[test]
    fn test_anthropic_missing_key_returns_error() {
        let _g = env_lock();
        std::env::set_var("LLM_PROVIDER", "anthropic");
        std::env::remove_var("ANTHROPIC_API_KEY");
        let result = run(complete("hello"));
        std::env::remove_var("LLM_PROVIDER");
        assert!(result.is_err());
        let msg = result.unwrap_err().to_string();
        assert!(
            msg.to_lowercase().contains("anthropic_api_key"),
            "error should mention the missing env var, got: {msg}"
        );
    }

    #[test]
    fn test_anthropic_empty_key_returns_error() {
        let _g = env_lock();
        std::env::set_var("LLM_PROVIDER", "anthropic");
        std::env::set_var("ANTHROPIC_API_KEY", "");
        let result = run(complete("hello"));
        std::env::remove_var("LLM_PROVIDER");
        std::env::remove_var("ANTHROPIC_API_KEY");
        assert!(result.is_err());
        let msg = result.unwrap_err().to_string();
        assert!(
            msg.to_lowercase().contains("empty"),
            "error should mention empty key, got: {msg}"
        );
    }

    #[test]
    fn test_ollama_unreachable_server_returns_error() {
        let _g = env_lock();
        std::env::set_var("LLM_PROVIDER", "ollama");
        // Point to an address that should refuse connections immediately.
        std::env::set_var("OLLAMA_BASE_URL", "http://127.0.0.1:19999");
        std::env::set_var("OLLAMA_MODEL", "llama3.2");
        let result = run(complete("hello"));
        std::env::remove_var("LLM_PROVIDER");
        std::env::remove_var("OLLAMA_BASE_URL");
        std::env::remove_var("OLLAMA_MODEL");
        assert!(result.is_err(), "Ollama should fail when server is unreachable");
        let msg = result.unwrap_err().to_string();
        assert!(
            msg.to_lowercase().contains("ollama"),
            "error should mention Ollama, got: {msg}"
        );
    }

    #[test]
    fn test_ollama_uses_default_model_when_env_not_set() {
        let _g = env_lock();
        std::env::set_var("LLM_PROVIDER", "ollama");
        std::env::remove_var("OLLAMA_MODEL");
        // Point to an unreachable server so the call fails fast without a real model check.
        std::env::set_var("OLLAMA_BASE_URL", "http://127.0.0.1:19999");
        let result = run(complete("ping"));
        std::env::remove_var("LLM_PROVIDER");
        std::env::remove_var("OLLAMA_BASE_URL");
        // The call must fail (no server), but it must not panic with an env-var error.
        assert!(result.is_err());
    }

    // ── complete_with_system ──────────────────────────────────────────────────

    #[test]
    fn test_complete_with_system_unknown_provider_returns_error() {
        let _g = env_lock();
        std::env::set_var("LLM_PROVIDER", "badprovider");
        let result = run(complete_with_system("system", "hello"));
        std::env::remove_var("LLM_PROVIDER");
        assert!(result.is_err());
        let msg = result.unwrap_err().to_string();
        assert!(msg.contains("badprovider"), "error should name the bad provider");
    }

    #[test]
    fn test_complete_with_system_openai_missing_key_returns_error() {
        let _g = env_lock();
        std::env::set_var("LLM_PROVIDER", "openai");
        std::env::remove_var("OPENAI_API_KEY");
        let result = run(complete_with_system("You are helpful.", "hello"));
        std::env::remove_var("LLM_PROVIDER");
        assert!(result.is_err());
        let msg = result.unwrap_err().to_string();
        assert!(
            msg.to_lowercase().contains("openai_api_key"),
            "error should mention the missing env var, got: {msg}"
        );
    }

    #[test]
    fn test_complete_with_system_anthropic_missing_key_returns_error() {
        let _g = env_lock();
        std::env::set_var("LLM_PROVIDER", "anthropic");
        std::env::remove_var("ANTHROPIC_API_KEY");
        let result = run(complete_with_system("You are helpful.", "hello"));
        std::env::remove_var("LLM_PROVIDER");
        assert!(result.is_err());
        let msg = result.unwrap_err().to_string();
        assert!(
            msg.to_lowercase().contains("anthropic_api_key"),
            "error should mention the missing env var, got: {msg}"
        );
    }

    #[test]
    fn test_complete_with_system_ollama_unreachable_returns_error() {
        let _g = env_lock();
        std::env::set_var("LLM_PROVIDER", "ollama");
        std::env::set_var("OLLAMA_BASE_URL", "http://127.0.0.1:19999");
        let result = run(complete_with_system("You are helpful.", "hello"));
        std::env::remove_var("LLM_PROVIDER");
        std::env::remove_var("OLLAMA_BASE_URL");
        assert!(result.is_err(), "Ollama should fail when server is unreachable");
        let msg = result.unwrap_err().to_string();
        assert!(
            msg.to_lowercase().contains("ollama"),
            "error should mention Ollama, got: {msg}"
        );
    }
}
