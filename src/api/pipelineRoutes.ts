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
export function createPipelineRouter(manager: McpServiceListManager): Router {
  const router = Router();

  // GET /api/pipelines
  router.get("/", (_req: Request, res: Response) => {
    res.json(manager.listPipelines());
  });

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

  // GET /api/pipelines/:id
  router.get("/:id", (req: Request, res: Response) => {
    const pipeline = manager.getPipeline(req.params.id);
    if (!pipeline) {
      res.status(404).json({ success: false, error: "Pipeline not found" });
      return;
    }
    res.json(pipeline);
  });

  // DELETE /api/pipelines/:id
  router.delete("/:id", (req: Request, res: Response) => {
    const deleted = manager.unregisterPipeline(req.params.id);
    if (!deleted) {
      res.status(404).json({ success: false, error: "Pipeline not found" });
      return;
    }
    res.json({ success: true });
  });

  // POST /api/pipelines/:id/run
  router.post("/:id/run", async (req: Request, res: Response) => {
    const { initialInput } = req.body as {
      initialInput?: Record<string, unknown>;
    };

    const runResult = await manager.runPipeline(req.params.id, initialInput);

    if (!runResult.success && runResult.stepResults.length === 0) {
      // Pipeline not found (or other setup error)
      res.status(404).json(runResult);
      return;
    }

    res.json(runResult);
  });

  return router;
}
