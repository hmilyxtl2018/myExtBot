import type { McpServiceListManager } from "./McpServiceListManager";
import type {
  Scene,
  SceneTrigger,
  SceneTriggerResult,
  ServiceHealth,
  TriggerContext,
} from "./types";

/**
 * Trigger weights — higher weight = higher priority in scoring.
 *
 * - health  : 4 (system anomaly has highest priority)
 * - keyword : 3 (most direct expression of user intent)
 * - agent   : 2 (current agent context)
 * - time    : 1 (background condition, lowest priority)
 */
const TRIGGER_WEIGHTS: Record<SceneTrigger["type"], number> = {
  health: 4,
  keyword: 3,
  agent: 2,
  time: 1,
};

/**
 * SceneTriggerEngine — evaluates trigger conditions across all registered
 * Scenes and returns an ordered list of Scene recommendations.
 */
export class SceneTriggerEngine {
  constructor(private manager: McpServiceListManager) {}

  /**
   * Evaluates all registered Scenes against the provided context and returns
   * a list of matching Scenes sorted by descending score.
   * Only Scenes with at least one matching trigger are included.
   */
  evaluate(context: TriggerContext): SceneTriggerResult[] {
    const scenes = this.manager.getScenes();
    const results: SceneTriggerResult[] = [];

    const resolvedTime = context.currentTime ?? this.getCurrentTime();
    const resolvedHealths = context.serviceHealths ?? {};

    for (const scene of scenes) {
      if (!scene.triggers || scene.triggers.length === 0) continue;

      const matchedTriggers: SceneTriggerResult["matchedTriggers"] = [];
      let score = 0;

      for (const trigger of scene.triggers) {
        const match = this.evaluateTrigger(
          trigger,
          context,
          resolvedTime,
          resolvedHealths
        );
        if (match !== null) {
          matchedTriggers.push(match);
          score += TRIGGER_WEIGHTS[trigger.type];
        }
      }

      if (matchedTriggers.length > 0) {
        results.push({
          sceneId: scene.id,
          sceneName: scene.name,
          matchedTriggers,
          score,
        });
      }
    }

    // Sort descending by score
    results.sort((a, b) => b.score - a.score);
    return results;
  }

  /**
   * Returns the ID of the best-matching Scene, or undefined if none match.
   */
  bestScene(context: TriggerContext): string | undefined {
    const results = this.evaluate(context);
    return results.length > 0 ? results[0].sceneId : undefined;
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  /**
   * Evaluates a single trigger against the context.
   * Returns a matched-trigger descriptor on success, or null on no match.
   */
  private evaluateTrigger(
    trigger: SceneTrigger,
    context: TriggerContext,
    resolvedTime: string,
    resolvedHealths: Record<string, ServiceHealth>
  ): { type: SceneTrigger["type"]; reason: string } | null {
    switch (trigger.type) {
      case "keyword": {
        const input = context.userInput ?? "";
        if (!this.matchKeywords(trigger, input)) return null;
        const matched = (trigger.keywords ?? []).filter((kw) =>
          input.toLowerCase().includes(kw.toLowerCase())
        );
        return {
          type: "keyword",
          reason: `关键词匹配: ${matched.join(", ")}`,
        };
      }
      case "time": {
        if (!this.matchTimeRange(trigger, resolvedTime)) return null;
        return {
          type: "time",
          reason: `时间范围匹配: ${trigger.timeRange?.start} – ${trigger.timeRange?.end} (当前 ${resolvedTime})`,
        };
      }
      case "agent": {
        if (!this.matchAgent(trigger, context.activeAgentId)) return null;
        return {
          type: "agent",
          reason: `Agent 匹配: ${trigger.agentId}`,
        };
      }
      case "health": {
        if (!this.matchHealth(trigger, resolvedHealths)) return null;
        return {
          type: "health",
          reason: `健康条件匹配: ${trigger.condition}`,
        };
      }
      default:
        return null;
    }
  }

  /** Returns true when the user input contains at least one of the keywords. */
  private matchKeywords(trigger: SceneTrigger, input: string): boolean {
    if (!trigger.keywords || trigger.keywords.length === 0) return false;
    const lowerInput = input.toLowerCase();
    return trigger.keywords.some((kw) =>
      lowerInput.includes(kw.toLowerCase())
    );
  }

  /**
   * Returns true when `currentTime` (zero-padded HH:MM, e.g. "09:05") falls
   * within the trigger's timeRange (inclusive on both ends).
   *
   * Supports overnight ranges where start > end (e.g. "22:00"–"06:00").
   * Both `currentTime` and the range boundaries **must** be zero-padded HH:MM
   * strings for the lexicographic comparison to work correctly.
   */
  private matchTimeRange(
    trigger: SceneTrigger,
    currentTime: string
  ): boolean {
    if (!trigger.timeRange) return false;
    const { start, end } = trigger.timeRange;
    // Compare as "HH:MM" strings (lexicographic order works for zero-padded time)
    if (start <= end) {
      return currentTime >= start && currentTime <= end;
    }
    // Overnight range (e.g. 22:00 – 06:00)
    return currentTime >= start || currentTime <= end;
  }

  /** Returns true when activeAgentId matches the trigger's agentId. */
  private matchAgent(
    trigger: SceneTrigger,
    activeAgentId?: string
  ): boolean {
    if (!trigger.agentId || activeAgentId === undefined) return false;
    return trigger.agentId === activeAgentId;
  }

  /**
   * Returns true when the health condition is satisfied.
   * - "any-service-down"      : at least one service has status "down"
   * - "all-services-healthy"  : all services have status "healthy"
   */
  private matchHealth(
    trigger: SceneTrigger,
    healthMap: Record<string, ServiceHealth>
  ): boolean {
    if (!trigger.condition) return false;
    const statuses = Object.values(healthMap);
    if (statuses.length === 0) return false;

    switch (trigger.condition) {
      case "any-service-down":
        return statuses.some((s) => s === "down");
      case "all-services-healthy":
        return statuses.every((s) => s === "healthy");
      default:
        return false;
    }
  }

  /** Returns the current local time formatted as HH:MM. */
  private getCurrentTime(): string {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }
}

/** Re-export Scene for convenience so consumers can import from one place. */
export type { Scene };
