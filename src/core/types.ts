/**
 * 单次工具调用的成本记录。
 */
export interface CostEntry {
  /** ISO 8601 时间戳 */
  timestamp: string;
  /** 发起方 Agent ID（通过 dispatchAs 调用时有值，直接 dispatch 时为 undefined） */
  agentId?: string;
  /** 工具名称 */
  toolName: string;
  /** 所属 Service 名称 */
  serviceName: string;
  /** 本次调用的成本（USD） */
  cost: number;
  /** 是否调用成功 */
  success: boolean;
  /** 可选元数据 */
  metadata?: {
    /** 消耗的 token 数（适用于 Perplexity 等按 token 计费的服务） */
    tokensUsed?: number;
    /** 调用耗时（ms） */
    durationMs?: number;
    /** 处理的字符数（适用于按字符计费的服务） */
    charsProcessed?: number;
  };
}

/**
 * 成本汇总结果。
 */
export interface CostSummary {
  totalCost: number;
  totalCalls: number;
  successfulCalls: number;
  /** 按 Agent 分组的成本 */
  byAgent: Record<string, { cost: number; calls: number }>;
  /** 按 Tool 分组的成本 */
  byTool: Record<string, { cost: number; calls: number }>;
  /** 按 Service 分组的成本 */
  byService: Record<string, { cost: number; calls: number }>;
  /** 查询的日期范围 */
  dateRange: { start: string; end: string };
}

/**
 * Tool 调用请求。
 */
export interface DispatchRequest {
  toolName: string;
  serviceName?: string;
  args?: Record<string, unknown>;
  metadata?: {
    tokensUsed?: number;
    charsProcessed?: number;
  };
}

/**
 * Tool 调用结果。
 */
export interface DispatchResult {
  success: boolean;
  data?: unknown;
 * src/core/types.ts
 *
 * Core type definitions for the myExtBot Digital Avatar Asset System.
 */

// ─── Service types ────────────────────────────────────────────────────────────

/** Unique identifier for a Service. */
export type ServiceName = string;

/** Unified result envelope returned by every Service execute() call. */
export interface ServiceResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  /** HTTP status code (when applicable) */
  statusCode?: number;
  /** Retry-After seconds (populated on 429 responses) */
  retryAfterSeconds?: number;
}

/** Minimal interface every MCP Service must implement. */
export interface McpService {
  /** Unique service name, e.g. "PerplexityService" */
  readonly name: ServiceName;
  /** Human-readable description */
  readonly description: string;
  /** Execute the service with an arbitrary payload */
  execute(payload: unknown): Promise<ServiceResult>;
}

// ─── Tool types ───────────────────────────────────────────────────────────────

/** A single Tool definition exposed by an Agent. */
export interface ToolDefinition {
  name: string;
  description: string;
  serviceName: ServiceName;
  inputSchema?: Record<string, unknown>;
}

// ─── Agent types ──────────────────────────────────────────────────────────────

/** Lifecycle state of an Agent (M10). */
export type AgentStatus = "active" | "sleeping" | "busy" | "retired";

/** An Agent persona / profile. */
export interface AgentProfile {
  id: string;
  name: string;
  description: string;
  /** Status in the lifecycle (M10) */
  status: AgentStatus;
  /** Services this agent owns */
  ownedServices: ServiceName[];
  /** Other agents this agent can delegate to */
  canDelegateTo: string[];
  /** Tools this agent exposes */
  tools: ToolDefinition[];
  /** System prompt injected into LLM — defines the agent's persona (M6) */
  systemPrompt?: string;
  /** Intent tags for automatic routing (M6) */
  intents?: string[];
}

// ─── Scene types ──────────────────────────────────────────────────────────────

/** Trigger conditions for automatic scene activation (M7). */
export interface SceneTrigger {
  keywords?: string[];
  timeRange?: string;
  agentId?: string;
  /** Health-based trigger: activates when a service reaches this health state (M4) */
  health?: ServiceHealth;
}

/** A Scene filters which services and tools are available. */
export interface Scene {
  id: string;
  name: string;
  description: string;
  /** Service names allowed in this scene */
  allowedServices: ServiceName[];
  /** Auto-activation triggers (M7) */
  triggers?: SceneTrigger;
}

