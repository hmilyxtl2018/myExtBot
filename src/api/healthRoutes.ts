/**
 * src/api/healthRoutes.ts
 *
 * Express Router for Service Health REST API.
 *
 * Routes:
 *   GET  /api/health               → ServiceHealthRecord[]
 *   GET  /api/health/:serviceName  → ServiceHealthRecord | 404
 *   POST /api/health/:serviceName/reset → reset to "healthy"
 */

import { Router, Request, Response } from "express";
import { McpServiceListManager } from "../core/McpServiceListManager";

export function createHealthRoutes(manager: McpServiceListManager): Router {
  const router = Router();

  // GET /api/health
  router.get("/health", (_req: Request, res: Response) => {
    res.json(manager.getAllServiceHealths());
  });

  // GET /api/health/:serviceName
  router.get("/health/:serviceName", (req: Request, res: Response) => {
    const name = req.params["serviceName"] as string;
    const services = manager.listServices();
    if (!services.some((s) => s.name === name)) {
      res.status(404).json({ ok: false, error: `Service "${name}" not found.` });
      return;
    }
    res.json(manager.getServiceHealth(name));
  });

  // POST /api/health/:serviceName/reset
  router.post("/health/:serviceName/reset", (req: Request, res: Response) => {
    const name = req.params["serviceName"] as string;
    const services = manager.listServices();
    if (!services.some((s) => s.name === name)) {
      res.status(404).json({ ok: false, error: `Service "${name}" not found.` });
      return;
    }
    const record = manager.resetServiceHealth(name);
    res.json({ success: true, record });
  });

  return router;
}
