//! Agent routing layer: selects the best agent for a given task description.
//!
//! [`AgentRouter`] first tries to ask the TS Core server via [`TsBridge`].
//! If the server is unavailable (or returns an error) the router falls back to
//! a local keyword-matching algorithm that scores agents cached from the last
//! successful [`AgentRouter::refresh_cache`] call.
//!
//! # Scoring (local fallback)
//!
//! Each candidate agent is scored against lowercase tokens in the query:
//!
//! | Match type | Points |
//! |------------|--------|
//! | Intent tag | +3 per match |
//! | Domain name | +2 per match |
//!
//! The highest-scoring agent is returned; ties go to the first agent in cache
//! order.  If no agent scores > 0, `None` is returned.

use crate::agent_spec::{AgentRouteSuggestion, AgentSpec};
use crate::ts_bridge::TsBridge;

/// Wraps [`TsBridge`] for online routing with a local keyword-matching fallback.
pub struct AgentRouter {
    bridge: TsBridge,
    cached_agents: Vec<AgentSpec>,
}

impl AgentRouter {
    /// Create a new router backed by `bridge`.
    ///
    /// The local cache starts empty; call [`Self::refresh_cache`] to populate
    /// it before relying on the local fallback.
    pub fn new(bridge: TsBridge) -> Self {
        AgentRouter {
            bridge,
            cached_agents: Vec::new(),
        }
    }

    /// Return the best matching agent for `task_description`.
    ///
    /// Tries [`TsBridge::route_best`] first; on any error (or when the server
    /// returns `None`) falls back to [`Self::local_score`].
    pub async fn route_best(&self, task_description: &str) -> Option<AgentRouteSuggestion> {
        match self.bridge.route_best(task_description).await {
            Ok(Some(suggestion)) => Some(suggestion),
            Ok(None) => self.local_score(task_description),
            Err(e) => {
                tracing::debug!(
                    "AgentRouter: online route_best failed ({e}), using local fallback"
                );
                self.local_score(task_description)
            }
        }
    }

    /// Return up to `n` matching agents for `task_description`.
    ///
    /// Delegates directly to [`TsBridge::route_query`]; returns an empty vec
    /// on any error.
    pub async fn route_top_n(
        &self,
        task_description: &str,
        n: usize,
    ) -> Vec<AgentRouteSuggestion> {
        self.bridge
            .route_query(task_description, Some(n))
            .await
            .unwrap_or_default()
    }

    /// Score agents in the local cache against `task_description`.
    ///
    /// Tokenises `task_description` into lowercase words and awards:
    /// * **+3** for each matched intent tag.
    /// * **+2** for each matched domain name.
    ///
    /// Returns the highest-scoring agent, or `None` when the cache is empty or
    /// no agent scores > 0.
    pub fn local_score(&self, task_description: &str) -> Option<AgentRouteSuggestion> {
        if self.cached_agents.is_empty() {
            return None;
        }

        // Tokenise the description into lowercase words.
        let lower_words: Vec<String> = task_description
            .split(|c: char| !c.is_alphanumeric())
            .filter(|w| !w.is_empty())
            .map(|w| w.to_lowercase())
            .collect();

        let mut best_score: i64 = 0;
        let mut best: Option<AgentRouteSuggestion> = None;

        for agent in &self.cached_agents {
            let mut score: i64 = 0;
            let mut matched_intents: Vec<String> = Vec::new();
            let mut matched_domains: Vec<String> = Vec::new();

            // Score intents (+3 per match).
            if let Some(intents) = &agent.intents {
                for intent in intents {
                    if lower_words.iter().any(|w| w == &intent.to_lowercase()) {
                        score += 3;
                        matched_intents.push(intent.clone());
                    }
                }
            }

            // Score domains (+2 per match).
            if let Some(domains) = &agent.domains {
                for domain in domains {
                    if lower_words.iter().any(|w| w == &domain.name.to_lowercase()) {
                        score += 2;
                        matched_domains.push(domain.name.clone());
                    }
                }
            }

            if score > best_score {
                best_score = score;
                let reasoning = format!(
                    "local-score: {} (intents: {:?}, domains: {:?})",
                    score, matched_intents, matched_domains
                );
                best = Some(AgentRouteSuggestion {
                    agent_id: agent.id.clone(),
                    agent_name: agent.name.clone(),
                    score,
                    matched_intents,
                    matched_domains,
                    reasoning,
                });
            }
        }

        best
    }

