//! HTTP client bridge to the TypeScript Core REST API server.
//!
//! The TS Core server (`npm run server`) exposes a REST API on
//! `http://localhost:3000` (configurable via `TS_CORE_URL`).  This module
//! provides a typed Rust client that forwards agent registration, lookup, and
//! routing requests to that server, allowing the Tauri backend to participate
//! in the full `McpServiceListManager` lifecycle.
//!
//! # Debugging
//!
//! Set `TS_BRIDGE_DEBUG=true` in the environment to emit request/response
//! details at `debug` level via the `tracing` subsystem.

use std::error::Error as StdError;
use std::time::Duration;

use reqwest::StatusCode;

use crate::agent_spec::{AgentRouteSuggestion, AgentSpec};

/// Default base URL of the TS Core REST server.
const DEFAULT_BASE_URL: &str = "http://localhost:3000";
/// Default HTTP request timeout.
const DEFAULT_TIMEOUT_SECS: u64 = 10;
/// Environment variable that overrides the base URL.
const ENV_BASE_URL: &str = "TS_CORE_URL";
/// Environment variable that enables debug logging.
const ENV_DEBUG: &str = "TS_BRIDGE_DEBUG";

// ── Error type ────────────────────────────────────────────────────────────────

/// Errors that can arise when communicating with the TS Core server.
#[derive(Debug)]
pub enum TsBridgeError {
    /// The TCP connection was refused (server not running).
    ConnectionRefused,
    /// The request timed out.
    Timeout,
    /// The server returned an HTTP error status.
    HttpError(StatusCode, String),
    /// A `reqwest` transport error (other than connection refused / timeout).
    Transport(reqwest::Error),
    /// Response body could not be deserialised as expected JSON.
    Parse(String),
}

impl std::fmt::Display for TsBridgeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TsBridgeError::ConnectionRefused => {
                write!(f, "TS Core server is not reachable (connection refused)")
            }
            TsBridgeError::Timeout => write!(f, "Request to TS Core server timed out"),
            TsBridgeError::HttpError(status, body) => {
                write!(f, "TS Core returned HTTP {status}: {body}")
            }
            TsBridgeError::Transport(e) => write!(f, "Transport error: {e}"),
            TsBridgeError::Parse(msg) => write!(f, "Failed to parse TS Core response: {msg}"),
        }
    }
}

impl std::error::Error for TsBridgeError {}

/// Convert a `reqwest::Error` into a `TsBridgeError`, distinguishing between
/// connection refused, timeout, and other transport errors.
fn classify(e: reqwest::Error) -> TsBridgeError {
    if e.is_timeout() {
        return TsBridgeError::Timeout;
    }
    // Connection refused surfaces as a `reqwest::Error` whose source chain
    // contains a `hyper` / `std::io::Error` with `ConnectionRefused`.
    if let Some(source) = e.source() {
        let msg = source.to_string();
        if msg.contains("Connection refused") || msg.contains("connection refused") {
            return TsBridgeError::ConnectionRefused;
        }
    }
    TsBridgeError::Transport(e)
}

pub type Result<T> = std::result::Result<T, TsBridgeError>;

// ── TsBridge ──────────────────────────────────────────────────────────────────

/// HTTP client bridge to the TypeScript Core REST API.
///
/// Holds a `reqwest::Client` with a pre-configured timeout and the resolved
/// base URL.  Intended to be registered as Tauri managed state so commands
/// can share a single client instance.
///
/// `reqwest::Client` is internally reference-counted so cloning is cheap.
#[derive(Clone)]
pub struct TsBridge {
    base_url: String,
    client: reqwest::Client,
    debug: bool,
}

impl TsBridge {
    /// Create a new bridge client.
    ///
    /// `base_url` overrides the default; pass `None` to use `TS_CORE_URL` from
    /// the environment, falling back to `http://localhost:3000`.
    pub fn new(base_url: Option<String>) -> Self {
        let url = base_url
            .or_else(|| std::env::var(ENV_BASE_URL).ok())
            .unwrap_or_else(|| DEFAULT_BASE_URL.to_string());

        let timeout = Duration::from_secs(DEFAULT_TIMEOUT_SECS);
        let client = reqwest::Client::builder()
            .timeout(timeout)
            .build()
            .expect("Failed to build reqwest client for TsBridge");

        let debug = std::env::var(ENV_DEBUG)
            .map(|v| v.eq_ignore_ascii_case("true") || v == "1")
            .unwrap_or(false);

        TsBridge {
            base_url: url.trim_end_matches('/').to_string(),
            client,
            debug,
        }
    }

