//! Rust-native agent router that selects the best [`AgentSpec`] for a task.
//!
//! # Strategy
//!
//! 1. **Online** — forward the query to the TS Core REST API via
//!    [`TsBridge::route_best`] / [`TsBridge::route_query`].
//! 2. **Offline fallback** — if the TS Core server is unreachable the router
//!    falls back to [`AgentRouter::local_score`], a simple keyword-matching
//!    algorithm that scores each cached agent against the task description.
//!
//! The offline algorithm mirrors the TypeScript `AgentRouter` scoring logic:
//! - +3 per matched intent token (case-insensitive substring)
//! - +2 per matched domain name (case-insensitive substring)
//!
//! Agents with a total score of 0 are not returned.

use crate::agent_spec::{AgentRouteSuggestion, AgentSpec};
use crate::ts_bridge::{TsBridge, TsBridgeError};

/// Selects the best agent for a given task description.
///
/// Tries the TS Core REST API first, falls back to local keyword scoring when
/// the server is unavailable.
pub struct AgentRouter {
    bridge: TsBridge,
    /// Agents cached locally for offline scoring.
    cached_agents: Vec<AgentSpec>,
}

impl AgentRouter {
    /// Create a new router backed by `bridge` with an empty agent cache.
    pub fn new(bridge: TsBridge) -> Self {
        AgentRouter {
            bridge,
            cached_agents: Vec::new(),
        }
    }

    /// Route a task description to the best agent.
    ///
    /// Queries the TS Core REST API first.  On [`TsBridgeError::ConnectionRefused`]
    /// or [`TsBridgeError::Timeout`] the method falls back to [`local_score`].
    pub async fn route_best(&self, task_description: &str) -> Option<AgentRouteSuggestion> {
        match self.bridge.route_best(task_description).await {
            Ok(suggestion) => suggestion,
            Err(e) => {
                // Only fall back when the server is unreachable.
                if matches!(
                    e,
                    TsBridgeError::ConnectionRefused | TsBridgeError::Timeout
                ) {
                    tracing::debug!(
                        "TsBridge unavailable ({}), using local agent scoring",
                        e
                    );
                    self.local_score(task_description)
                } else {
                    tracing::warn!("AgentRouter: TsBridge error: {e}");
                    None
                }
            }
        }
    }

    /// Route with top-N results via TsBridge.
    ///
    /// Falls back to returning the single best local match wrapped in a `Vec`
    /// when the server is unreachable.
    pub async fn route_top_n(
        &self,
        task_description: &str,
        n: usize,
    ) -> Vec<AgentRouteSuggestion> {
        match self.bridge.route_query(task_description, Some(n)).await {
            Ok(suggestions) => suggestions,
            Err(e) => {
                if matches!(
                    e,
                    TsBridgeError::ConnectionRefused | TsBridgeError::Timeout
                ) {
                    tracing::debug!(
                        "TsBridge unavailable ({}), using local agent scoring",
                        e
                    );
                    self.local_score(task_description)
                        .into_iter()
                        .collect()
                } else {
                    tracing::warn!("AgentRouter: TsBridge error: {e}");
                    Vec::new()
                }
            }
        }
    }

    /// Simple local keyword-matching fallback using cached agents.
    ///
    /// Scoring:
    /// - +3 per intent token that appears (as a substring) in the lowercased
    ///   `task_description`
    /// - +2 per domain name that appears (as a substring) in the lowercased
    ///   `task_description`
    ///
    /// Returns the highest-scoring agent, or `None` when all scores are 0 or
    /// the cache is empty.
    pub fn local_score(&self, task_description: &str) -> Option<AgentRouteSuggestion> {
        let haystack = task_description.to_lowercase();

        let mut best: Option<(i64, &AgentSpec, Vec<String>, Vec<String>)> = None;

        for agent in &self.cached_agents {
            let mut score: i64 = 0;
            let mut matched_intents = Vec::new();
            let mut matched_domains = Vec::new();

            // +3 per matched intent
            if let Some(ref intents) = agent.intents {
                for intent in intents {
                    if haystack.contains(&intent.to_lowercase()) {
                        score += 3;
                        matched_intents.push(intent.clone());
                    }
                }
            }

            // +2 per matched domain name
            if let Some(ref domains) = agent.domains {
                for domain in domains {
                    if haystack.contains(&domain.name.to_lowercase()) {
                        score += 2;
                        matched_domains.push(domain.name.clone());
                    }
                }
            }

            if score > 0 {
                let is_better = best
                    .as_ref()
                    .map(|(best_score, _, _, _)| score > *best_score)
                    .unwrap_or(true);
                if is_better {
                    best = Some((score, agent, matched_intents, matched_domains));
                }
            }
        }

        best.map(|(score, agent, matched_intents, matched_domains)| {
            AgentRouteSuggestion {
                agent_id: agent.id.clone(),
                agent_name: agent.name.clone(),
                score,
                matched_intents,
                matched_domains,
                reasoning: format!(
                    "Local keyword match: score={score} for agent '{}'",
                    agent.name
                ),
            }
        })
    }

