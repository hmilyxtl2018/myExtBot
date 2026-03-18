//! OpenAI-compatible LLM client.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use zeroize::{Zeroize, ZeroizeOnDrop};

use crate::tools::ToolRegistry;

/// LLM client configuration.
#[derive(Clone)]
pub struct LlmConfig {
    pub base_url: String,
    pub model: String,
    pub max_tokens: u32,
    /// API key — stored zeroized.
    pub api_key: ApiKey,
}

/// API key wrapper that zeroizes memory on drop.
#[derive(Clone, Zeroize, ZeroizeOnDrop)]
pub struct ApiKey(pub String);

impl ApiKey {
    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

/// An OpenAI-style chat message.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCall>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

impl Message {
    pub fn system(content: impl Into<String>) -> Self {
        Message {
            role: "system".into(),
            content: Some(content.into()),
            tool_calls: None,
            tool_call_id: None,
            name: None,
        }
    }

    pub fn user(content: impl Into<String>) -> Self {
        Message {
            role: "user".into(),
            content: Some(content.into()),
            tool_calls: None,
            tool_call_id: None,
            name: None,
        }
    }

    pub fn assistant(content: impl Into<String>) -> Self {
        Message {
            role: "assistant".into(),
            content: Some(content.into()),
            tool_calls: None,
            tool_call_id: None,
            name: None,
        }
    }

    pub fn tool_result(tool_call_id: impl Into<String>, name: impl Into<String>, content: impl Into<String>) -> Self {
        Message {
            role: "tool".into(),
            content: Some(content.into()),
            tool_calls: None,
            tool_call_id: Some(tool_call_id.into()),
            name: Some(name.into()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    #[serde(rename = "type")]
    pub call_type: String,
    pub function: FunctionCall,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionCall {
    pub name: String,
    pub arguments: String,
}

/// Result of an LLM call.
pub enum ThinkResult {
    Reply(String),
    ToolCalls(Vec<ToolCall>),
}

/// Usage information returned by the API.
#[derive(Debug, Clone, Deserialize, Default)]
pub struct Usage {
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
}

/// A completed LLM call including usage and the result.
pub struct LlmResult {
    pub result: ThinkResult,
    pub usage: Usage,
    pub duration_ms: u64,
}

/// Possible errors from an LLM call.
#[derive(Debug)]
pub enum LlmError {
    /// No API key configured.
    NoApiKey,
    /// Network or transport error.
    Network(String),
    /// The API returned a non-2xx status code.
    ApiError { status: u16, body: String },
    /// Failed to parse the API response.
    Parse(String),
}

impl std::fmt::Display for LlmError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LlmError::NoApiKey => write!(f, "MYEXTBOT_LLM_API_KEY is not set"),
            LlmError::Network(e) => write!(f, "Network error: {e}"),
            LlmError::ApiError { status, body } => {
                write!(f, "API error (HTTP {status}): {body}")
            }
            LlmError::Parse(e) => write!(f, "JSON parse error: {e}"),
        }
    }
}

impl std::error::Error for LlmError {}


/// OpenAI-compatible LLM client.
pub struct LlmClient {
    config: LlmConfig,
    http: reqwest::Client,
}

impl LlmClient {
    pub fn new(config: LlmConfig) -> Self {
        let http = reqwest::Client::builder()
            .build()
            .expect("failed to build reqwest client");
        LlmClient { config, http }
    }

    pub fn model(&self) -> &str {
        &self.config.model
    }

