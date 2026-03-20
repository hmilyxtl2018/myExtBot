//! Complete 9-pillar `AgentSpec` — Rust mirror of the TypeScript `AgentSpec`
//! interface defined in `src/core/types.ts`.
//!
//! # Pillars
//!
//! | # | Pillar | Key types |
//! |---|--------|-----------|
//! | 1 | Identity | [`AgentSpec`] root fields |
//! | 2 | Control Loop | [`ControlLoopConfig`], [`ControlLoopType`] |
//! | 3 | Tools | [`AgentSpecTool`] |
//! | 4 | Guardrails | [`AgentSpecGuardrails`] |
//! | 5 | Prompts | [`AgentSpecPrompts`] |
//! | 6 | Intent & Persona | [`AgentSpecDomain`] |
//! | 7 | Communication | [`CommunicationConfig`], [`MessageType`], [`ChannelType`] |
//! | 8 | Orchestration | [`OrchestrationConfig`], [`RoutingConfig`], [`PipelineParticipation`], [`PipelineRole`], [`ResponseStyle`] |
//! | 9 | Memory | [`MemoryConfig`], [`KnowledgeDbConfig`], [`CostTrackingConfig`], [`LineageTrackingConfig`], [`HealthMonitoringConfig`] |
//!
//! All structs use `#[serde(rename_all = "camelCase")]` to match the
//! TypeScript JSON convention, and all optional fields carry
//! `#[serde(skip_serializing_if = "Option::is_none")]`.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

// ── Pillar 2: Control Loop ────────────────────────────────────────────────────

/// Valid control-loop execution strategies for an agent.
///
/// Mirrors the TypeScript `ControlLoopType` union:
/// `"plan-act" | "react" | "reflexion" | "custom"`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ControlLoopType {
    PlanAct,
    React,
    Reflexion,
    Custom,
}

/// Control-loop configuration (Pillar 2).
///
/// Matches the TypeScript anonymous object `{ type: ControlLoopType }` used
/// inside `AgentSpec.controlLoop`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ControlLoopConfig {
    pub r#type: ControlLoopType,
}

// ── Pillar 3: Tools ───────────────────────────────────────────────────────────

/// A tool declaration inside an `AgentSpec` (Pillar 3).
///
/// Mirrors the TypeScript `AgentSpecTool` interface which has a required
/// `name` field plus an open-ended index signature `[key: string]: unknown`.
/// The extra keys are collected into `extra` and serialised as sibling JSON
/// fields (via `#[serde(flatten)]`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AgentSpecTool {
    /// Unique tool name within this agent.
    pub name: String,
    /// Arbitrary additional tool metadata (open-ended index signature).
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

// ── Pillar 4: Guardrails ──────────────────────────────────────────────────────

/// Runtime guardrails for an `AgentSpec` (Pillar 4).
///
/// Mirrors the TypeScript `AgentSpecGuardrails` interface.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentSpecGuardrails {
    /// Maximum number of tokens consumed per LLM call (must be > 0).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_tokens_per_call: Option<u32>,
    /// Maximum monetary cost allowed per call in USD (must be > 0).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_cost_per_call: Option<f64>,
    /// Whether a human must approve the action before execution.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub require_human_approval: Option<bool>,
}

// ── Pillar 5: Prompts ─────────────────────────────────────────────────────────

/// Prompt templates for an `AgentSpec` (Pillar 5).
///
/// Mirrors the TypeScript `AgentSpecPrompts` interface.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentSpecPrompts {
    /// System prompt injected to the LLM for this agent.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system: Option<String>,
}

// ── Pillar 6: Intent & Persona ────────────────────────────────────────────────

/// A scored domain entry for Pillar 6 (Intent & Persona).
///
/// Mirrors the TypeScript `AgentSpecDomain` interface.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentSpecDomain {
    /// Domain label (e.g. `"finance"`, `"legal"`).
    pub name: String,
    /// Confidence score in \[0, 1\].
    pub score: f64,
}

// ── Pillar 7: Communication ────────────────────────────────────────────────────

