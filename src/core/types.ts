/**
 * Core types for myExtBot digital avatar asset system.
 */

// ── Service types ─────────────────────────────────────────────────────────────

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

// ── Tool types ────────────────────────────────────────────────────────────────

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
  /** Estimated cost per call in USD (optional, used by ContractEnforcer) */
  estimatedCostPerCall?: number;
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
  /** Estimated cost in USD for this call (optional, populated by CostLedger integration) */
  estimatedCost?: number;
}

/** Minimal interface every MCP Service must implement. */
export interface McpService {
  /** Unique service name, e.g. "PerplexityService" */
  readonly name: ServiceName;
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

// ── Agent Lifecycle types ─────────────────────────────────────────────────────

/** Lifecycle state of an Agent. */
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

// ── Service Health types ──────────────────────────────────────────────────────

/**
 * Health status of a service.
 * - "healthy"      — API is responding normally.
 * - "degraded"     — 3–4 consecutive failures; still callable but with reduced confidence.
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
}

// ── Scene types ───────────────────────────────────────────────────────────────

/**
 * Scene trigger — describes when to automatically recommend activating this Scene.
 */
export interface SceneTrigger {
  /** Trigger type */
  type: "keyword" | "time" | "agent" | "health";

  /** When user input contains these keywords (case-insensitive). */
  keywords?: string[];

  /**
   * Time range (local time HH:MM zero-padded).
   * Supports overnight ranges where start > end.
   */
  timeRange?: { start: string; end: string };

  /** When the specified Agent is being called. */
  agentId?: string;

  /**
   * Health condition:
   * - "any-service-down": any Service becomes "down"
   * - "all-services-healthy": all Services return to "healthy"
   */
  condition?: "any-service-down" | "all-services-healthy";
}

/**
 * A Scene groups one or more services by use-case.
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
   */
  serviceNames: string[];
  /**
   * Optional trigger conditions for automatic scene recommendation.
   */
  triggers?: SceneTrigger[];
}

/**
 * SceneTriggerEngine evaluation context.
 */
export interface TriggerContext {
  /** User input (for keyword triggers) */
  userInput?: string;
  /** Current local time (HH:MM, for time triggers). */
  currentTime?: string;
  /** Currently active Agent ID (for agent triggers) */
  activeAgentId?: string;
  /** Service health status map (for health triggers). */
  serviceHealths?: Record<string, ServiceHealth>;
}

/**
 * Scene trigger evaluation result.
 */
export interface SceneTriggerResult {
  sceneId: string;
  sceneName: string;
  /** Matched triggers */
  matchedTriggers: Array<{
    type: SceneTrigger["type"];
    reason: string;
  }>;
  /** Total score (matched trigger count × trigger weight) */
  score: number;
}

/** Alias for backward compatibility */
export type TriggerResult = SceneTriggerResult;

/**
 * Summary row returned by listScenes().
 */
export interface SceneSummary {
  id: string;
  name: string;
  description?: string;
  serviceNames: string[];
  toolCount: number;
}

// ── Pillar 7: Communication Protocol ─────────────────────────────────────────

/** Unified message type bridging TS DelegationLogEntry and Rust MsgType. */
export type MessageType =
  | "delegation"
  | "task-assigned"
  | "task-update"
  | "task-result"
  | "ping"
  | "notification"
  | "query"
  | "response";

/** Pillar 7: Communication Protocol — defines how this agent communicates. */
export interface CommunicationConfig {
  delegationTargets?: string[];
  supportedMessageTypes?: MessageType[];
  protocolVersion?: string;
  channel?: "in-memory" | "sqlite" | "both";
}

// ── Pillar 8: Orchestration Config ────────────────────────────────────────────

export interface PipelineParticipation {
  pipelineId: string;
  stepIndexes: number[];
  role: "executor" | "coordinator" | "fallback";
}

export interface RoutingConfig {
  intents?: string[];
  domains?: string[];
  languages?: string[];
  responseStyle?: "concise" | "detailed" | "bullet-points" | "markdown";
  minConfidence?: number;
}

