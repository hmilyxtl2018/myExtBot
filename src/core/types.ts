/**
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
  error?: string;
}