// ─── Delegation types (M1) ───────────────────────────────────────────────────

/** A single delegation event recorded in the log. */
export interface DelegationLogEntry {
  id: string;
  timestamp: string;
  fromAgentId: string;
  toAgentId: string;
  toolName: string;
  serviceName: ServiceName;
  payload: unknown;
  result: ServiceResult;
  durationMs: number;
}

// ─── Plugin types (M2) ───────────────────────────────────────────────────────

/** A Plugin manifest describing an installable capability. */
export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  /** Services provided by this plugin */
  services: ServiceName[];
  /** Tools provided by this plugin */
  tools: ToolDefinition[];
  /** Required peer plugins */
  dependencies?: string[];
// ─────────────────────────────────────────────────────────────────────────────
// Core types for myExtBot digital-avatar asset system
// ─────────────────────────────────────────────────────────────────────────────

// ── Agent & Service types ────────────────────────────────────────────────────

export interface ToolDefinition {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export interface ServiceResult {
/**
 * Core types for the myExtBot digital avatar asset system.
 */

// ── Tool / Delegation types ────────────────────────────────────────────────

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, { type: string; description?: string; default?: unknown }>;
    required?: string[];
  };
}

export interface ToolCall {
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  success: boolean;
  output?: unknown;
 * Core types for myExtBot digital avatar asset system.
 */

// ─── Service Health ───────────────────────────────────────────────────────────

/**
 * Health status of a service.
 *
 * - "healthy"  : service is operating normally
 * - "degraded" : service is operating with reduced capacity or elevated errors
 * - "down"     : service is completely unavailable
 *
 * Note: health trigger conditions only check for "down" (any-service-down) or
 * "healthy" (all-services-healthy). A "degraded" service does not satisfy
 * "any-service-down" — it must be explicitly "down".
 */
export type ServiceHealth = "healthy" | "down" | "degraded";

// ─── Scene ────────────────────────────────────────────────────────────────────

/**
 * Scene — a named collection of services activated together for a specific
 * context or workflow.
 */
export interface Scene {
  /** Unique identifier for the scene. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Optional description of when/why this scene is used. */
  description?: string;
  /** Names of services that belong to this scene. */
  serviceNames: string[];
  /**
   * Optional trigger conditions that cause this scene to be automatically
   * recommended by the SceneTriggerEngine.
   */
  triggers?: SceneTrigger[];
}

// ─── SceneTrigger ─────────────────────────────────────────────────────────────

/**
 * Scene 触发器 — 描述何时自动推荐激活此 Scene。
 */
export interface SceneTrigger {
  /** 触发器类型 */
  type: "keyword" | "time" | "agent" | "health";

  // ── keyword 类型 ────────────────────────────────────────────────────────────
  /**
   * 当用户输入包含这些关键词时触发（大小写不敏感）。
   * 例：["搜索", "查一下", "最新消息", "search", "find", "lookup"]
   */
  keywords?: string[];

  // ── time 类型 ───────────────────────────────────────────────────────────────
  /**
   * 时间段范围（本地时间 **零填充 HH:MM** 格式，例如 "09:00"、"18:30"）。
   * - 正常范围：start ≤ end，例如 { start: "09:00", end: "18:00" }
   * - 跨午夜范围：start > end，例如 { start: "22:00", end: "06:00" }
   *
   * @example { start: "09:00", end: "18:00" }   // working hours
   * @example { start: "22:00", end: "06:00" }   // overnight shift
   */
  timeRange?: { start: string; end: string };

  // ── agent 类型 ──────────────────────────────────────────────────────────────
  /**
   * 当指定 Agent 被调用时触发。
   * 例：agentId = "web-intel-agent" 被调用 → 激活 web-intelligence scene
   */
  agentId?: string;