/** Pillar 8: Orchestration Config — how this agent participates in workflows. */
export interface OrchestrationConfig {
  pipelines?: PipelineParticipation[];
  sceneAffinities?: string[];
  routing?: RoutingConfig;
  maxConcurrentTasks?: number;
  priority?: number;
}

// ── Pillar 9: Memory & Observability ─────────────────────────────────────────

/** Pillar 9: Memory & Observability — how this agent learns and is monitored. */
export interface MemoryConfig {
  knowledgeDb?: {
    enabled: boolean;
    autoPromoteThreshold?: number;
    maxEntries?: number;
    /** Auto-retire entries older than this many minutes. Disabled when omitted. */
    autoRetireAfterMinutes?: number;
  };
  costTracking?: {
    enabled: boolean;
    dailyBudget?: number;
    alertThreshold?: number;
  };
  lineageTracking?: {
    enabled: boolean;
    maxDepth?: number;
    includeArguments?: boolean;
  };
  healthMonitoring?: {
    enabled: boolean;
    degradedThreshold?: number;
    downThreshold?: number;
    autoRetireAfterMinutes?: number;
  };
}

// ── Agent Profile ─────────────────────────────────────────────────────────────

/**
 * Full profile of a registered digital-persona Agent.
 *
 * Pillars 1-6 are defined as direct fields; Pillars 7-9 are optional config objects.
 */
export interface AgentProfile {
  // ── Pillar 1: Identity ─────────────────────────────────────────────────────
  /** Unique identifier for this agent (e.g. "research-bot"). */
  id: string;
  /** Human-readable display name (e.g. "Research Bot"). */
  name: string;
  /** Optional description of the agent's purpose or persona. */
  description?: string;

  // ── Pillar 2: Scene / Context ──────────────────────────────────────────────
  /** Optional scene this agent is associated with. */
  sceneId?: string;
  /**
   * Explicit list of service names this agent is allowed to use.
   * If omitted (and no sceneId), the agent can use all enabled services.
   */
  allowedServices?: string[];

  // ── Pillar 3: Delegation ───────────────────────────────────────────────────
  /**
   * IDs of other agents this agent is permitted to delegate tasks to.
   * Use ["*"] to allow delegation to any registered agent.
   */
  canDelegateTo?: string[];

  // ── Pillar 4: Capabilities ─────────────────────────────────────────────────
  /** The agent's single most important skill / specialty. */
  primarySkill?: string;
  /** Supporting skills, listed in priority order. */
  secondarySkills?: string[];
  /** High-level capabilities the agent exposes, as action phrases. */
  capabilities?: string[];
  /** Hard limits or behavioural guardrails for this agent. */
  constraints?: string[];

  // ── Pillar 5: Persona / LLM ────────────────────────────────────────────────
  /** System prompt injected to the LLM when running as this agent. */
  systemPrompt?: string;

  // ── Pillar 6: Routing / Intent ─────────────────────────────────────────────
  /** Intent tags used by AgentRouter for routing. */
  intents?: string[];
  /** Languages this agent is proficient in. */
  languages?: string[];
  /** The agent's preferred response style. */
  responseStyle?: "concise" | "detailed" | "bullet-points" | "markdown";
  /** High-level domain tags (coarser-grained than intents). */
  domains?: string[];

  /** Whether this agent is currently active (default: true). */
  enabled?: boolean;

  // ── Pillar 7: Communication ────────────────────────────────────────────────
  communication?: CommunicationConfig;

  // ── Pillar 8: Orchestration ────────────────────────────────────────────────
  orchestration?: OrchestrationConfig;

  // ── Pillar 9: Memory & Observability ──────────────────────────────────────
  memory?: MemoryConfig;
}

/**
 * Lightweight summary of an AgentProfile returned by listAgents().
 */
export interface AgentSummary {
  id: string;
  name: string;
  description?: string;
  sceneId?: string;
  primarySkill?: string;
  secondarySkills?: string[];
  capabilities?: string[];
  constraints?: string[];
  enabled?: boolean;
  toolCount: number;
  allowedServices?: string[];
  canDelegateTo?: string[];
  // Pillar 5-6
  systemPrompt?: string;
  intents?: string[];
  languages?: string[];
  responseStyle?: string;
  domains?: string[];
  // Pillar 7-9
  communication?: CommunicationConfig;
  orchestration?: OrchestrationConfig;
  memory?: MemoryConfig;
}