/// Message types that can flow between agents.
///
/// Mirrors the TypeScript `MessageType` union.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum MessageType {
    Delegation,
    TaskAssigned,
    TaskUpdate,
    TaskResult,
    Ping,
    Notification,
    Query,
    Response,
}

/// Transport channel for inter-agent communication.
///
/// Mirrors the TypeScript `"in-memory" | "sqlite" | "both"` union inside
/// `CommunicationConfig.channel`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ChannelType {
    InMemory,
    Sqlite,
    Both,
}

/// Communication protocol configuration (Pillar 7).
///
/// Mirrors the TypeScript `CommunicationConfig` interface.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CommunicationConfig {
    /// IDs of agents this agent may delegate to.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delegation_targets: Option<Vec<String>>,
    /// Message types this agent can handle.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub supported_message_types: Option<Vec<MessageType>>,
    /// Protocol version string (e.g. `"1.0"`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub protocol_version: Option<String>,
    /// Preferred transport channel.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel: Option<ChannelType>,
}

// ── Pillar 8: Orchestration ────────────────────────────────────────────────────

/// Role this agent plays within a pipeline.
///
/// Mirrors the TypeScript `"executor" | "coordinator" | "fallback"` union.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum PipelineRole {
    Executor,
    Coordinator,
    Fallback,
}

/// Describes this agent's participation in a named pipeline (Pillar 8).
///
/// Mirrors the TypeScript `PipelineParticipation` interface.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PipelineParticipation {
    /// Stable identifier of the pipeline.
    pub pipeline_id: String,
    /// Indexes of the pipeline steps this agent participates in.
    pub step_indexes: Vec<u32>,
    /// The role this agent plays in the pipeline.
    pub role: PipelineRole,
}

/// Preferred response style for an agent.
///
/// Mirrors the TypeScript `"concise" | "detailed" | "bullet-points" | "markdown"` union.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ResponseStyle {
    Concise,
    Detailed,
    BulletPoints,
    Markdown,
}

/// Routing configuration for task/intent dispatch (Pillar 8).
///
/// Mirrors the TypeScript `RoutingConfig` interface.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RoutingConfig {
    /// Intent tags this agent handles.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub intents: Option<Vec<String>>,
    /// Domain labels this agent handles.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub domains: Option<Vec<String>>,
    /// Languages this agent is proficient in.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub languages: Option<Vec<String>>,
    /// Preferred response style.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response_style: Option<ResponseStyle>,
    /// Minimum routing confidence score in \[0, 1\].
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_confidence: Option<f64>,
}

/// Orchestration configuration — how this agent participates in workflows
/// (Pillar 8).
///
/// Mirrors the TypeScript `OrchestrationConfig` interface.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OrchestrationConfig {
    /// Named pipelines this agent participates in.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pipelines: Option<Vec<PipelineParticipation>>,
    /// Scene IDs this agent has an affinity for.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scene_affinities: Option<Vec<String>>,
    /// Routing configuration.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub routing: Option<RoutingConfig>,
    /// Maximum number of tasks to run concurrently.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_concurrent_tasks: Option<u32>,
    /// Scheduling priority (higher value = higher priority).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub priority: Option<i32>,
}

// ── Pillar 9: Memory & Observability ─────────────────────────────────────────

/// Knowledge-database configuration (sub-field of [`MemoryConfig`]).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeDbConfig {
    /// Whether the knowledge DB is active.
    pub enabled: bool,
    /// Score threshold above which a trace is auto-promoted to long-term memory.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_promote_threshold: Option<f64>,
    /// Maximum number of entries kept in the store.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_entries: Option<u32>,
    /// Auto-retire entries older than this many minutes; `None` disables it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_retire_after_minutes: Option<u32>,
}

/// Cost-tracking configuration (sub-field of [`MemoryConfig`]).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CostTrackingConfig {
    /// Whether cost tracking is active.
    pub enabled: bool,
    /// Daily spend budget in USD.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub daily_budget: Option<f64>,
    /// Fraction of `daily_budget` at which an alert is emitted.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alert_threshold: Option<f64>,
}

/// Lineage-tracking configuration (sub-field of [`MemoryConfig`]).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LineageTrackingConfig {
    /// Whether lineage tracking is active.
    pub enabled: bool,
    /// Maximum lineage depth to record.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_depth: Option<u32>,
    /// Whether to include call arguments in the lineage record.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub include_arguments: Option<bool>,
}

