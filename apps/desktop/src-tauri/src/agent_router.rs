//! AgentRouter — routes task descriptions to the best matching agent.
//!
//! The router first attempts to delegate to the TS Core REST API via
//! [`TsBridge`].  When the TS Core server is unreachable it falls back to a
//! lightweight local scoring algorithm that performs keyword matching on the
//! intents and domain names cached from the last successful `list_agents` call.
//!
//! # Usage
//!
//! Register [`AgentRouter`] as Tauri managed state and inject it into commands
//! that need agent routing:
//!
//! ```ignore
//! let router = AgentRouter::new(TsBridge::new(None));
//! app.manage(router);
//! ```

use crate::agent_spec::{AgentRouteSuggestion, AgentSpec};
use crate::ts_bridge::{TsBridge, TsBridgeError};

// ── RouterError ───────────────────────────────────────────────────────────────

/// Errors returned by [`AgentRouter`] operations.
#[derive(Debug)]
pub enum RouterError {
    /// Wraps an underlying [`TsBridgeError`].
    Bridge(TsBridgeError),
}

impl std::fmt::Display for RouterError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RouterError::Bridge(e) => write!(f, "Router bridge error: {e}"),
        }
    }
}

impl std::error::Error for RouterError {}

impl From<TsBridgeError> for RouterError {
    fn from(e: TsBridgeError) -> Self {
        RouterError::Bridge(e)
    }
}

pub type Result<T> = std::result::Result<T, RouterError>;

// ── AgentRouter ───────────────────────────────────────────────────────────────

/// Routes task descriptions to the best matching registered agent.
///
/// Uses the TS Core REST API as the primary routing mechanism, with a simple
/// keyword-based local fallback when the server is unavailable.
pub struct AgentRouter {
    bridge: TsBridge,
    /// Agents cached for offline fallback scoring.
    cached_agents: Vec<AgentSpec>,
}

impl AgentRouter {
    /// Create a new router backed by the given bridge.
    pub fn new(bridge: TsBridge) -> Self {
        AgentRouter {
            bridge,
            cached_agents: Vec::new(),
        }
    }

    /// Route a task description to the single best matching agent.
    ///
    /// 1. Tries [`TsBridge::route_best`] against the TS Core server.
    /// 2. If the server is unavailable, falls back to [`Self::local_score`].
    /// 3. Returns `Ok(None)` when no agent matches.
    pub async fn route(&self, task_description: &str) -> Result<Option<AgentRouteSuggestion>> {
        match self.bridge.route_best(task_description).await {
            Ok(result) => Ok(result),
            Err(TsBridgeError::ConnectionRefused) | Err(TsBridgeError::Timeout) => {
                // TS Core is offline — use local scoring.
                tracing::debug!(
                    "TS Core unreachable, falling back to local agent scoring \
                     for query: {task_description:?}"
                );
                Ok(self.local_score(task_description))
            }
            Err(e) => Err(RouterError::Bridge(e)),
        }
    }

    /// Route a task description and return the top-`n` matching agents.
    ///
    /// Delegates directly to [`TsBridge::route_query`]; returns an empty list
    /// when the server is unavailable (callers should handle this case).
    pub async fn route_top_n(
        &self,
        task_description: &str,
        n: usize,
    ) -> Result<Vec<AgentRouteSuggestion>> {
        self.bridge
            .route_query(task_description, Some(n))
            .await
            .map_err(RouterError::Bridge)
    }

    /// Refresh the local agent cache from the TS Core server.
    ///
    /// Silently ignores errors so the app keeps working even when the server
    /// is temporarily unavailable.
    pub async fn refresh_cache(&mut self) -> Result<()> {
        if let Ok(agents) = self.bridge.list_agents().await {
            self.cached_agents = agents;
        }
        Ok(())
    }

