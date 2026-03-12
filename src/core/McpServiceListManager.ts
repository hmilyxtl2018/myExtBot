import { SceneTriggerEngine } from "./SceneTriggerEngine";
import type { Scene, SceneTriggerResult, TriggerContext } from "./types";

/**
 * McpServiceListManager — manages the registry of Scenes and exposes
 * scene-lookup and trigger-evaluation capabilities.
 */
export class McpServiceListManager {
  private scenes: Map<string, Scene> = new Map();
  private triggerEngine = new SceneTriggerEngine(this);

  // ─── Scene registry ────────────────────────────────────────────────────────

  /**
   * Registers (or replaces) a Scene in the manager.
   * The Scene may optionally include trigger conditions.
   */
  registerScene(scene: Scene): void {
    this.scenes.set(scene.id, scene);
  }

  /** Returns a Scene by ID, or undefined if not found. */
  getScene(id: string): Scene | undefined {
    return this.scenes.get(id);
  }

  /** Returns all registered Scenes as an array. */
  getScenes(): Scene[] {
    return Array.from(this.scenes.values());
  }

  /** Removes a Scene from the registry. Returns true if it existed. */
  removeScene(id: string): boolean {
    return this.scenes.delete(id);
  }

  // ─── Trigger evaluation ────────────────────────────────────────────────────

  /**
   * Evaluates all registered Scenes against the provided context and returns
   * a ranked list of recommendations (descending score).
   */
  autoDetectScene(context: TriggerContext): SceneTriggerResult[] {
    return this.triggerEngine.evaluate(context);
  }

  /**
   * Returns the ID of the best-matching Scene for the given context,
   * or undefined if no Scene matches.
   */
  bestSceneForContext(context: TriggerContext): string | undefined {
    return this.triggerEngine.bestScene(context);
  }
}