/// Health-monitoring configuration (sub-field of [`MemoryConfig`]).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HealthMonitoringConfig {
    /// Whether health monitoring is active.
    pub enabled: bool,
    /// Error-rate fraction above which the agent is considered *degraded*.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub degraded_threshold: Option<f64>,
    /// Error-rate fraction above which the agent is considered *down*.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub down_threshold: Option<f64>,
    /// Auto-retire the agent after this many minutes of being down; `None` disables it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_retire_after_minutes: Option<u32>,
}

/// Memory & observability configuration (Pillar 9).
///
/// Mirrors the TypeScript `MemoryConfig` interface.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MemoryConfig {
    /// Knowledge-database settings.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub knowledge_db: Option<KnowledgeDbConfig>,
    /// Cost-tracking settings.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cost_tracking: Option<CostTrackingConfig>,
    /// Lineage-tracking settings.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lineage_tracking: Option<LineageTrackingConfig>,
    /// Health-monitoring settings.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub health_monitoring: Option<HealthMonitoringConfig>,
}

// ── AgentSpec ─────────────────────────────────────────────────────────────────

/// The complete 9-pillar Agent Specification.
///
/// This is the Rust mirror of the TypeScript `AgentSpec` interface
/// (which extends `AgentProfile`) defined in `src/core/types.ts`.
///
/// All JSON keys use camelCase to stay compatible with the TypeScript output.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentSpec {
    // ── Pillar 1: Identity ────────────────────────────────────────────────────
    /// Unique identifier for this agent (e.g. `"research-bot"`).
    pub id: String,
    /// Human-readable display name (e.g. `"Research Bot"`).
    pub name: String,
    /// Semantic version string (e.g. `"1.2.3"`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    /// Optional description of the agent's purpose or persona.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Whether this agent is currently active (default: `true`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,

    // ── Pillar 2: Scene / Control Loop ────────────────────────────────────────
    /// Optional scene this agent is associated with.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scene_id: Option<String>,
    /// Explicit list of service names this agent is allowed to use.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allowed_services: Option<Vec<String>>,
    /// Control-loop strategy.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub control_loop: Option<ControlLoopConfig>,

    // ── Pillar 3: Capabilities & Tools ───────────────────────────────────────
    /// The agent's primary skill / specialty.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub primary_skill: Option<String>,
    /// Supporting skills, listed in priority order.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub secondary_skills: Option<Vec<String>>,
    /// High-level capabilities the agent exposes.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<Vec<String>>,
    /// Hard limits or behavioural constraints.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub constraints: Option<Vec<String>>,
    /// Tools declared by this agent.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tools: Option<Vec<AgentSpecTool>>,

    // ── Pillar 4: Delegation & Guardrails ────────────────────────────────────
    /// IDs of other agents this agent may delegate to; `["*"]` means any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub can_delegate_to: Option<Vec<String>>,
    /// Runtime guardrails (token/cost caps, human-approval gate).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub guardrails: Option<AgentSpecGuardrails>,

    // ── Pillar 5: Persona / Prompts ───────────────────────────────────────────
    /// System prompt injected to the LLM (from `AgentProfile`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system_prompt: Option<String>,
    /// Additional prompt templates.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompts: Option<AgentSpecPrompts>,

    // ── Pillar 6: Intent & Persona ────────────────────────────────────────────
    /// Intent tags used for routing.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub intents: Option<Vec<String>>,
    /// Languages this agent is proficient in.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub languages: Option<Vec<String>>,
    /// Preferred response style.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response_style: Option<ResponseStyle>,
    /// Domain affinities with confidence scores.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub domains: Option<Vec<AgentSpecDomain>>,

    // ── Pillar 7: Communication ───────────────────────────────────────────────
    /// Communication protocol configuration.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub communication: Option<CommunicationConfig>,

    // ── Pillar 8: Orchestration ───────────────────────────────────────────────
    /// Orchestration and pipeline participation configuration.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub orchestration: Option<OrchestrationConfig>,

    // ── Pillar 9: Memory & Observability ──────────────────────────────────────
    /// Memory and observability configuration.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory: Option<MemoryConfig>,
}