    /// Score cached agents locally by keyword matching on intents and domains.
    ///
    /// Returns the best-scoring agent as an [`AgentRouteSuggestion`], or `None`
    /// when the cache is empty or no agent scores above zero.
    ///
    /// # Scoring algorithm
    ///
    /// For each cached agent the algorithm:
    /// 1. Splits the query into lowercase words.
    /// 2. Counts how many of the agent's intents appear in the query words.
    /// 3. Counts how many of the agent's domain names appear in the query words.
    /// 4. Uses `intents_matched * 10 + domains_matched * 8` as the raw score.
    ///
    /// The agent with the highest non-zero score wins.
    fn local_score(&self, task_description: &str) -> Option<AgentRouteSuggestion> {
        let query_lower = task_description.to_lowercase();
        let query_words: Vec<&str> = query_lower.split_whitespace().collect();

        let mut best: Option<(i64, AgentRouteSuggestion)> = None;

        for agent in &self.cached_agents {
            let mut matched_intents: std::collections::HashSet<String> =
                std::collections::HashSet::new();
            let mut matched_domains: std::collections::HashSet<String> =
                std::collections::HashSet::new();

            // Match against pillar-6 intent tags.
            if let Some(intents) = &agent.intents {
                for intent in intents {
                    if keyword_matches(intent, &query_words) {
                        matched_intents.insert(intent.clone());
                    }
                }
            }

            // Also check orchestration routing intents/domains (pillar 8).
            if let Some(orch) = &agent.orchestration {
                if let Some(routing) = &orch.routing {
                    if let Some(intents) = &routing.intents {
                        for intent in intents {
                            if keyword_matches(intent, &query_words) {
                                matched_intents.insert(intent.clone());
                            }
                        }
                    }
                    if let Some(domains) = &routing.domains {
                        for domain in domains {
                            if keyword_matches(domain, &query_words) {
                                matched_domains.insert(domain.clone());
                            }
                        }
                    }
                }
            }

            // Match against pillar-6 domain names.
            if let Some(domains) = &agent.domains {
                for domain_entry in domains {
                    if keyword_matches(&domain_entry.name, &query_words) {
                        matched_domains.insert(domain_entry.name.clone());
                    }
                }
            }

            let score =
                (matched_intents.len() as i64) * 10 + (matched_domains.len() as i64) * 8;
            if score == 0 {
                continue;
            }

            let mut intents_vec: Vec<String> = matched_intents.into_iter().collect();
            let mut domains_vec: Vec<String> = matched_domains.into_iter().collect();
            intents_vec.sort();
            domains_vec.sort();

            let reasoning = format!(
                "Local score {score}: matched intents [{intents}] and domains [{domains}]",
                intents = intents_vec.join(", "),
                domains = domains_vec.join(", "),
            );

            let suggestion = AgentRouteSuggestion {
                agent_id:        agent.id.clone(),
                agent_name:      agent.name.clone(),
                score,
                matched_intents: intents_vec,
                matched_domains: domains_vec,
                reasoning,
            };

            match &best {
                None => {
                    best = Some((score, suggestion));
                }
                Some((best_score, _)) if score > *best_score => {
                    best = Some((score, suggestion));
                }
                _ => {}
            }
        }

        best.map(|(_, s)| s)
    }
}

// ── helpers ───────────────────────────────────────────────────────────────────