// ── Delegation types ──────────────────────────────────────────────────────────

/** A single delegation event recorded in the log. */
export interface DelegationLogEntry {
  /** Unique entry ID */
  id?: string;
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
  /** Output from the tool on success */
  output?: unknown;
  /** Error message if success === false */
  error?: string;
  /** Execution duration in milliseconds */
  durationMs?: number;
  /** Optional session ID for grouping related delegations */
  sessionId?: string;
}

/** A tool call request used in delegation. */
export interface DelegationRequest {
  toolName: string;
  arguments: Record<string, unknown>;
}

/** Full delegation log record (used in older pipeline-style delegation). */
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

// ── SLA Contract types ────────────────────────────────────────────────────────

/**
 * Agent SLA contract.
 */
export interface AgentContract {
  /** Bound Agent ID */
  agentId: string;

  sla: {
    /** Max response time per call (ms). */
    maxResponseTimeMs?: number;
    /** Max cost per call (USD). */
    maxCostPerCall?: number;
    /** Max daily accumulated cost (USD). */
    maxDailyCost?: number;
    /** Max calls per minute (sliding window). */
    maxCallsPerMinute?: number;
    /**
     * Retry policy:
     * - "none": no retry
     * - "once": retry once on failure
     * - "exponential-backoff": up to 3 retries with 1s/2s/4s delays
     */
    retryPolicy?: "none" | "once" | "exponential-backoff";
  };

  fallback?: {
    /** Agent to delegate to on SLA violation */
    agentId?: string;
    /** Whether to return partial result on timeout */
    returnPartialResult?: boolean;
  };

  alertThresholds?: {
    /** Emit warn log when usage reaches this fraction of the limit (e.g. 0.8 = 80%) */
    warnAt?: number;
  };
}

/**
 * Result of a single contract pre-check.
 */
export interface ContractCheckResult {
  allowed: boolean;
  /** Which rule was violated if allowed === false */
  violatedRule?: "timeout" | "cost-per-call" | "daily-cost" | "rate-limit";
  reason?: string;
}

// ── Cost types ────────────────────────────────────────────────────────────────

/** A single tool call cost record. */
export interface CostEntry {
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Agent ID (undefined for direct dispatch) */
  agentId?: string;
  /** Tool name */
  toolName: string;
  /** Service name */
  serviceName: string;
  /** Cost in USD */
  cost: number;
  /** Whether the call succeeded */
  success: boolean;
  /** Optional metadata */
  metadata?: {
    tokensUsed?: number;
    durationMs?: number;
    charsProcessed?: number;
  };
}

/** Cost summary report. */
export interface CostSummary {
  totalCost: number;
  totalCalls: number;
  successfulCalls: number;
  /** Cost grouped by Agent */
  byAgent: Record<string, { cost: number; calls: number }>;
  /** Cost grouped by Tool */
  byTool: Record<string, { cost: number; calls: number }>;
  /** Cost grouped by Service */
  byService: Record<string, { cost: number; calls: number }>;
  /** Date range of the query */
  dateRange: { start: string; end: string };
}

/** Tool call request (used in dispatch). */
export interface DispatchRequest {
  toolName: string;
  serviceName?: string;
  args?: Record<string, unknown>;
  metadata?: {
    tokensUsed?: number;
    charsProcessed?: number;
  };
}

/** Tool call result (used in dispatch). */
export interface DispatchResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

// ── Pipeline types ────────────────────────────────────────────────────────────

/**
 * A single execution step within a Pipeline.
 */
export interface PipelineStep {
  /** ID of the agent that will execute this step */
  agentId: string;
  /** Name of the tool to invoke */
  toolName: string;
  /**
   * Parameter mapping for the tool call.
   */
  inputMapping?: Record<string, string | { fromStep: number; outputPath: string }>;
  /** Human-readable description of this step (optional) */
  description?: string;
}