  // ── health 类型 ─────────────────────────────────────────────────────────────
  /**
   * 健康条件：
   * - "any-service-down"：任何 Service 变为 down 时触发
   * - "all-services-healthy"：所有 Service 恢复健康时触发
   */
  condition?: "any-service-down" | "all-services-healthy";
}

// ─── TriggerContext ───────────────────────────────────────────────────────────

/**
 * SceneTriggerEngine 的评估上下文。
 */
export interface TriggerContext {
  /** 用户输入（用于 keyword 触发器） */
  userInput?: string;
  /**
   * 当前本地时间（HH:MM，用于 time 触发器）。
   * 不传则取当前系统时间。
   */
  currentTime?: string;
  /** 当前被调用的 Agent ID（用于 agent 触发器） */
  activeAgentId?: string;
  /**
   * 服务健康状态映射（用于 health 触发器）。
   * 不传则取当前 HealthMonitor 状态（如果可用）。
   */
  serviceHealths?: Record<string, ServiceHealth>;
}

// ─── SceneTriggerResult ───────────────────────────────────────────────────────

/**
 * Scene 触发评估结果。
 */
export interface SceneTriggerResult {
  sceneId: string;
  sceneName: string;
  /** 匹配的触发器（一个 Scene 可能有多个触发器同时满足） */
  matchedTriggers: Array<{
    type: SceneTrigger["type"];
    /** 例："关键词匹配: 搜索, 查一下" */
    reason: string;
  }>;
  /** 总得分（匹配的触发器数量 × 触发器权重） */
  score: number;
 * Core type definitions for myExtBot digital persona asset system.
 *
 * M6 — Agent Intent & Persona
 * Extends AgentProfile with systemPrompt, intents, languages, responseStyle,
 * and domains fields to support intent-driven routing via AgentRouter.
 */

// ── Tool & Service types ─────────────────────────────────────────────────────

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  success: boolean;
  output?: unknown;
  error?: string;
}

export interface McpService {
  id: string;
  name: string;
  tools: ToolDefinition[];
  call(toolName: string, args: Record<string, unknown>): Promise<ServiceResult>;
}

export interface AgentProfile {
  id: string;
  name: string;
  description?: string;
  /** IDs of services this agent is allowed to use */
  allowedServices?: string[];
  /** IDs of agents this agent can delegate tasks to ('*' means all) */
  canDelegateTo?: string[];
  /** System prompt injected when the agent drives an LLM */
  systemPrompt?: string;
  /** Intent tags used for automatic routing */
  intents?: string[];
}

// ── Delegation types ─────────────────────────────────────────────────────────

export interface DelegationRequest {
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface DelegationLog {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  result?: ServiceResult;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
}

// ── Pipeline types (M3) ──────────────────────────────────────────────────────

/**
 * A single execution step within a Pipeline.
 */
export interface PipelineStep {
  /** ID of the agent that will execute this step */
  agentId: string;
  /** Name of the tool to invoke */
  toolName: string;
  /**
   * Parameter mapping for the tool call:
   * - string value: literal — passed directly to the tool
   * - { fromStep: number; outputPath: string }: reference to the output of
   *   step N (0-indexed).  outputPath supports dot-notation, e.g.
   *   "results[0].url" or "answer".
   */
  inputMapping?: Record<string, string | { fromStep: number; outputPath: string }>;
  /** Human-readable description of this step (optional) */
  description?: string;
}

/**
 * Definition of an Agent Pipeline — an ordered list of steps executed
 * sequentially, with context passed between steps via inputMapping.
 */
export interface AgentPipeline {
  /** Unique identifier */
  id: string;
  /** Display name */
  name: string;
  /** Optional description */
  description?: string;
  /** Ordered list of steps to execute */
  steps: PipelineStep[];
}

/**
 * The result of a single Pipeline execution run.
 */
// ── Agent Profile ────────────────────────────────────────────────────────────

/**
 * Full profile of a registered digital-persona Agent.
 */
export interface AgentProfile {
  /** Unique identifier for this agent. */
  id: string;

  /** Human-readable display name. */
  name: string;

  /** Short description of what this agent does. */
  description?: string;

  /** The scene (context/environment) this agent belongs to. */
  sceneId?: string;

  /**
   * The specific services this agent is allowed to call.
   * When undefined, the agent may call any service registered in its scene.
   */
  allowedServices?: string[];