    /// Single non-streaming chat completion with optional tool definitions.
    pub async fn chat_completion(
        &self,
        messages: Vec<Message>,
        tools: Option<Vec<Value>>,
    ) -> std::result::Result<LlmResult, LlmError> {
        if self.config.api_key.is_empty() {
            return Err(LlmError::NoApiKey);
        }

        let start = std::time::Instant::now();

        let mut body = json!({
            "model": self.config.model,
            "messages": messages,
            "max_tokens": self.config.max_tokens,
        });

        if let Some(t) = tools {
            if !t.is_empty() {
                body["tools"] = json!(t);
                body["tool_choice"] = json!("auto");
            }
        }

        let response = self
            .http
            .post(format!("{}/chat/completions", self.config.base_url))
            .bearer_auth(self.config.api_key.as_str())
            .json(&body)
            .send()
            .await
            .map_err(|e| LlmError::Network(e.to_string()))?;

        let status = response.status().as_u16();
        if status < 200 || status >= 300 {
            let body_text = response
                .text()
                .await
                .unwrap_or_else(|_| "<unreadable>".into());
            return Err(LlmError::ApiError {
                status,
                body: body_text,
            });
        }

        let resp_json: Value = response
            .json()
            .await
            .map_err(|e| LlmError::Parse(e.to_string()))?;

        let duration_ms = start.elapsed().as_millis() as u64;

        let usage = parse_usage(&resp_json);

        let choice = resp_json["choices"]
            .get(0)
            .ok_or_else(|| LlmError::Parse("no choices in response".into()))?;

        let message = &choice["message"];

        // Check for tool calls
        if let Some(tc_arr) = message["tool_calls"].as_array() {
            if !tc_arr.is_empty() {
                let tool_calls: Vec<ToolCall> =
                    serde_json::from_value(json!(tc_arr))
                        .map_err(|e| LlmError::Parse(e.to_string()))?;
                return Ok(LlmResult {
                    result: ThinkResult::ToolCalls(tool_calls),
                    usage,
                    duration_ms,
                });
            }
        }

        // Plain text reply
        let content = message["content"]
            .as_str()
            .unwrap_or("")
            .to_string();

        Ok(LlmResult {
            result: ThinkResult::Reply(content),
            usage,
            duration_ms,
        })
    }
}

fn parse_usage(resp: &Value) -> Usage {
    let prompt_tokens = resp["usage"]["prompt_tokens"]
        .as_u64()
        .unwrap_or(0) as u32;
    let completion_tokens = resp["usage"]["completion_tokens"]
        .as_u64()
        .unwrap_or(0) as u32;
    Usage {
        prompt_tokens,
        completion_tokens,
    }
}

/// Convert a ToolRegistry into the OpenAI function-calling schema format.
pub fn tools_schema(registry: &ToolRegistry) -> Vec<Value> {
    registry
        .list_names()
        .into_iter()
        .filter_map(|name| registry.get(name))
        .map(|def| {
            json!({
                "type": "function",
                "function": {
                    "name": def.name,
                    "description": def.description,
                    "parameters": def.params_schema
                }
            })
        })
        .collect()
}

/// Build an `LlmClient` from environment variables and defaults.
pub fn client_from_env() -> LlmClient {
    let api_key = std::env::var("MYEXTBOT_LLM_API_KEY").unwrap_or_default();
    LlmClient::new(LlmConfig {
        base_url: std::env::var("MYEXTBOT_LLM_BASE_URL")
            .unwrap_or_else(|_| "https://api.openai.com/v1".into()),
        api_key: ApiKey(api_key),
        model: std::env::var("MYEXTBOT_LLM_MODEL")
            .unwrap_or_else(|_| "gpt-4o".into()),
        max_tokens: 4096,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tools_schema_non_empty() {
        let registry = crate::tools::ToolRegistry::new();
        let schema = tools_schema(&registry);
        assert!(!schema.is_empty());
        // Each entry should have type = "function"
        for s in &schema {
            assert_eq!(s["type"].as_str(), Some("function"));
            assert!(s["function"]["name"].is_string());
        }
    }

    #[test]
    fn test_api_key_zeroize() {
        let key = ApiKey("test-key".into());
        assert!(!key.is_empty());
        drop(key);
        // After drop, memory should be zeroized (tested by compilation only here)
    }
}