/// Return `true` when `keyword` (lowercased) has a bidirectional overlap with
/// any word in `query_words`.
///
/// "Bidirectional" means either the keyword contains the query word or the
/// query word contains the keyword, allowing partial token matching.
fn keyword_matches(keyword: &str, query_words: &[&str]) -> bool {
    let lower = keyword.to_lowercase();
    query_words
        .iter()
        .any(|w| lower.contains(*w) || w.contains(lower.as_str()))
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_spec::{AgentSpec, AgentSpecDomain};

    fn make_agent(id: &str, name: &str, intents: Vec<&str>, domains: Vec<&str>) -> AgentSpec {
        AgentSpec {
            id: id.to_string(),
            name: name.to_string(),
            version: None,
            description: None,
            enabled: Some(true),
            scene_id: None,
            allowed_services: None,
            control_loop: None,
            primary_skill: None,
            secondary_skills: None,
            capabilities: None,
            constraints: None,
            tools: None,
            can_delegate_to: None,
            guardrails: None,
            system_prompt: None,
            prompts: None,
            intents: if intents.is_empty() {
                None
            } else {
                Some(intents.into_iter().map(str::to_string).collect())
            },
            languages: None,
            response_style: None,
            domains: if domains.is_empty() {
                None
            } else {
                Some(
                    domains
                        .into_iter()
                        .map(|d| AgentSpecDomain {
                            name:  d.to_string(),
                            score: 1.0,
                        })
                        .collect(),
                )
            },
            communication: None,
            orchestration: None,
            memory: None,
        }
    }

    // ── AgentRouter::new ─────────────────────────────────────────────────────

    #[test]
    fn test_agent_router_new_starts_with_empty_cache() {
        let bridge = TsBridge::new(Some("http://localhost:9999".to_string()));
        let router = AgentRouter::new(bridge);
        assert!(router.cached_agents.is_empty());
    }

    // ── local_score ──────────────────────────────────────────────────────────

    #[test]
    fn test_local_score_returns_none_when_cache_empty() {
        let bridge = TsBridge::new(Some("http://localhost:9999".to_string()));
        let router = AgentRouter::new(bridge);
        assert!(router.local_score("search for papers").is_none());
    }

    #[test]
    fn test_local_score_matches_on_intent_keyword() {
        let bridge = TsBridge::new(Some("http://localhost:9999".to_string()));
        let mut router = AgentRouter::new(bridge);
        router.cached_agents = vec![
            make_agent("search-agent", "Search Agent", vec!["search"], vec![]),
            make_agent("doc-agent", "Doc Agent", vec!["summarize"], vec![]),
        ];

        let result = router.local_score("search for related papers");
        assert!(result.is_some());
        let suggestion = result.unwrap();
        assert_eq!(suggestion.agent_id, "search-agent");
        assert!(suggestion.score > 0);
        assert!(!suggestion.matched_intents.is_empty());
    }

    #[test]
    fn test_local_score_matches_on_domain_keyword() {
        let bridge = TsBridge::new(Some("http://localhost:9999".to_string()));
        let mut router = AgentRouter::new(bridge);
        router.cached_agents = vec![make_agent(
            "doc-agent",
            "Doc Agent",
            vec![],
            vec!["documents"],
        )];

        let result = router.local_score("extract text from documents");
        assert!(result.is_some());
        let suggestion = result.unwrap();
        assert_eq!(suggestion.agent_id, "doc-agent");
        assert!(!suggestion.matched_domains.is_empty());
    }

    #[test]
    fn test_local_score_returns_highest_scoring_agent() {
        let bridge = TsBridge::new(Some("http://localhost:9999".to_string()));
        let mut router = AgentRouter::new(bridge);
        router.cached_agents = vec![
            // Agent A matches one intent
            make_agent("agent-a", "Agent A", vec!["search"], vec![]),
            // Agent B matches two intents → higher score
            make_agent("agent-b", "Agent B", vec!["search", "summarize"], vec![]),
        ];

        let result = router.local_score("search and summarize findings");
        assert!(result.is_some());
        assert_eq!(result.unwrap().agent_id, "agent-b");
    }

    #[test]
    fn test_local_score_returns_none_when_no_match() {
        let bridge = TsBridge::new(Some("http://localhost:9999".to_string()));
        let mut router = AgentRouter::new(bridge);
        router.cached_agents = vec![make_agent(
            "finance-agent",
            "Finance Agent",
            vec!["budget"],
            vec!["finance"],
        )];

        // Query has no words matching "budget" or "finance"
        let result = router.local_score("translate this document to French");
        assert!(result.is_none());
    }

    #[test]
    fn test_local_score_reasoning_contains_score() {
        let bridge = TsBridge::new(Some("http://localhost:9999".to_string()));
        let mut router = AgentRouter::new(bridge);
        router.cached_agents =
            vec![make_agent("search-agent", "Search Agent", vec!["search"], vec![])];

        let result = router.local_score("search for papers");
        let suggestion = result.expect("should match");
        assert!(
            suggestion.reasoning.contains("score"),
            "reasoning should mention score: {}",
            suggestion.reasoning
        );
    }

    // ── route (graceful degradation) ─────────────────────────────────────────

    #[tokio::test]
    async fn test_route_falls_back_to_local_when_connection_refused() {
        // Point the bridge at a port that is guaranteed to be closed.
        let bridge = TsBridge::new(Some("http://127.0.0.1:19999".to_string()));
        let mut router = AgentRouter::new(bridge);
        router.cached_agents = vec![make_agent("fallback-agent", "Fallback Agent", vec!["process"], vec![])];

        // Should not error — falls back to local_score.
        let result = router.route("process this task").await;
        assert!(result.is_ok(), "route should not error on connection refused");
    }

    #[tokio::test]
    async fn test_route_returns_none_when_no_match_and_server_down() {
        let bridge = TsBridge::new(Some("http://127.0.0.1:19999".to_string()));
        let router = AgentRouter::new(bridge); // empty cache

        let result = router.route("some task description").await;
        assert!(result.is_ok());
        assert!(result.unwrap().is_none());
    }
}