    // ── internal helpers ──────────────────────────────────────────────────────

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.base_url, path)
    }

    fn log_request(&self, method: &str, url: &str) {
        if self.debug {
            tracing::debug!(method, url, "TsBridge → request");
        }
    }

    fn log_response(&self, status: u16, body: &str) {
        if self.debug {
            tracing::debug!(status, body = %body, "TsBridge ← response");
        }
    }

    // ── public API ────────────────────────────────────────────────────────────

    /// POST the full `AgentSpec` to `/api/agents`, registering it with
    /// `McpServiceListManager`.
    pub async fn register_agent(&self, spec: &AgentSpec) -> Result<()> {
        let url = self.url("/api/agents");
        self.log_request("POST", &url);

        let resp = self
            .client
            .post(&url)
            .json(spec)
            .send()
            .await
            .map_err(classify)?;

        let status = resp.status();
        let body = resp.text().await.map_err(classify)?;
        self.log_response(status.as_u16(), &body);

        if status.is_success() {
            Ok(())
        } else {
            Err(TsBridgeError::HttpError(status, body))
        }
    }

    /// GET `/api/agents/:id` — returns `None` when the server returns 404.
    pub async fn get_agent(&self, id: &str) -> Result<Option<AgentSpec>> {
        let url = self.url(&format!("/api/agents/{id}"));
        self.log_request("GET", &url);

        let resp = self.client.get(&url).send().await.map_err(classify)?;

        let status = resp.status();
        if status == StatusCode::NOT_FOUND {
            return Ok(None);
        }

        let body = resp.text().await.map_err(classify)?;
        self.log_response(status.as_u16(), &body);

        if status.is_success() {
            let spec: AgentSpec =
                serde_json::from_str(&body).map_err(|e| TsBridgeError::Parse(e.to_string()))?;
            Ok(Some(spec))
        } else {
            Err(TsBridgeError::HttpError(status, body))
        }
    }

    /// GET `/api/agents` — list all registered agents.
    pub async fn list_agents(&self) -> Result<Vec<AgentSpec>> {
        let url = self.url("/api/agents");
        self.log_request("GET", &url);

        let resp = self.client.get(&url).send().await.map_err(classify)?;

        let status = resp.status();
        let body = resp.text().await.map_err(classify)?;
        self.log_response(status.as_u16(), &body);

        if status.is_success() {
            let agents: Vec<AgentSpec> =
                serde_json::from_str(&body).map_err(|e| TsBridgeError::Parse(e.to_string()))?;
            Ok(agents)
        } else {
            Err(TsBridgeError::HttpError(status, body))
        }
    }

    /// GET `/api/agents/route?query=…&topN=…` — return up to `top_n` routing
    /// suggestions for the given natural-language query.
    pub async fn route_query(
        &self,
        query: &str,
        top_n: Option<usize>,
    ) -> Result<Vec<AgentRouteSuggestion>> {
        let mut url = self.url(&format!("/api/agents/route?query={}", urlencoding(query)));
        if let Some(n) = top_n {
            url.push_str(&format!("&topN={n}"));
        }
        self.log_request("GET", &url);

        let resp = self.client.get(&url).send().await.map_err(classify)?;

        let status = resp.status();
        let body = resp.text().await.map_err(classify)?;
        self.log_response(status.as_u16(), &body);

        if status.is_success() {
            let suggestions: Vec<AgentRouteSuggestion> =
                serde_json::from_str(&body).map_err(|e| TsBridgeError::Parse(e.to_string()))?;
            Ok(suggestions)
        } else {
            Err(TsBridgeError::HttpError(status, body))
        }
    }

    /// GET `/api/agents/route/best?query=…` — return the single best routing
    /// suggestion, or `None` when no agents match.
    pub async fn route_best(&self, query: &str) -> Result<Option<AgentRouteSuggestion>> {
        let url = self.url(&format!("/api/agents/route/best?query={}", urlencoding(query)));
        self.log_request("GET", &url);

        let resp = self.client.get(&url).send().await.map_err(classify)?;

        let status = resp.status();
        if status == StatusCode::NOT_FOUND {
            return Ok(None);
        }

        let body = resp.text().await.map_err(classify)?;
        self.log_response(status.as_u16(), &body);

        if status.is_success() {
            let suggestion: AgentRouteSuggestion =
                serde_json::from_str(&body).map_err(|e| TsBridgeError::Parse(e.to_string()))?;
            Ok(Some(suggestion))
        } else {
            Err(TsBridgeError::HttpError(status, body))
        }
    }

    /// GET `/api/health` — returns `true` when the server is reachable and
    /// healthy, `false` on connection refused or unexpected errors.
    pub async fn health_check(&self) -> Result<bool> {
        let url = self.url("/api/health");
        self.log_request("GET", &url);

        match self.client.get(&url).send().await {
            Ok(resp) => {
                let status = resp.status();
                self.log_response(status.as_u16(), "");
                Ok(status.is_success())
            }
            Err(e) => {
                let classified = classify(e);
                if matches!(
                    classified,
                    TsBridgeError::ConnectionRefused | TsBridgeError::Timeout
                ) {
                    Ok(false)
                } else {
                    Err(classified)
                }
            }
        }
    }
}