    /// Refresh the local agent cache by fetching all agents from TS Core.
    ///
    /// On error the existing cache is preserved.
    pub async fn refresh_cache(&mut self) {
        match self.bridge.list_agents().await {
            Ok(agents) => {
                self.cached_agents = agents;
                tracing::debug!(
                    "AgentRouter: refreshed cache with {} agent(s)",
                    self.cached_agents.len()
                );
            }
            Err(e) => {
                tracing::warn!("AgentRouter: could not refresh agent cache: {e}");
            }
        }
    }

    /// Replace the local agent cache (test helper).
    #[cfg(test)]
    pub fn set_cached_agents(&mut self, agents: Vec<AgentSpec>) {
        self.cached_agents = agents;
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_spec::{AgentRouteSuggestion, AgentSpec, AgentSpecDomain};

    /// Build a minimal `AgentSpec` for use in tests.
    fn make_agent(id: &str, name: &str, intents: Vec<&str>, domains: Vec<&str>) -> AgentSpec {
        AgentSpec {
            id: id.into(),
            name: name.into(),
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
                        .map(|d| AgentSpecDomain {
                            name: d.to_string(),
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

    #[test]
    fn test_agent_router_new_creates_successfully() {
        let bridge = TsBridge::new(Some("http://localhost:3000".to_string()));
        let router = AgentRouter::new(bridge);
        // fresh router has an empty local cache
        assert!(router.local_score("any task").is_none());
    }

    // ── local_score ────────────────────────────────────────────────────────────

    #[test]
    fn test_local_score_matching_intent_scores_plus_three() {
        let bridge = TsBridge::new(Some("http://localhost:3000".to_string()));
        let mut router = AgentRouter::new(bridge);
        router.set_cached_agents(vec![make_agent("a1", "Agent1", vec!["research"], vec![])]);

        let result = router.local_score("do some research on topics");
        let suggestion = result.expect("should match");
        assert_eq!(suggestion.agent_id, "a1");
        assert_eq!(suggestion.score, 3);
        assert!(suggestion.matched_intents.contains(&"research".to_string()));
    }

    #[test]
    fn test_local_score_matching_domain_scores_plus_two() {
        let bridge = TsBridge::new(Some("http://localhost:3000".to_string()));
        let mut router = AgentRouter::new(bridge);
        router.set_cached_agents(vec![make_agent("a2", "Agent2", vec![], vec!["finance"])]);

        let result = router.local_score("analyze the finance sector");
        let suggestion = result.expect("should match");
        assert_eq!(suggestion.agent_id, "a2");
        assert_eq!(suggestion.score, 2);
        assert!(suggestion.matched_domains.contains(&"finance".to_string()));
    }

    #[test]
    fn test_local_score_multiple_matches_accumulate() {
        let bridge = TsBridge::new(Some("http://localhost:3000".to_string()));
        let mut router = AgentRouter::new(bridge);
        router.set_cached_agents(vec![make_agent(
            "a3",
            "Agent3",
            vec!["research", "analysis"],
            vec!["science"],
        )]);

        let result = router.local_score("do research and analysis in science");
        let suggestion = result.expect("should match");
        assert_eq!(suggestion.agent_id, "a3");
        // 3 + 3 + 2 = 8
        assert_eq!(suggestion.score, 8);
    }

    #[test]
    fn test_local_score_no_match_returns_none() {
        let bridge = TsBridge::new(Some("http://localhost:3000".to_string()));
        let mut router = AgentRouter::new(bridge);
        router.set_cached_agents(vec![make_agent("a4", "Agent4", vec!["cooking"], vec!["food"])]);

        let result = router.local_score("write a software program");
        assert!(result.is_none(), "should not match unrelated task");
    }

    #[test]
    fn test_local_score_empty_cache_returns_none() {
        let bridge = TsBridge::new(Some("http://localhost:3000".to_string()));
        let router = AgentRouter::new(bridge);

        let result = router.local_score("any task description");
        assert!(result.is_none());
    }

    #[test]
    fn test_local_score_returns_highest_scoring_agent() {
        let bridge = TsBridge::new(Some("http://localhost:3000".to_string()));
        let mut router = AgentRouter::new(bridge);
        router.set_cached_agents(vec![
            make_agent("low", "LowAgent", vec!["research"], vec![]),
            make_agent("high", "HighAgent", vec!["research", "analysis"], vec!["science"]),
        ]);

        let result = router.local_score("research analysis in science");
        let suggestion = result.expect("should match");
        assert_eq!(suggestion.agent_id, "high");
    }

    // ── PlanStep serialization with new routing fields ─────────────────────────

    #[test]
    fn test_plan_step_routing_fields_serialize_when_set() {
        use crate::events::{PlanStep, PlanStepStatus};

        let step = PlanStep {
            id: "step-1".into(),
            index: 0,
            description: "Summarize document".into(),
            status: PlanStepStatus::Pending,
            tool: None,
            params: None,
            result: None,
            assigned_agent_id: Some("agent-42".into()),
            assigned_agent_name: Some("SummaryBot".into()),
            routing_score: Some(85),
            routing_reasoning: Some("Best match for summarization".into()),
        };

        let json = serde_json::to_value(&step).unwrap();
        // PlanStep uses snake_case field names (no rename_all attribute)
        assert_eq!(json["assigned_agent_id"], "agent-42");
        assert_eq!(json["assigned_agent_name"], "SummaryBot");
        assert_eq!(json["routing_score"], 85);
        assert_eq!(json["routing_reasoning"], "Best match for summarization");
    }

    #[test]
    fn test_plan_step_routing_fields_omitted_when_none() {
        use crate::events::{PlanStep, PlanStepStatus};

        let step = PlanStep {
            id: "step-2".into(),
            index: 0,
            description: "Think".into(),
            status: PlanStepStatus::Pending,
            tool: None,
            params: None,
            result: None,
            assigned_agent_id: None,
            assigned_agent_name: None,
            routing_score: None,
            routing_reasoning: None,
        };

        let json = serde_json::to_value(&step).unwrap();
        // New routing fields must be absent when None (skip_serializing_if = "Option::is_none")
        assert!(json.get("assigned_agent_id").is_none());
        assert!(json.get("assigned_agent_name").is_none());
        assert!(json.get("routing_score").is_none());
        assert!(json.get("routing_reasoning").is_none());
    }

    #[test]
    fn test_plan_step_deserializes_without_routing_fields() {
        use crate::events::PlanStep;

        // Old JSON without the new routing fields — should deserialize cleanly.
        let json = serde_json::json!({
            "id": "old-step",
            "index": 0,
            "description": "Legacy step",
            "status": "pending"
        });

        let step: PlanStep = serde_json::from_value(json).unwrap();
        assert_eq!(step.id, "old-step");
        assert!(step.assigned_agent_id.is_none());
        assert!(step.assigned_agent_name.is_none());
        assert!(step.routing_score.is_none());
        assert!(step.routing_reasoning.is_none());
    }

    // ── assign_agents integration test ────────────────────────────────────────

    #[tokio::test]
    async fn test_assign_agents_populates_steps_when_local_match_found() {
        use crate::events::{PlanStep, PlanStepStatus};

        let bridge = TsBridge::new(Some("http://localhost:3000".to_string()));
        let mut router = AgentRouter::new(bridge);
        router.set_cached_agents(vec![make_agent(
            "search-agent",
            "SearchBot",
            vec!["search"],
            vec!["web"],
        )]);

        let mut steps = vec![PlanStep {
            id: "s1".into(),
            index: 0,
            description: "Search the web for papers".into(),
            status: PlanStepStatus::Pending,
            tool: None,
            params: None,
            result: None,
            assigned_agent_id: None,
            assigned_agent_name: None,
            routing_score: None,
            routing_reasoning: None,
        }];

        // The bridge will fail (no server), so local_score is used.
        crate::planner::assign_agents(&mut steps, &router).await;

        // Both "search" (intent) and "web" (domain) match the description.
        assert_eq!(steps[0].assigned_agent_id.as_deref(), Some("search-agent"));
        assert_eq!(steps[0].assigned_agent_name.as_deref(), Some("SearchBot"));
        assert!(steps[0].routing_score.is_some());
    }

    #[tokio::test]
    async fn test_assign_agents_leaves_none_when_no_match() {
        use crate::events::{PlanStep, PlanStepStatus};

        let bridge = TsBridge::new(Some("http://localhost:3000".to_string()));
        let mut router = AgentRouter::new(bridge);
        router.set_cached_agents(vec![make_agent(
            "finance-agent",
            "FinanceBot",
            vec!["accounting"],
            vec!["finance"],
        )]);

        let mut steps = vec![PlanStep {
            id: "s2".into(),
            index: 0,
            description: "Write a poem about the sea".into(),
            status: PlanStepStatus::Pending,
            tool: None,
            params: None,
            result: None,
            assigned_agent_id: None,
            assigned_agent_name: None,
            routing_score: None,
            routing_reasoning: None,
        }];

        crate::planner::assign_agents(&mut steps, &router).await;

        // No match — all routing fields remain None.
        assert!(steps[0].assigned_agent_id.is_none());
        assert!(steps[0].assigned_agent_name.is_none());
        assert!(steps[0].routing_score.is_none());
        assert!(steps[0].routing_reasoning.is_none());
    }

    // ── AgentRouteSuggestion round-trip ───────────────────────────────────────

    #[test]
    fn test_agent_route_suggestion_round_trip_in_router() {
        let suggestion = AgentRouteSuggestion {
            agent_id: "bot-x".to_string(),
            agent_name: "BotX".to_string(),
            score: 42,
            matched_intents: vec!["summarize".to_string()],
            matched_domains: vec!["docs".to_string()],
            reasoning: "Matched intent and domain".to_string(),
        };
        let json = serde_json::to_string(&suggestion).unwrap();
        let back: AgentRouteSuggestion = serde_json::from_str(&json).unwrap();
        assert_eq!(back, suggestion);
    }
}