/**
 * Definition of an Agent Pipeline — an ordered list of steps executed sequentially.
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
  failedAtStep?: number;
  error?: string;
}

// ── Lineage Graph types ───────────────────────────────────────────────────────

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
  /** Optional label */
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
 * Summary of a lineage graph.
 */
export interface LineageGraphSummary {
  totalNodes: number;
  totalEdges: number;
  agentNodes: string[];
  toolNodes: string[];
  successRate: number;
  timeRange: { earliest: string; latest: string };
}

// ── Plugin types ──────────────────────────────────────────────────────────────

/**
 * Describes a downloadable MCP service plugin.
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
  /** Category tag for UI grouping. */
  category: string;
  /**
   * URL where the plugin manifest was originally published.
   */
  registryUrl: string;
  /**
   * Tool definitions the plugin provides once installed.
   */
  tools: ToolDefinition[];
  /**
   * Optional HTTP endpoint for tool-call requests.
   */
  executeEndpoint?: string;
  /**
   * Request timeout in milliseconds. Defaults to 30 000 ms (30 s) when not set.
   */
  timeout?: number;
  /**
   * Retry configuration for transient (5xx / network) failures.
   * Defaults to { maxRetries: 3, backoffMs: 1000 } when not set.
   */
  retryConfig?: { maxRetries: number; backoffMs: number };
}

/** Installation state of a plugin. */
export type PluginStatus = "available" | "installing" | "installed" | "error";

/**
 * A registry entry that tracks a plugin's manifest and its current status.
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
  /** Subset of tool definitions for display. */
  tools: Array<{ name: string; description: string }>;
  toolCount: number;
  status: PluginStatus;
  installedAt?: string;
}

// ── AgentSpec: Complete 9-Pillar Specification ────────────────────────────────

/** Valid control-loop execution strategies for an agent. */
export type ControlLoopType = "plan-act" | "react" | "reflexion" | "custom";

/** A tool declaration inside an AgentSpec (Pillar 3). */
export interface AgentSpecTool {
  /** Unique tool name within this agent. */
  name: string;
  [key: string]: unknown;
}

/** Runtime guardrails for an AgentSpec (Pillar 4). */
export interface AgentSpecGuardrails {
  /** Maximum number of tokens consumed per LLM call (must be > 0). */
  maxTokensPerCall?: number;
  /** Maximum monetary cost allowed per call in USD (must be > 0). */
  maxCostPerCall?: number;
  /** Whether a human must approve the action before execution. */
  requireHumanApproval?: boolean;
}

/** Prompt templates for an AgentSpec (Pillar 5). */
export interface AgentSpecPrompts {
  /** System prompt injected to the LLM for this agent. */
  system?: string;
}

/** A scored domain entry for Pillar 6 (Intent & Persona). */
export interface AgentSpecDomain {
  /** Domain label (e.g. "finance", "legal"). */
  name: string;
  /** Confidence score in [0, 1]. */
  score: number;
}

/**
 * The complete 9-Pillar Agent Specification.
 * Extends AgentProfile; Pillars 1-6 are inherited, Pillars 7-9 are declared here.
 *
 * Note: `communication`, `orchestration`, and `memory` are already present as
 * optional fields in `AgentProfile`. They are re-declared here intentionally so
 * that the `AgentSpec` interface explicitly documents all 9 pillars in one place,
 * making it the authoritative, self-describing contract for a fully-specified agent.
 */
export interface AgentSpec extends AgentProfile {
  // Pillars 1-6 are inherited from AgentProfile

  // Pillar 1 addition — semantic version string (e.g. "1.2.3")
  version?: string;

  // Pillar 2 — Control Loop
  controlLoop?: {
    type: ControlLoopType;
  };

  // Pillar 3 — Tools declared by this agent
  tools?: AgentSpecTool[];

  // Pillar 4 — Runtime guardrails
  guardrails?: AgentSpecGuardrails;

  // Pillar 5 — Prompt templates
  prompts?: AgentSpecPrompts;

  // Pillars 7-9 (re-declared for explicit documentation; same as AgentProfile fields):
  communication?: CommunicationConfig;
  orchestration?: OrchestrationConfig;
  memory?: MemoryConfig;
}
