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
   * @openapi
   * /api/scenes/auto-detect:
   *   post:
   *     tags: [Scene Triggers]
   *     summary: Evaluate all scene triggers against the given context
   *     description: Returns a ranked list of matching Scenes (highest score first).
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             description: TriggerContext — arbitrary key/value pairs describing the current context
   *     responses:
   *       200:
   *         description: Array of SceneTriggerResult ordered by score descending
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 type: object
   *                 properties:
   *                   sceneId:
   *                     type: string
   *                   score:
   *                     type: number
   */
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
   * @openapi
   * /api/scenes/best-match:
   *   post:
   *     tags: [Scene Triggers]
   *     summary: Get the single best-matching scene for the given context
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             description: TriggerContext — arbitrary key/value pairs describing the current context
   *     responses:
   *       200:
   *         description: The best matching scene or null
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 sceneId:
   *                   type: string
   *                   nullable: true
   *                 result:
   *                   type: object
   *                   nullable: true
   */
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
