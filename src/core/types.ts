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
  stepResults: Array<{
    stepIndex: number;
    agentId: string;
    toolName: string;
    success: boolean;
    output?: unknown;
    error?: string;
    durationMs: number;
  }>;
  finalOutput?: unknown;
  failedAtStep?: number;
  error?: string;
}
