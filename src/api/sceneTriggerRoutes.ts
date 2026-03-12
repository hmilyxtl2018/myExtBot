import { Router, Request, Response } from "express";
import type { McpServiceListManager } from "../core/McpServiceListManager";
import type { TriggerContext } from "../core/types";

/**
 * Creates and returns an Express Router with the Scene trigger REST endpoints.
 *
 * POST /api/scenes/auto-detect
 *   Body : TriggerContext
 *   Response : SceneTriggerResult[]
 *
 * POST /api/scenes/best-match
 *   Body : TriggerContext
 *   Response : { sceneId: string | null, result: SceneTriggerResult | null }
 */
export function createSceneTriggerRoutes(
  manager: McpServiceListManager
): Router {
  const router = Router();

  /**
   * POST /api/scenes/auto-detect
   *
   * Evaluates all Scene triggers against the provided context and returns a
   * ranked list of matching Scenes.
   */
  router.post(
    "/auto-detect",
    (req: Request, res: Response): void => {
      const context: TriggerContext = req.body ?? {};
      const results = manager.autoDetectScene(context);
      res.json(results);
    }
  );

  /**
   * POST /api/scenes/best-match
   *
   * Returns the single best-matching Scene (highest score) for the given
   * context, or null values when nothing matches.
   */
  router.post(
    "/best-match",
    (req: Request, res: Response): void => {
      const context: TriggerContext = req.body ?? {};
      const results = manager.autoDetectScene(context);
      const best = results.length > 0 ? results[0] : null;
      res.json({
        sceneId: best?.sceneId ?? null,
        result: best,
      });
    }
  );

  return router;
}