  /** The agent's primary skill / specialty (single phrase). */
  primarySkill?: string;

  /** List of natural-language capability descriptions. */
  capabilities?: string[];

  /** Whether this agent is currently active. */
  enabled?: boolean;

  // ── New in M6: Persona & Intent ──────────────────────────────────────────

  /**
   * System prompt injected to the LLM when running as this agent.
   * Example: "你是一个专注于网络信息获取的智能助手。每次回答都要附上信息来源 URL。"
   */
  systemPrompt?: string;

  /**
   * Intent tags used by AgentRouter for routing.
   * When the user's query matches these tags, this agent is preferred.
   * Example: ["web-search", "fact-check", "news", "research", "information-retrieval"]
   */
  intents?: string[];

  /**
   * Languages this agent is proficient in.
   * Example: ["zh-CN", "en-US", "ja"]
   */
  languages?: string[];

  /**
   * The agent's preferred response style.
   * - "concise": short and direct, one or two sentences
   * - "detailed": full explanation with background context
   * - "bullet-points": key points in a list
   * - "markdown": structured Markdown output
   */
  responseStyle?: "concise" | "detailed" | "bullet-points" | "markdown";

  /**
   * High-level domain tags (coarser-grained than intents).
   * Example: ["research", "coding", "productivity", "creativity"]
   */
  domains?: string[];
}

// ── Agent Summary ────────────────────────────────────────────────────────────

/**
 * Lightweight summary of an AgentProfile returned by listAgents().
 * Includes all M6 persona/intent fields so clients can display them.
 * Shared interfaces and types for the MCP Services List Manager.
 */

/**
 * JSON Schema-compatible parameter property definition.
 */
export interface ParameterProperty {
  type: string;
  description: string;
  enum?: string[];
  default?: unknown;
}

/**
 * JSON Schema-compatible parameters object for a tool.
 */
export interface ToolParameters {
  type: "object";
  properties: Record<string, ParameterProperty>;
  required?: string[];
}

/**
 * Defines a tool that the LLM can call, compatible with OpenAI Function Calling
 * and the MCP protocol.
 */
export interface ToolDefinition {
  /** Unique name of the tool (e.g. "search_web"). */
  name: string;
  /** Human-readable description of what the tool does. */
  description: string;
  /** JSON Schema describing the tool's input parameters. */
  parameters: ToolParameters;
}

/**
 * Represents a tool invocation request coming from the LLM.
 */
export interface ToolCall {
  /** The name of the tool to invoke (must match a registered ToolDefinition name). */
  toolName: string;
  /** Key-value arguments passed to the tool, matching the tool's parameter schema. */
  arguments: Record<string, unknown>;
}

/**
 * The result returned after executing a tool call.
 */
export interface ToolResult {
  /** Whether the tool executed successfully. */
  success: boolean;
  /** The output produced by the tool on success. */
  output?: unknown;
  /** Error message if the tool execution failed. */
  error?: string;
}

/**
 * A single delegation log entry representing one agent-to-agent tool invocation.
 */
export interface DelegationLogEntry {
  /** Unique entry ID */
  id: string;
  /** ISO 8601 timestamp when the delegation occurred */
  timestamp: string;
  /** The delegating agent */
  fromAgentId: string;
  /** The receiving agent */
  toAgentId: string;
  /** The tool that was invoked */
  toolName: string;
  /** The arguments passed to the tool */
  arguments: Record<string, unknown>;
  /** Whether the invocation succeeded */
  success: boolean;
  /** Error message if success === false */
  error?: string;
  /** Execution duration in milliseconds */
  durationMs?: number;
  /** Optional session ID for grouping related delegations */
  sessionId?: string;
}

// ── Lineage Graph types ────────────────────────────────────────────────────

/**
 * A single node in the lineage graph.
 */
export interface LineageNode {
  /** Unique node ID (based on agentId or toolName) */
  id: string;
  /** Node type */
  type: "agent" | "tool" | "external-api";
  /** Display label */
  label: string;
  /** Associated agent ID (if type === "agent") */
  agentId?: string;
  /** Associated tool name (if type === "tool") */
  toolName?: string;
  /** Whether the most recent execution succeeded */
  success: boolean;
  /** Execution duration in ms (if available) */
  durationMs?: number;
  /** ISO 8601 timestamp of the first occurrence */
  timestamp: string;
}

/**
 * A directed edge in the lineage graph.
 */
export interface LineageEdge {
  /** Unique edge ID */
  id: string;
  /** Source node ID */
  from: string;
  /** Target node ID */
  to: string;
  /** Optional label (e.g. "委托" / "调用" / "返回结果") */
  label?: string;
  /** Edge type */
  type: "delegation" | "tool-call" | "return";
}

/**
 * A complete lineage graph.
 */
export interface LineageGraph {
  /** Session ID (optional, used for grouping) */
  sessionId?: string;
  nodes: LineageNode[];
  edges: LineageEdge[];
  startedAt: string;
  endedAt?: string;
  /** Total node count */
  nodeCount: number;
  /** Total edge count */
  edgeCount: number;
  /** Overall success rate (successful tool nodes / total tool nodes) */
  successRate: number;
}

/**
 * Summary of a lineage graph (for the summary API endpoint).
 */
export interface LineageGraphSummary {
  totalNodes: number;
  totalEdges: number;
  agentNodes: string[];
  toolNodes: string[];
  successRate: number;
  timeRange: { earliest: string; latest: string };
 * Interface that every MCP service must implement.
 * A service groups one or more related tools under a single unit of management.
 */
export interface McpService {
  /** Unique name identifying this service (e.g. "SearchService"). */
  readonly name: string;
  /** Whether this service is currently enabled and its tools are available to the LLM. */
  enabled: boolean;
  /**
   * Returns all tool definitions provided by this service.
   * These definitions are forwarded to the LLM so it knows what tools it can call.
   */
  getToolDefinitions(): ToolDefinition[];
  /**
   * Executes a tool call routed to this service.
   * @param call - The tool invocation request from the LLM.
   * @returns A promise resolving to the result of the tool execution.
   */
  execute(call: ToolCall): Promise<ToolResult>;
}

// ── Scene ───────────────────────────────────────────────────────────────────

/**
 * A Scene groups one or more services by use-case (e.g. "Research", "Productivity").
 * Scenes make it easy to present the LLM with only the tools relevant to the
 * current user intent, reducing prompt noise and improving tool selection accuracy.
 */
export interface Scene {
  /** Unique identifier for this scene (e.g. "research"). */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** Optional description of when to use this scene. */
  description?: string;
  /**
   * Names of the McpServices that belong to this scene.
   * Only enabled services in this list will expose their tools when the scene is active.
   */
  serviceNames: string[];
}

// ── Agent ───────────────────────────────────────────────────────────────────

/**
 * An AgentProfile defines a named LLM persona with a specific, restricted set
 * of tools.  When the LLM operates as a particular agent only the tools allowed
 * by that agent's profile are exposed, providing access-control and focus.
 *
 * An agent may optionally be scoped to a scene; if so, it further restricts the
 * scene's tool set to the services listed in `allowedServices`.
 *
 * Agents can also delegate tasks to other agents via the `canDelegateTo` field,
 * enabling multi-agent pipelines where a coordinator hands off sub-tasks to
 * specialised agents.
 */
export interface AgentProfile {
  /** Unique identifier for this agent (e.g. "research-bot"). */
  id: string;
  /** Human-readable display name (e.g. "Research Bot"). */
  name: string;
  /** Optional description of the agent's purpose or persona. */
  description?: string;
  /**
   * Optional scene this agent is associated with.
   * When set, the agent inherits the scene's service list as a starting point.
   */
  sceneId?: string;
  /**
   * Explicit list of service names this agent is allowed to use.
   * If omitted (and no sceneId is given), the agent can use all enabled services.
   * If both `sceneId` and `allowedServices` are provided, `allowedServices` takes
   * precedence (use it to further restrict a scene's service set).
   */
  allowedServices?: string[];
  /**
   * IDs of other agents this agent is permitted to delegate tasks to.
   * Use `["*"]` to allow delegation to any registered agent.
   * When omitted or empty, this agent cannot delegate to others.
   */
  canDelegateTo?: string[];

