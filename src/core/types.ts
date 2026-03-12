/**
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
}

// ─── Health types (M4) ───────────────────────────────────────────────────────

/**
 * Real-time health state of a Service.
 *
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