    /// Refresh the local agent cache from the TS Core server.
    ///
    /// On success the cached agents are replaced with the fresh list.
    /// On failure the cache retains its previous contents and a warning is
    /// logged.
    pub async fn refresh_cache(&mut self) {
        match self.bridge.list_agents().await {
            Ok(agents) => {
                self.cached_agents = agents;
            }
            Err(e) => {
                tracing::warn!("AgentRouter: failed to refresh cache: {e}");
            }
        }
    }

    /// Directly populate the local cache (useful for testing).
    #[cfg(test)]
    pub fn set_cached_agents(&mut self, agents: Vec<AgentSpec>) {
        self.cached_agents = agents;
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_spec::{AgentSpec, AgentSpecDomain};

    fn make_bridge() -> TsBridge {
        TsBridge::new(Some("http://127.0.0.1:19999".to_string()))
    }

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
                Some(intents.iter().map(|s| s.to_string()).collect())
            },
            languages: None,
            response_style: None,
            domains: if domains.is_empty() {
                None
            } else {
                Some(
                    domains
                        .iter()
                        .map(|s| AgentSpecDomain {
                            name: s.to_string(),
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

    // ── Construction ──────────────────────────────────────────────────────────

    #[test]
    fn test_agent_router_new_creates_successfully() {
        let router = AgentRouter::new(make_bridge());
        // Local cache is empty after construction.
        assert!(router.local_score("any query").is_none());
    }

    // ── local_score ───────────────────────────────────────────────────────────

    #[test]
    fn test_local_score_matching_intent_scores_3() {
        let mut router = AgentRouter::new(make_bridge());
        router.set_cached_agents(vec![make_agent("a1", "Agent1", vec!["research"], vec![])]);

        let result = router.local_score("research topic");
        let suggestion = result.expect("should match on intent");
        assert_eq!(suggestion.agent_id, "a1");
        assert_eq!(suggestion.score, 3);
        assert_eq!(suggestion.matched_intents, vec!["research"]);
        assert!(suggestion.matched_domains.is_empty());
    }

    #[test]
    fn test_local_score_matching_domain_scores_2() {
        let mut router = AgentRouter::new(make_bridge());
        router.set_cached_agents(vec![make_agent("a2", "Agent2", vec![], vec!["science"])]);

        let result = router.local_score("science experiment");
        let suggestion = result.expect("should match on domain");
        assert_eq!(suggestion.agent_id, "a2");
        assert_eq!(suggestion.score, 2);
        assert!(suggestion.matched_intents.is_empty());
        assert_eq!(suggestion.matched_domains, vec!["science"]);
    }

    #[test]
    fn test_local_score_multiple_matches_accumulate() {
        let mut router = AgentRouter::new(make_bridge());
        router.set_cached_agents(vec![make_agent(
            "a3",
            "Agent3",
            vec!["research", "summarize"],
            vec!["science"],
        )]);

        // "research" → +3, "science" → +2 = total 5
        let suggestion = router.local_score("research science paper").expect("should match");
        assert_eq!(suggestion.score, 5);
        assert!(suggestion.matched_intents.contains(&"research".to_string()));
        assert!(suggestion.matched_domains.contains(&"science".to_string()));
    }

    #[test]
    fn test_local_score_no_matches_returns_none() {
        let mut router = AgentRouter::new(make_bridge());
        router.set_cached_agents(vec![make_agent("a4", "Agent4", vec!["weather"], vec!["geo"])]);

        // Query has no words that match the intents or domains.
        assert!(router.local_score("unrelated task about cooking").is_none());
    }

    #[test]
    fn test_local_score_empty_cache_returns_none() {
        let router = AgentRouter::new(make_bridge());
        // Cache was never populated.
        assert!(router.local_score("research topic").is_none());
    }

    #[test]
    fn test_local_score_returns_highest_scoring_agent() {
        let mut router = AgentRouter::new(make_bridge());
        router.set_cached_agents(vec![
            // Weak match: 1 domain → score 2
            make_agent("a5", "WeakAgent", vec![], vec!["finance"]),
            // Strong match: 1 intent + 1 domain → score 5
            make_agent("a6", "StrongAgent", vec!["research"], vec!["finance"]),
        ]);

        let suggestion = router
            .local_score("research finance report")
            .expect("should find a match");
        assert_eq!(suggestion.agent_id, "a6");
        assert_eq!(suggestion.score, 5);
    }
}
