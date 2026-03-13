import { Router, Request, Response } from "express";
import { McpServiceListManager } from "../core/McpServiceListManager";
import { AgentStatus } from "../core/types";

const VALID_STATUSES: AgentStatus[] = ["initializing", "active", "busy", "sleeping", "retired"];

function parseLimit(raw: unknown): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export function createLifecycleRoutes(manager: McpServiceListManager): Router {
  const router = Router();

  router.get("/agents/statuses", (_req: Request, res: Response) => {
    res.json(manager.getAllAgentStatuses());
  });

  router.get("/agents/lifecycle/all", (req: Request, res: Response) => {
    const limit = parseLimit(req.query["limit"]);
    res.json(manager.getAllAgentLifecycleHistory(limit));
  });

  router.get("/agents/:id/status", (req: Request, res: Response) => {
    res.json(manager.getAgentStatus(req.params["id"] as string));
  });

  router.patch("/agents/:id/status", (req: Request, res: Response) => {
    const id = req.params["id"] as string;
    const { status, reason } = req.body as { status?: AgentStatus; reason?: string };

    if (!status) {
      return void res.status(400).json({ error: "Missing required field: status" });
    }

    if (!VALID_STATUSES.includes(status)) {
      return void res.status(400).json({
        error: `Invalid status "${status}". Must be one of: ${VALID_STATUSES.join(", ")}`,
      });
    }

    try {
      manager.transitionAgentStatus(id, status, reason);
      res.json({ success: true, record: manager.getAgentStatus(id) });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.get("/agents/:id/lifecycle", (req: Request, res: Response) => {
    const limit = parseLimit(req.query["limit"]);
    res.json(manager.getAgentLifecycleHistory(req.params["id"] as string, limit));
  });

  return router;
}