// ── From<AgentIdentity> ───────────────────────────────────────────────────────

impl From<crate::collab::AgentIdentity> for AgentSpec {
    /// Upgrade a minimal [`crate::collab::AgentIdentity`] to a full
    /// [`AgentSpec`], leaving all 9-pillar extension fields as `None`.
    ///
    /// This allows existing code that works with `AgentIdentity` to produce an
    /// `AgentSpec` without a breaking change.  The `role` field is mapped to
    /// `primary_skill` since both describe the agent's main area of expertise.
    fn from(identity: crate::collab::AgentIdentity) -> Self {
        AgentSpec {
            id: identity.id,
            name: identity.name,
            version: None,
            description: None,
            enabled: Some(true),
            scene_id: None,
            allowed_services: None,
            control_loop: None,
            primary_skill: identity.role,
            secondary_skills: None,
            capabilities: None,
            constraints: None,
            tools: None,
            can_delegate_to: None,
            guardrails: None,
            system_prompt: None,
            prompts: None,
            intents: None,
            languages: None,
            response_style: None,
            domains: None,
            communication: None,
            orchestration: None,
            memory: None,
        }
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── Pillar 2: ControlLoopType enum serialisation ──────────────────────────

    #[test]
    fn test_control_loop_type_plan_act_serialises_to_kebab() {
        let json = serde_json::to_value(ControlLoopType::PlanAct).unwrap();
        assert_eq!(json.as_str().unwrap(), "plan-act");
    }

    #[test]
    fn test_control_loop_type_react_serialises() {
        let json = serde_json::to_value(ControlLoopType::React).unwrap();
        assert_eq!(json.as_str().unwrap(), "react");
    }

    #[test]
    fn test_control_loop_type_reflexion_serialises() {
        let json = serde_json::to_value(ControlLoopType::Reflexion).unwrap();
        assert_eq!(json.as_str().unwrap(), "reflexion");
    }

    #[test]
    fn test_control_loop_type_custom_serialises() {
        let json = serde_json::to_value(ControlLoopType::Custom).unwrap();
        assert_eq!(json.as_str().unwrap(), "custom");
    }

    #[test]
    fn test_control_loop_type_round_trip() {
        for variant in [
            ControlLoopType::PlanAct,
            ControlLoopType::React,
            ControlLoopType::Reflexion,
            ControlLoopType::Custom,
        ] {
            let json = serde_json::to_value(&variant).unwrap();
            let back: ControlLoopType = serde_json::from_value(json).unwrap();
            assert_eq!(back, variant);
        }
    }

    #[test]
    fn test_control_loop_config_serialises_with_type_key() {
        let cfg = ControlLoopConfig {
            r#type: ControlLoopType::PlanAct,
        };
        let json = serde_json::to_value(&cfg).unwrap();
        // The JSON key must be "type" (not "r#type")
        assert_eq!(json["type"].as_str().unwrap(), "plan-act");
    }

    // ── Pillar 4: Guardrails camelCase ────────────────────────────────────────

    #[test]
    fn test_guardrails_camelcase_keys() {
        let g = AgentSpecGuardrails {
            max_tokens_per_call: Some(4096),
            max_cost_per_call: Some(0.05),
            require_human_approval: Some(true),
        };
        let json = serde_json::to_value(&g).unwrap();
        // snake_case Rust fields must appear as camelCase JSON keys
        assert!(json.get("maxTokensPerCall").is_some(), "expected maxTokensPerCall");
        assert!(json.get("maxCostPerCall").is_some(), "expected maxCostPerCall");
        assert!(json.get("requireHumanApproval").is_some(), "expected requireHumanApproval");
        // snake_case keys must NOT be present
        assert!(json.get("max_tokens_per_call").is_none());
        assert_eq!(json["maxTokensPerCall"].as_u64().unwrap(), 4096);
        assert!((json["maxCostPerCall"].as_f64().unwrap() - 0.05).abs() < f64::EPSILON);
        assert!(json["requireHumanApproval"].as_bool().unwrap());
    }

    // ── Pillar 6: AgentSpecDomain ─────────────────────────────────────────────

    #[test]
    fn test_agent_spec_domain_round_trip() {
        let domain = AgentSpecDomain {
            name: "finance".to_string(),
            score: 0.92,
        };
        let json = serde_json::to_value(&domain).unwrap();
        assert_eq!(json["name"].as_str().unwrap(), "finance");
        assert!((json["score"].as_f64().unwrap() - 0.92).abs() < f64::EPSILON);
        let back: AgentSpecDomain = serde_json::from_value(json).unwrap();
        assert_eq!(back, domain);
    }

    // ── Pillar 7: MessageType & ChannelType ───────────────────────────────────

    #[test]
    fn test_message_type_serialises_kebab_case() {
        assert_eq!(
            serde_json::to_value(MessageType::TaskAssigned).unwrap().as_str().unwrap(),
            "task-assigned"
        );
        assert_eq!(
            serde_json::to_value(MessageType::Delegation).unwrap().as_str().unwrap(),
            "delegation"
        );
        assert_eq!(
            serde_json::to_value(MessageType::Ping).unwrap().as_str().unwrap(),
            "ping"
        );
    }

    #[test]
    fn test_channel_type_in_memory_serialises_with_hyphen() {
        let json = serde_json::to_value(ChannelType::InMemory).unwrap();
        assert_eq!(json.as_str().unwrap(), "in-memory");
        let back: ChannelType = serde_json::from_value(json).unwrap();
        assert_eq!(back, ChannelType::InMemory);
    }

    #[test]
    fn test_communication_config_camelcase_and_channel() {
        let comm = CommunicationConfig {
            delegation_targets: Some(vec!["agent-b".to_string()]),
            supported_message_types: Some(vec![MessageType::Ping, MessageType::TaskResult]),
            protocol_version: Some("1.0".to_string()),
            channel: Some(ChannelType::Both),
        };
        let json = serde_json::to_value(&comm).unwrap();
        assert!(json.get("delegationTargets").is_some());
        assert!(json.get("supportedMessageTypes").is_some());
        assert!(json.get("protocolVersion").is_some());
        assert_eq!(json["channel"].as_str().unwrap(), "both");
        let back: CommunicationConfig = serde_json::from_value(json).unwrap();
        assert_eq!(back, comm);
    }

    // ── Pillar 8: Orchestration ───────────────────────────────────────────────

    #[test]
    fn test_pipeline_role_and_response_style_serialise_kebab_case() {
        assert_eq!(
            serde_json::to_value(PipelineRole::Coordinator).unwrap().as_str().unwrap(),
            "coordinator"
        );
        assert_eq!(
            serde_json::to_value(PipelineRole::Fallback).unwrap().as_str().unwrap(),
            "fallback"
        );
        assert_eq!(
            serde_json::to_value(ResponseStyle::BulletPoints).unwrap().as_str().unwrap(),
            "bullet-points"
        );
        assert_eq!(
            serde_json::to_value(ResponseStyle::Markdown).unwrap().as_str().unwrap(),
            "markdown"
        );
    }

    #[test]
    fn test_orchestration_config_round_trip() {
        let orch = OrchestrationConfig {
            pipelines: Some(vec![PipelineParticipation {
                pipeline_id: "pipe-1".to_string(),
                step_indexes: vec![0, 2],
                role: PipelineRole::Executor,
            }]),
            scene_affinities: Some(vec!["chat".to_string()]),
            routing: Some(RoutingConfig {
                intents: Some(vec!["search".to_string()]),
                domains: Some(vec!["legal".to_string()]),
                languages: Some(vec!["en".to_string()]),
                response_style: Some(ResponseStyle::Concise),
                min_confidence: Some(0.7),
            }),
            max_concurrent_tasks: Some(4),
            priority: Some(10),
        };
        let json = serde_json::to_value(&orch).unwrap();
        assert!(json.get("pipelines").is_some());
        assert!(json.get("sceneAffinities").is_some());
        assert!(json.get("routing").is_some());
        assert_eq!(json["maxConcurrentTasks"].as_u64().unwrap(), 4);
        assert_eq!(json["priority"].as_i64().unwrap(), 10);
        let back: OrchestrationConfig = serde_json::from_value(json).unwrap();
        assert_eq!(back, orch);
    }

    // ── Pillar 9: Memory ──────────────────────────────────────────────────────

    #[test]
    fn test_memory_config_nested_structs_round_trip() {
        let mem = MemoryConfig {
            knowledge_db: Some(KnowledgeDbConfig {
                enabled: true,
                auto_promote_threshold: Some(0.8),
                max_entries: Some(1000),
                auto_retire_after_minutes: Some(60),
            }),
            cost_tracking: Some(CostTrackingConfig {
                enabled: true,
                daily_budget: Some(10.0),
                alert_threshold: Some(0.9),
            }),
            lineage_tracking: Some(LineageTrackingConfig {
                enabled: false,
                max_depth: Some(5),
                include_arguments: Some(true),
            }),
            health_monitoring: Some(HealthMonitoringConfig {
                enabled: true,
                degraded_threshold: Some(0.3),
                down_threshold: Some(0.8),
                auto_retire_after_minutes: Some(30),
            }),
        };
        let json = serde_json::to_value(&mem).unwrap();
        assert!(json.get("knowledgeDb").is_some());
        assert!(json.get("costTracking").is_some());
        assert!(json.get("lineageTracking").is_some());
        assert!(json.get("healthMonitoring").is_some());
        assert!(json["knowledgeDb"]["autoRetireAfterMinutes"].as_u64().is_some());
        let back: MemoryConfig = serde_json::from_value(json).unwrap();
        assert_eq!(back, mem);
    }

    // ── AgentSpec: optional-fields skipping ──────────────────────────────────

    #[test]
    fn test_optional_fields_skipped_when_none() {
        let spec = AgentSpec {
            id: "bot-1".to_string(),
            name: "Bot One".to_string(),
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
            intents: None,
            languages: None,
            response_style: None,
            domains: None,
            communication: None,
            orchestration: None,
            memory: None,
        };
        let json = serde_json::to_value(&spec).unwrap();
        // Only required fields should be present
        assert!(json.get("id").is_some());
        assert!(json.get("name").is_some());
        // All optional None fields must be absent (not serialised as null)
        assert!(json.get("version").is_none(), "version should be absent");
        assert!(json.get("description").is_none());
        assert!(json.get("enabled").is_none());
        assert!(json.get("controlLoop").is_none());
        assert!(json.get("tools").is_none());
        assert!(json.get("guardrails").is_none());
        assert!(json.get("memory").is_none());
    }

    // ── AgentSpec: minimal round-trip ────────────────────────────────────────

    #[test]
    fn test_minimal_agent_spec_round_trip() {
        let spec = AgentSpec {
            id: "min-bot".to_string(),
            name: "Minimal Bot".to_string(),
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
            intents: None,
            languages: None,
            response_style: None,
            domains: None,
            communication: None,
            orchestration: None,
            memory: None,
        };
        let json = serde_json::to_string(&spec).unwrap();
        let back: AgentSpec = serde_json::from_str(&json).unwrap();
        assert_eq!(back, spec);
    }

    // ── AgentSpec: full round-trip ────────────────────────────────────────────

    #[test]
    fn test_full_agent_spec_round_trip() {
        let spec = AgentSpec {
            id: "research-bot".to_string(),
            name: "Research Bot".to_string(),
            version: Some("2.0.1".to_string()),
            description: Some("Handles deep research tasks".to_string()),
            enabled: Some(true),
            scene_id: Some("scene-lab".to_string()),
            allowed_services: Some(vec!["search".to_string(), "memory".to_string()]),
            control_loop: Some(ControlLoopConfig {
                r#type: ControlLoopType::React,
            }),
            primary_skill: Some("research".to_string()),
            secondary_skills: Some(vec!["summarisation".to_string()]),
            capabilities: Some(vec!["web-search".to_string(), "pdf-read".to_string()]),
            constraints: Some(vec!["no-pii".to_string()]),
            tools: Some(vec![AgentSpecTool {
                name: "search".to_string(),
                extra: {
                    let mut m = HashMap::new();
                    m.insert("description".to_string(), serde_json::json!("Web search tool"));
                    m
                },
            }]),
            can_delegate_to: Some(vec!["writer-bot".to_string()]),
            guardrails: Some(AgentSpecGuardrails {
                max_tokens_per_call: Some(8192),
                max_cost_per_call: Some(0.10),
                require_human_approval: Some(false),
            }),
            system_prompt: Some("You are a research assistant.".to_string()),
            prompts: Some(AgentSpecPrompts {
                system: Some("Be concise.".to_string()),
            }),
            intents: Some(vec!["research".to_string(), "summarise".to_string()]),
            languages: Some(vec!["en".to_string(), "zh".to_string()]),
            response_style: Some(ResponseStyle::Detailed),
            domains: Some(vec![
                AgentSpecDomain { name: "science".to_string(), score: 0.9 },
                AgentSpecDomain { name: "finance".to_string(), score: 0.6 },
            ]),
            communication: Some(CommunicationConfig {
                delegation_targets: Some(vec!["writer-bot".to_string()]),
                supported_message_types: Some(vec![MessageType::TaskAssigned]),
                protocol_version: Some("1.0".to_string()),
                channel: Some(ChannelType::Sqlite),
            }),
            orchestration: Some(OrchestrationConfig {
                pipelines: Some(vec![PipelineParticipation {
                    pipeline_id: "research-pipeline".to_string(),
                    step_indexes: vec![0, 1],
                    role: PipelineRole::Coordinator,
                }]),
                scene_affinities: Some(vec!["lab".to_string()]),
                routing: Some(RoutingConfig {
                    intents: Some(vec!["research".to_string()]),
                    domains: Some(vec!["science".to_string()]),
                    languages: Some(vec!["en".to_string()]),
                    response_style: Some(ResponseStyle::Markdown),
                    min_confidence: Some(0.75),
                }),
                max_concurrent_tasks: Some(2),
                priority: Some(5),
            }),
            memory: Some(MemoryConfig {
                knowledge_db: Some(KnowledgeDbConfig {
                    enabled: true,
                    auto_promote_threshold: Some(0.85),
                    max_entries: Some(500),
                    auto_retire_after_minutes: Some(120),
                }),
                cost_tracking: Some(CostTrackingConfig {
                    enabled: true,
                    daily_budget: Some(5.0),
                    alert_threshold: Some(0.8),
                }),
                lineage_tracking: None,
                health_monitoring: Some(HealthMonitoringConfig {
                    enabled: true,
                    degraded_threshold: Some(0.2),
                    down_threshold: Some(0.6),
                    auto_retire_after_minutes: None,
                }),
            }),
        };

        let json = serde_json::to_string_pretty(&spec).unwrap();
        let back: AgentSpec = serde_json::from_str(&json).unwrap();
        assert_eq!(back, spec);
    }

    // ── AgentSpec: deserialise from TS-format JSON ────────────────────────────

    #[test]
    fn test_deserialise_ts_format_json() {
        // JSON produced by the TypeScript side (camelCase keys)
        let raw = r#"{
            "id": "ts-agent",
            "name": "TS Agent",
            "version": "1.0.0",
            "controlLoop": { "type": "plan-act" },
            "guardrails": {
                "maxTokensPerCall": 2048,
                "requireHumanApproval": true
            },
            "communication": {
                "channel": "in-memory",
                "delegationTargets": ["peer-agent"]
            },
            "orchestration": {
                "priority": 3,
                "maxConcurrentTasks": 1
            },
            "memory": {
                "knowledgeDb": { "enabled": true, "autoRetireAfterMinutes": 30 }
            }
        }"#;

        let spec: AgentSpec = serde_json::from_str(raw).unwrap();
        assert_eq!(spec.id, "ts-agent");
        assert_eq!(spec.name, "TS Agent");
        assert_eq!(spec.version.as_deref(), Some("1.0.0"));

        // Pillar 2
        let cl = spec.control_loop.unwrap();
        assert_eq!(cl.r#type, ControlLoopType::PlanAct);

        // Pillar 4
        let g = spec.guardrails.unwrap();
        assert_eq!(g.max_tokens_per_call, Some(2048));
        assert_eq!(g.require_human_approval, Some(true));
        assert!(g.max_cost_per_call.is_none());

        // Pillar 7
        let comm = spec.communication.unwrap();
        assert_eq!(comm.channel, Some(ChannelType::InMemory));
        assert_eq!(comm.delegation_targets.as_deref(), Some(["peer-agent".to_string()].as_ref()));

        // Pillar 8
        let orch = spec.orchestration.unwrap();
        assert_eq!(orch.priority, Some(3));
        assert_eq!(orch.max_concurrent_tasks, Some(1));

        // Pillar 9
        let mem = spec.memory.unwrap();
        let kdb = mem.knowledge_db.unwrap();
        assert!(kdb.enabled);
        assert_eq!(kdb.auto_retire_after_minutes, Some(30));
    }

    // ── AgentSpec: missing optional fields → None ─────────────────────────────

    #[test]
    fn test_missing_optional_fields_deserialise_to_none() {
        let raw = r#"{"id": "bare-bot", "name": "Bare Bot"}"#;
        let spec: AgentSpec = serde_json::from_str(raw).unwrap();
        assert_eq!(spec.id, "bare-bot");
        assert!(spec.version.is_none());
        assert!(spec.description.is_none());
        assert!(spec.enabled.is_none());
        assert!(spec.control_loop.is_none());
        assert!(spec.tools.is_none());
        assert!(spec.guardrails.is_none());
        assert!(spec.prompts.is_none());
        assert!(spec.intents.is_none());
        assert!(spec.domains.is_none());
        assert!(spec.communication.is_none());
        assert!(spec.orchestration.is_none());
        assert!(spec.memory.is_none());
    }

    // ── AgentSpecTool: flatten extra fields ───────────────────────────────────

    #[test]
    fn test_agent_spec_tool_with_extra_fields_round_trip() {
        let raw = r#"{"name": "search", "description": "Web search", "timeout": 30}"#;
        let tool: AgentSpecTool = serde_json::from_str(raw).unwrap();
        assert_eq!(tool.name, "search");
        assert_eq!(tool.extra.get("description").unwrap(), "Web search");
        assert_eq!(tool.extra.get("timeout").unwrap().as_u64().unwrap(), 30);

        let json = serde_json::to_value(&tool).unwrap();
        // `name` must be a top-level key, not nested
        assert_eq!(json["name"].as_str().unwrap(), "search");
        assert_eq!(json["description"].as_str().unwrap(), "Web search");
    }

    // ── From<AgentIdentity> conversion ───────────────────────────────────────

    #[test]
    fn test_from_agent_identity_populates_id_name_role() {
        use crate::collab::AgentIdentity;
        use chrono::Utc;

        let identity = AgentIdentity {
            id: "agent-xyz".to_string(),
            name: "XYZ Bot".to_string(),
            role: Some("coordinator".to_string()),
            endpoint: Some("ws://host:9000".to_string()),
            team_id: "team-a".to_string(),
            is_local: true,
            last_seen: Utc::now(),
        };

        let spec = AgentSpec::from(identity);
        assert_eq!(spec.id, "agent-xyz");
        assert_eq!(spec.name, "XYZ Bot");
        // role → primary_skill
        assert_eq!(spec.primary_skill.as_deref(), Some("coordinator"));
        // Pillar fields default to None
        assert!(spec.control_loop.is_none());
        assert!(spec.tools.is_none());
        assert!(spec.guardrails.is_none());
        assert!(spec.memory.is_none());
        // enabled defaults to Some(true)
        assert_eq!(spec.enabled, Some(true));
    }

    #[test]
    fn test_from_agent_identity_with_no_role() {
        use crate::collab::AgentIdentity;
        use chrono::Utc;

        let identity = AgentIdentity {
            id: "bare-id".to_string(),
            name: "Bare".to_string(),
            role: None,
            endpoint: None,
            team_id: "t0".to_string(),
            is_local: false,
            last_seen: Utc::now(),
        };

        let spec = AgentSpec::from(identity);
        assert_eq!(spec.id, "bare-id");
        assert!(spec.primary_skill.is_none());
    }
}
