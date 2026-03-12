/**
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
}