  // ── Capability metadata ────────────────────────────────────────────────────
  // These fields describe *what* the agent knows how to do and *what it cannot*
  // do, making each profile self-documenting and allowing operators to upgrade
  // capabilities over time via PATCH /api/agents/:id.

  /**
   * The agent's single most important skill — its defining specialisation.
   * Used in UI cards and agent-selection UIs to give a quick one-liner summary.
   * Example: "Web research & information retrieval"
   */
  primarySkill?: string;

  /**
   * Supporting skills the agent can apply, listed in priority order.
   * These complement the primary skill but are not the agent's main focus.
   * Example: ["Summarisation", "Citation formatting", "Language translation"]
   */
  secondarySkills?: string[];

  /**
   * High-level capabilities the agent exposes, expressed as action phrases.
   * These are shown in discovery UIs so users know what they can ask the agent.
   * Example: ["Search the web", "Summarise documents", "Translate text"]
   */
  capabilities?: string[];

  /**
   * Hard limits or behavioural guardrails for this agent.
   * Operators use this to document what the agent must NOT do, what data it
   * cannot access, or any rate/quota restrictions.
   * Example: ["Cannot access internal databases", "Max 10 tool calls per request"]
   */
  constraints?: string[];
}

/**
 * Summary row returned by `McpServiceListManager.listAgents()`.
 */
export interface AgentSummary {
  id: string;
  name: string;
  description?: string;
  sceneId?: string;
  primarySkill?: string;
  capabilities?: string[];
  enabled?: boolean;
  toolCount: number;

