//! Agent routing layer: maps a task description to the best-matching agent.
//!
//! [`AgentRouter`] tries the TS Core REST endpoint first via [`TsBridge`].
//! When the server is unreachable it falls back to a local keyword-matching
//! algorithm that scores cached [`AgentSpec`] entries by their declared
//! `intents` and `domains`.
//!
//! # Scoring (local fallback)
//!
//! Each word in the task description (lowercased) is tested against each
//! agent's `intents` (+3 per match) and `domains` (+2 per match).  The agent
//! with the highest non-zero score is returned.

use crate::agent_spec::{AgentRouteSuggestion, AgentSpec};
use crate::ts_bridge::TsBridge;
use tracing::warn;

/// Routes task descriptions to the best-matching registered agent.
pub struct AgentRouter {
    bridge: Option<TsBridge>,
    /// In-memory cache of known agents, updated by [`AgentRouter::refresh_cache`].
    cache: Vec<AgentSpec>,
}

impl AgentRouter {
    /// Create a new router.
    ///
    /// `base_url` is passed through to [`TsBridge::new`]; pass `None` to use
    /// the `TS_CORE_URL` environment variable or the default `localhost:3000`.
    pub fn new(base_url: Option<String>) -> Self {
        AgentRouter {
            bridge: Some(TsBridge::new(base_url)),
            cache: Vec::new(),
        }
    }

    /// Seed the local cache directly (useful in tests).
    pub fn seed_cache(&mut self, agents: Vec<AgentSpec>) {
        self.cache = agents;
    }

    /// Refresh the local cache from the TS Core server.
    ///
    /// On network failure the existing cache is kept unchanged and a warning is
    /// logged.
    pub async fn refresh_cache(&mut self) {
        if let Some(ref bridge) = self.bridge {
            match bridge.list_agents().await {
                Ok(agents) => {
                    self.cache = agents;
                }
                Err(e) => {
                    warn!("AgentRouter: could not refresh cache from TS Core: {e}");
                }
            }
        }
    }

    /// Return the single best-matching agent for `task`.
    ///
    /// Tries the TS Core `/api/agents/route/best` endpoint first.  Falls back
    /// to [`Self::local_score`] when the server is unreachable or returns no
    /// result.
    pub async fn route_best(&self, task: &str) -> Option<AgentRouteSuggestion> {
        if let Some(ref bridge) = self.bridge {
            match bridge.route_best(task).await {
                Ok(Some(suggestion)) => return Some(suggestion),
                Ok(None) => {
                    // Server responded but found no match — still try local.
                }
                Err(e) => {
                    warn!("AgentRouter: TS Core route_best failed ({e}), using local fallback");
                }
            }
        }
        self.local_score(task)
    }

    /// Return the top `n` routing suggestions for `task`.
    ///
    /// Tries the TS Core `/api/agents/route` endpoint first.  Falls back to
    /// running [`Self::local_score`] (which returns at most one suggestion) when
    /// the server is unavailable.
    pub async fn route_top_n(&self, task: &str, n: usize) -> Vec<AgentRouteSuggestion> {
        if let Some(ref bridge) = self.bridge {
            match bridge.route_query(task, Some(n)).await {
                Ok(suggestions) if !suggestions.is_empty() => return suggestions,
                Ok(_) => {
                    // Empty result from server — fall through to local.
                }
                Err(e) => {
                    warn!("AgentRouter: TS Core route_query failed ({e}), using local fallback");
                }
            }
        }
        self.local_score(task).into_iter().collect()
    }

