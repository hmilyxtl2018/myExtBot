import { Router, Request, Response } from "express";
import { McpServiceListManager } from "../core/McpServiceListManager";
import { AgentPipeline } from "../core/types";

export function createPipelineRoutes(manager: McpServiceListManager): Router {
  const router = Router();

  router.get("/pipelines", (_req: Request, res: Response) => {
    res.json(manager.listPipelines());
  });

  router.post("/pipelines", (req: Request, res: Response) => {
    const body = req.body as Partial<AgentPipeline>;
    if (!body.id || !body.name || !Array.isArray(body.steps)) {
      res.status(400).json({ ok: false, error: "id, name, and steps are required" });
      return;
    }
    try {
      manager.registerPipeline(body as AgentPipeline);
      res.json({ ok: true, pipeline: manager.getPipeline(body.id) });
    } catch (e) {
      res.status(400).json({ ok: false, error: (e as Error).message });
    }
  });

  router.get("/pipelines/:id", (req: Request, res: Response) => {
    const pipeline = manager.getPipeline(String(req.params.id));
    if (!pipeline) {
      res.status(404).json({ ok: false, error: `Pipeline "${req.params.id}" not found.` });
      return;
    }
    res.json(pipeline);
  });

  router.delete("/pipelines/:id", (req: Request, res: Response) => {
    const deleted = manager.unregisterPipeline(String(req.params.id));
    if (!deleted) {
      res.status(404).json({ ok: false, error: `Pipeline "${req.params.id}" not found.` });
      return;
    }
    res.json({ ok: true });
  });

  router.post("/pipelines/:id/run", async (req: Request, res: Response) => {
    const { initialInput } = req.body as { initialInput?: Record<string, unknown> };
    try {
      const result = await manager.runPipeline(String(req.params.id), initialInput);
      res.json(result);
    } catch (e) {
      res.status(400).json({ ok: false, error: (e as Error).message });
    }
  });

  return router;
}
