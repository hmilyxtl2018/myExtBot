import { Router, Request, Response } from "express";
import { McpServiceListManager } from "../core/McpServiceListManager";
import { AgentPipeline } from "../core/types";

/**
 * pipelineRoutes — REST API for registering and running Agent Pipelines.
 *
 * GET    /api/pipelines           → list all pipelines
 * POST   /api/pipelines           → register a new pipeline
 * GET    /api/pipelines/:id       → get a pipeline by id
 * DELETE /api/pipelines/:id       → unregister a pipeline
 * POST   /api/pipelines/:id/run   → run a pipeline
 */

/**
 * @openapi
 * components:
 *   schemas:
 *     PipelineStep:
 *       type: object
 *       required: [agentId, toolName]
 *       properties:
 *         agentId:
 *           type: string
 *         toolName:
 *           type: string
 *         arguments:
 *           type: object
 *     AgentPipeline:
 *       type: object
 *       required: [id, name, steps]
 *       properties:
 *         id:
 *           type: string
 *         name:
 *           type: string
 *         description:
 *           type: string
 *         steps:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/PipelineStep'
 */
export function createPipelineRouter(manager: McpServiceListManager): Router {
  const router = Router();

  /**
   * @openapi
   * /api/pipelines:
   *   get:
   *     tags: [Pipelines]
   *     summary: List all registered pipelines
   *     responses:
   *       200:
   *         description: Array of AgentPipeline objects
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 $ref: '#/components/schemas/AgentPipeline'
   */
  // GET /api/pipelines
  router.get("/", (_req: Request, res: Response) => {
    res.json(manager.listPipelines());
  });

  /**
   * @openapi
   * /api/pipelines:
   *   post:
   *     tags: [Pipelines]
   *     summary: Register a new agent pipeline
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/AgentPipeline'
   *     responses:
   *       201:
   *         description: Pipeline registered successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 pipeline:
   *                   $ref: '#/components/schemas/AgentPipeline'
   *       400:
   *         description: Validation error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  // POST /api/pipelines
  router.post("/", (req: Request, res: Response) => {
    const pipeline = req.body as AgentPipeline;

    if (!pipeline || !pipeline.id || !pipeline.name || !Array.isArray(pipeline.steps)) {
      res.status(400).json({
        success: false,
        error: "Invalid pipeline: id, name, and steps are required",
      });
      return;
    }

    manager.registerPipeline(pipeline);
    res.status(201).json({ success: true, pipeline });
  });

  /**
   * @openapi
   * /api/pipelines/{id}:
   *   get:
   *     tags: [Pipelines]
   *     summary: Get a pipeline by ID
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: The pipeline object
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/AgentPipeline'
   *       404:
   *         description: Pipeline not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  // GET /api/pipelines/:id
  router.get("/:id", (req: Request, res: Response) => {
    const pipeline = manager.getPipeline(req.params["id"] as string);
    if (!pipeline) {
      res.status(404).json({ success: false, error: "Pipeline not found" });
      return;
    }
    res.json(pipeline);
  });

  /**
   * @openapi
   * /api/pipelines/{id}:
   *   delete:
   *     tags: [Pipelines]
   *     summary: Unregister (delete) a pipeline
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Pipeline deleted
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/SuccessOk'
   *       404:
   *         description: Pipeline not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  // DELETE /api/pipelines/:id
  router.delete("/:id", (req: Request, res: Response) => {
    const deleted = manager.unregisterPipeline(req.params["id"] as string);
    if (!deleted) {
      res.status(404).json({ success: false, error: "Pipeline not found" });
      return;
    }
    res.json({ success: true });
  });

  /**
   * @openapi
   * /api/pipelines/{id}/run:
   *   post:
   *     tags: [Pipelines]
   *     summary: Execute a pipeline
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     requestBody:
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               initialInput:
   *                 type: object
   *                 description: Initial input data passed to the first step
   *     responses:
   *       200:
   *         description: Pipeline run result
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 stepResults:
   *                   type: array
   *                   items:
   *                     type: object
   *       404:
   *         description: Pipeline not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  // POST /api/pipelines/:id/run
  router.post("/:id/run", async (req: Request, res: Response) => {
    const { initialInput } = req.body as {
      initialInput?: Record<string, unknown>;
    };

    const runResult = await manager.runPipeline(req.params["id"] as string, initialInput);

    if (!runResult.success && runResult.stepResults.length === 0) {
      res.status(404).json(runResult);
      return;
    }

    res.json(runResult);
  });

  return router;
}

/** Alias for createPipelineRouter (backward compatibility). */
export const createPipelineRoutes = createPipelineRouter;

