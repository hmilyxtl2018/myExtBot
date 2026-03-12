import { Router, Request, Response } from "express";
import { McpServiceListManager } from "../core/McpServiceListManager";
import { AgentStatus } from "../core/types";

/**
 * Create lifecycle routes for the given manager instance.
 *
 * Routes:
 *   GET  /api/agents/statuses           — all agents' current lifecycle records
 *   GET  /api/agents/lifecycle/all      — all agents' lifecycle history
 *   GET  /api/agents/:id/status         — single agent lifecycle record
 *   PATCH /api/agents/:id/status        — manually transition agent status
 *   GET  /api/agents/:id/lifecycle      — single agent lifecycle history
 */
export function createLifecycleRoutes(manager: McpServiceListManager): Router {
  const router = Router();

  // GET /api/agents/statuses
  router.get("/agents/statuses", (_req: Request, res: Response) => {
    res.json(manager.getAllAgentStatuses());
  });

  // GET /api/agents/lifecycle/all
  router.get("/agents/lifecycle/all", (req: Request, res: Response) => {
    const limit = req.query["limit"] ? Number(req.query["limit"]) : undefined;
    res.json(manager.getAllAgentLifecycleHistory(limit));
  });

  // GET /api/agents/:id/status
  router.get("/agents/:id/status", (req: Request, res: Response) => {
    const id = req.params["id"] as string;
    res.json(manager.getAgentStatus(id));
  });

  // PATCH /api/agents/:id/status
  router.patch("/agents/:id/status", (req: Request, res: Response) => {
    const id = req.params["id"] as string;
    const { status, reason } = req.body as {
      status?: AgentStatus;
      reason?: string;
    };

    if (!status) {
      return void res.status(400).json({ error: "Missing required field: status" });
    }

    const validStatuses: AgentStatus[] = [
      "initializing",
      "active",
      "busy",
      "sleeping",
      "retired",
    ];
    if (!validStatuses.includes(status)) {
      return void res.status(400).json({
        error: `Invalid status "${status}". Must be one of: ${validStatuses.join(", ")}`,
      });
    }

    try {
      manager.transitionAgentStatus(id, status, reason);
      res.json({ success: true, record: manager.getAgentStatus(id) });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // GET /api/agents/:id/lifecycle
  router.get("/agents/:id/lifecycle", (req: Request, res: Response) => {
    const id = req.params["id"] as string;
    const limit = req.query["limit"] ? Number(req.query["limit"]) : undefined;
    res.json(manager.getAgentLifecycleHistory(id, limit));
  });

  return router;
}