    /// Score all cached agents against `task` using keyword matching.
    ///
    /// Tokenizes `task` by splitting on non-alphanumeric characters and
    /// comparing lowercased tokens against each agent's `intents` (+3 per
    /// intent token match) and `domains` (+2 per domain name token match).
    ///
    /// Returns `None` when the cache is empty or no agent scores above zero.
    pub fn local_score(&self, task: &str) -> Option<AgentRouteSuggestion> {
        if self.cache.is_empty() {
            return None;
        }

        // Tokenise the task: split on anything that is not alphanumeric.
        let tokens: Vec<String> = task
            .split(|c: char| !c.is_alphanumeric())
            .filter(|t| !t.is_empty())
            .map(|t| t.to_lowercase())
            .collect();

        let mut best_score: i64 = 0;
        let mut best_agent: Option<&AgentSpec> = None;
        let mut best_intents: Vec<String> = Vec::new();
        let mut best_domains: Vec<String> = Vec::new();

        for agent in &self.cache {
            let mut score: i64 = 0;
            let mut matched_intents: Vec<String> = Vec::new();
            let mut matched_domains: Vec<String> = Vec::new();

            // Score intents: +3 for each intent word that appears as an exact token in the task.
            if let Some(ref intents) = agent.intents {
                for intent in intents {
                    let intent_lc = intent.to_lowercase();
                    if tokens.iter().any(|t| t == &intent_lc) {
                        score += 3;
                        matched_intents.push(intent.clone());
                    }
                }
            }

            // Score domains: +2 for each domain name that appears as an exact token in the task.
            if let Some(ref domains) = agent.domains {
                for domain in domains {
                    let domain_lc = domain.name.to_lowercase();
                    if tokens.iter().any(|t| t == &domain_lc) {
                        score += 2;
                        matched_domains.push(domain.name.clone());
                    }
                }
            }

            if score > best_score {
                best_score = score;
                best_agent = Some(agent);
                best_intents = matched_intents;
                best_domains = matched_domains;
            }
        }

        let agent = best_agent?;
        if best_score == 0 {
            return None;
        }

        Some(AgentRouteSuggestion {
            agent_id:        agent.id.clone(),
            agent_name:      agent.name.clone(),
            score:           best_score,
            matched_intents: best_intents,
            matched_domains: best_domains,
            reasoning:       format!(
                "Local match: score={best_score} for agent '{}'",
                agent.name
            ),
        })
    }
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
            enabled: None,
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
                Some(intents.into_iter().map(|s| s.to_string()).collect())
            },
            languages: None,
            response_style: None,
            domains: if domains.is_empty() {
                None
            } else {
                Some(
                    domains
                        .into_iter()
                        .map(|d| AgentSpecDomain { name: d.to_string(), score: 1.0 })
                        .collect(),
                )
            },
            communication: None,
            orchestration: None,
            memory: None,
        }
    }

    // ── local_score ───────────────────────────────────────────────────────────

    #[test]
    fn test_local_score_no_agents_returns_none() {
        let router = AgentRouter::new(None);
        assert!(router.local_score("search the web").is_none());
    }

    #[test]
    fn test_local_score_no_matching_intents_or_domains_returns_none() {
        let mut router = AgentRouter::new(None);
        router.seed_cache(vec![make_agent(
            "bot-1", "DataBot",
            vec!["analyze", "statistics"],
            vec!["finance"],
        )]);
        // Task has none of the above keywords.
        let result = router.local_score("cook a meal and write poetry");
        assert!(result.is_none());
    }

    #[test]
    fn test_local_score_matches_intent() {
        let mut router = AgentRouter::new(None);
        router.seed_cache(vec![make_agent(
            "bot-1", "ResearchBot",
            vec!["research", "search"],
            vec![],
        )]);
        let result = router.local_score("search for recent papers on AI").unwrap();
        assert_eq!(result.agent_id, "bot-1");
        assert_eq!(result.agent_name, "ResearchBot");
        assert!(result.score >= 3, "should score ≥3 for intent match");
        assert!(!result.matched_intents.is_empty());
    }

    #[test]
    fn test_local_score_matches_domain() {
        let mut router = AgentRouter::new(None);
        router.seed_cache(vec![make_agent(
            "bot-2", "FinanceBot",
            vec![],
            vec!["finance", "stock"],
        )]);
        let result = router.local_score("get the latest finance news").unwrap();
        assert_eq!(result.agent_id, "bot-2");
        assert!(result.score >= 2, "should score ≥2 for domain match");
        assert!(!result.matched_domains.is_empty());
    }

    #[test]
    fn test_local_score_selects_highest_score() {
        let mut router = AgentRouter::new(None);
        router.seed_cache(vec![
            make_agent("bot-low",  "LowBot",  vec!["unrelated"], vec![]),
            make_agent("bot-high", "HighBot", vec!["search", "web"], vec!["internet"]),
        ]);
        let result = router.local_score("search the web for internet articles").unwrap();
        assert_eq!(result.agent_id, "bot-high");
    }

    #[test]
    fn test_local_score_intent_worth_three_domain_worth_two() {
        let mut router = AgentRouter::new(None);
        // agent-a only has a domain match (+2)
        // agent-b only has an intent match (+3)
        router.seed_cache(vec![
            make_agent("agent-a", "A", vec![], vec!["web"]),
            make_agent("agent-b", "B", vec!["web"], vec![]),
        ]);
        let result = router.local_score("web scraping task").unwrap();
        // agent-b scores 3 (intent), agent-a scores 2 (domain)
        assert_eq!(result.agent_id, "agent-b");
        assert_eq!(result.score, 3);
    }

    #[test]
    fn test_local_score_combined_intent_and_domain() {
        let mut router = AgentRouter::new(None);
        router.seed_cache(vec![make_agent(
            "bot-x", "SuperBot",
            vec!["search", "fetch"],
            vec!["web", "internet"],
        )]);
        // Matches two intents (+6) and two domains (+4) = total 10
        let result = router.local_score("search and fetch web internet content").unwrap();
        assert_eq!(result.agent_id, "bot-x");
        assert!(result.score >= 6);
    }

    #[test]
    fn test_local_score_reasoning_contains_agent_name() {
        let mut router = AgentRouter::new(None);
        router.seed_cache(vec![make_agent("id", "MyAgent", vec!["test"], vec![])]);
        let result = router.local_score("run a test").unwrap();
        assert!(result.reasoning.contains("MyAgent"));
    }

    // ── AgentRouter construction ──────────────────────────────────────────────

    #[test]
    fn test_new_router_has_empty_cache() {
        let router = AgentRouter::new(None);
        assert!(router.cache.is_empty());
    }

    #[test]
    fn test_seed_cache_replaces_cache() {
        let mut router = AgentRouter::new(None);
        let spec = make_agent("x", "X", vec![], vec![]);
        router.seed_cache(vec![spec]);
        assert_eq!(router.cache.len(), 1);
    }

    // ── route_best (local fallback path) ─────────────────────────────────────

    #[tokio::test]
    async fn test_route_best_falls_back_to_local_when_no_bridge() {
        // Build a router without a bridge by seeding cache after construction.
        // Since TsBridge::new points at localhost:3000 which is not running, it
        // will fail and fall back to local_score.
        let mut router = AgentRouter::new(None);
        router.seed_cache(vec![make_agent("id", "Bot", vec!["task"], vec![])]);
        let result = router.route_best("do a task here").await;
        // We expect a local result because the server is not running.
        assert!(result.is_some());
        assert_eq!(result.unwrap().agent_id, "id");
    }

    #[tokio::test]
    async fn test_route_best_returns_none_when_no_match_and_bridge_down() {
        let router = AgentRouter::new(None); // empty cache, server down
        let result = router.route_best("some completely unknown task abc123").await;
        assert!(result.is_none());
    }

    // ── route_top_n (local fallback path) ─────────────────────────────────────

    #[tokio::test]
    async fn test_route_top_n_returns_local_result_when_bridge_down() {
        let mut router = AgentRouter::new(None);
        router.seed_cache(vec![make_agent("id", "Bot", vec!["analyze"], vec![])]);
        let results = router.route_top_n("analyze the data", 3).await;
        assert!(!results.is_empty());
        assert_eq!(results[0].agent_id, "id");
    }

    #[tokio::test]
    async fn test_route_top_n_returns_empty_when_no_match_and_bridge_down() {
        let router = AgentRouter::new(None); // empty cache
        let results = router.route_top_n("unknown xyz abc task 99999", 3).await;
        assert!(results.is_empty());
    }
}