// ── helpers ───────────────────────────────────────────────────────────────────

/// Percent-encode a query-string value (spaces → `%20`, etc.).
///
/// We use only a minimal set of characters that must be encoded in a query
/// parameter value, avoiding a full `url` crate dependency.
fn urlencoding(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            b' ' => out.push_str("%20"),
            other => {
                out.push_str(&format!("%{other:02X}"));
            }
        }
    }
    out
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_urlencoding_plain() {
        assert_eq!(urlencoding("hello"), "hello");
    }

    #[test]
    fn test_urlencoding_space() {
        assert_eq!(urlencoding("hello world"), "hello%20world");
    }

    #[test]
    fn test_urlencoding_special() {
        assert_eq!(urlencoding("a+b=c&d"), "a%2Bb%3Dc%26d");
    }

    #[test]
    fn test_ts_bridge_default_base_url() {
        // Ensure the bridge picks up the default URL when no env var is set.
        std::env::remove_var(ENV_BASE_URL);
        let bridge = TsBridge::new(None);
        assert_eq!(bridge.base_url, "http://localhost:3000");
    }

    #[test]
    fn test_ts_bridge_explicit_base_url() {
        let bridge = TsBridge::new(Some("http://localhost:4000".to_string()));
        assert_eq!(bridge.base_url, "http://localhost:4000");
    }

    #[test]
    fn test_ts_bridge_strips_trailing_slash() {
        let bridge = TsBridge::new(Some("http://localhost:3000/".to_string()));
        assert_eq!(bridge.base_url, "http://localhost:3000");
    }

    #[test]
    fn test_ts_bridge_env_base_url() {
        std::env::set_var(ENV_BASE_URL, "http://custom-host:5000");
        let bridge = TsBridge::new(None);
        assert_eq!(bridge.base_url, "http://custom-host:5000");
        std::env::remove_var(ENV_BASE_URL);
    }

    #[test]
    fn test_agent_route_suggestion_round_trip() {
        let suggestion = AgentRouteSuggestion {
            agent_id: "bot-1".to_string(),
            agent_name: "Bot One".to_string(),
            score: 85,
            matched_intents: vec!["research".to_string()],
            matched_domains: vec!["science".to_string()],
            reasoning: "Best match for research queries".to_string(),
        };
        let json = serde_json::to_string(&suggestion).unwrap();
        let back: AgentRouteSuggestion = serde_json::from_str(&json).unwrap();
        assert_eq!(back, suggestion);
    }

    #[test]
    fn test_agent_route_suggestion_camel_case_keys() {
        let suggestion = AgentRouteSuggestion {
            agent_id: "x".to_string(),
            agent_name: "X".to_string(),
            score: 0,
            matched_intents: vec![],
            matched_domains: vec![],
            reasoning: String::new(),
        };
        let json = serde_json::to_string(&suggestion).unwrap();
        assert!(json.contains("agentId"), "expected camelCase key 'agentId'");
        assert!(json.contains("agentName"), "expected camelCase key 'agentName'");
        assert!(json.contains("matchedIntents"), "expected camelCase key 'matchedIntents'");
        assert!(json.contains("matchedDomains"), "expected camelCase key 'matchedDomains'");
    }
}