  // ── M6 fields ────────────────────────────────────────────────────────────
  systemPrompt?: string;
  intents?: string[];
  languages?: string[];
  responseStyle?: string;
  domains?: string[];
}

// ── Delegation Log ───────────────────────────────────────────────────────────

export interface DelegationLogEntry {
  timestamp: string;
  fromAgentId: string;
  toAgentId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  success: boolean;
  output?: unknown;
  allowedServices?: string[];
  canDelegateTo?: string[];
  primarySkill?: string;
  secondarySkills?: string[];
  capabilities?: string[];
  constraints?: string[];
  toolCount: number;
}

/**
 * A single entry in the inter-agent delegation log.
 * The log records every `delegateAs()` call so operators can trace
 * how agents communicate with each other at runtime.
 */
export interface DelegationLogEntry {
  /** ISO 8601 timestamp of when the delegation was issued. */
  timestamp: string;
  /** The agent that initiated the delegation. */
  fromAgentId: string;
  /** The agent that was asked to execute the tool call. */
  toAgentId: string;
  /** The name of the tool that was delegated. */
  toolName: string;
  /** The arguments passed to the tool. */
  arguments: Record<string, unknown>;
  /** Whether the delegated tool call succeeded. */
  success: boolean;
  /** Output from the tool on success. */
  output?: unknown;
  /** Error message from the tool on failure. */
  error?: string;
}

/**
 * Summary row returned by `McpServiceListManager.listScenes()`.
 */
export interface SceneSummary {
  id: string;
  name: string;
  description?: string;
  serviceNames: string[];
  toolCount: number;
}

// ── Plugin Marketplace ───────────────────────────────────────────────────────

/**
 * Describes a downloadable MCP service plugin as published in the registry.
 *
 * In production each plugin would be fetched from an HTTPS endpoint that
 * returns this JSON manifest.  For local development, manifests are seeded
 * directly in the PluginManager registry.
 */
export interface PluginManifest {
  /** Unique, URL-safe plugin identifier (e.g. "weather-service"). */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** Semantic version string, e.g. "1.2.0". */
  version: string;
  /** Author or organisation name. */
  author: string;
  /** Short description shown in the marketplace listing. */
  description: string;
  /** Optional link to documentation or the plugin repository. */
  homepage?: string;
  /** Category tag for UI grouping (e.g. "Productivity", "Developer Tools"). */
  category: string;
  /**
   * URL where the plugin manifest was originally published.
   * Used as a stable identifier and for future re-fetching / update checks.
   */
  registryUrl: string;
  /**
   * Tool definitions the plugin provides once installed.
   * These are wired directly into McpServiceListManager so the LLM can use them.
   */
  tools: ToolDefinition[];
  /**
   * Optional HTTP endpoint the runtime should POST tool-call requests to.
   * When absent, the plugin service falls back to a mock/stub implementation.
   */
  executeEndpoint?: string;
}

/** Installation state of a plugin. */
export type PluginStatus = "available" | "installing" | "installed" | "error";

/**
 * A registry entry that tracks a plugin's manifest and its current status
 * in the local installation.
 */
export interface PluginEntry {
  manifest: PluginManifest;
  status: PluginStatus;
  /** ISO 8601 timestamp of when the plugin was installed, if applicable. */
  installedAt?: string;
  /** Human-readable error message, set when status === "error". */
  error?: string;
}

/**
 * Response shape for plugin list endpoints.
 */
export interface PluginSummary {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  category: string;
  homepage?: string;
  /** Subset of tool definitions (name + description) for display purposes. */
  tools: Array<{ name: string; description: string }>;
  toolCount: number;
  status: PluginStatus;
  installedAt?: string;
}

// ─── Agent Lifecycle Types (M10) ─────────────────────────────────────────────

export type AgentStatus =
  | "initializing"
  | "active"
  | "busy"
  | "sleeping"
  | "retired";

export interface AgentLifecycleRecord {
  agentId: string;
  status: AgentStatus;
  since: string;
  reason?: string;
  resumeAt?: string;
  taskCount: number;
}

export interface AgentLifecycleHistoryEntry {
  agentId: string;
  fromStatus: AgentStatus;
  toStatus: AgentStatus;
  timestamp: string;
  reason?: string;
  triggeredBy?: "manual" | "health-monitor" | "sla-enforcer" | "system";
}

// ─── Health types (M4) ───────────────────────────────────────────────────────

/**
 * Real-time health state of a Service.
 *
 * - "healthy"      — API is responding normally.
 * - "degraded"     — 3–4 consecutive failures; still callable but with reduced confidence.
 * - "degraded"     — 3–4 consecutive failures; still callable with reduced confidence.
 * - "down"         — 5+ consecutive failures; calls are suspended.
 * - "rate-limited" — HTTP 429 received; waiting until rateLimitResetAt.
 * - "unknown"      — No call data yet (initial state after register()).
 */
export type ServiceHealth =
  | "healthy"
  | "degraded"
  | "down"
  | "rate-limited"
  | "unknown";

/**
 * Real-time health record for a single Service.
 */
export interface ServiceHealthRecord {
  serviceName: string;
  /** Current health state */
  health: ServiceHealth;
  /** ISO 8601 timestamp of the last health check */
  lastCheckedAt: string;
  /** Number of consecutive failures */
  consecutiveFailures: number;
  /** Most recent error message */
  lastError?: string;
  /** Rate-limit recovery time (only set when health === "rate-limited") ISO 8601 */
  rateLimitResetAt?: string;
  /** Total number of calls */
  totalCalls: number;
  /** Total number of successful calls */
  totalSuccesses: number;
  /** Success rate (0–1) */
  successRate: number;
// ── M3: Multi-Agent Pipeline ──────────────────────────────────────────────────

export interface PipelineStep {
  agentId: string;
  toolName: string;
  inputMapping?: Record<string, string | { fromStep: number; outputPath: string }>;
  description?: string;
}

export interface AgentPipeline {
  id: string;
  name: string;
  description?: string;
  steps: PipelineStep[];
}

export interface PipelineRunResult {
  pipelineId: string;
  startedAt: string;
  completedAt: string;
  success: boolean;
  /** Per-step results, aligned with the steps array */
  stepResults: Array<{
    stepIndex: number;
    agentId: string;
    toolName: string;
    success: boolean;
    output?: unknown;
    error?: string;
    durationMs: number;
  }>;
  /** Output of the last step (treated as the pipeline's overall output) */
  finalOutput?: unknown;
  /** Index of the first step that failed (set only when success is false) */
  finalOutput?: unknown;
  failedAtStep?: number;
  error?: string;
}
