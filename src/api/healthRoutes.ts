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

/**
 * @openapi
 * components:
 *   schemas:
 *     ServiceHealthRecord:
 *       type: object
 *       properties:
 *         serviceName:
 *           type: string
 *         health:
 *           type: string
 *           enum: [healthy, degraded, unhealthy]
 *         lastCheckedAt:
 *           type: string
 *           format: date-time
 *         consecutiveFailures:
 *           type: integer
 *         lastError:
 *           type: string
 *           nullable: true
 *         totalCalls:
 *           type: integer
 *         totalSuccesses:
 *           type: integer
 *         successRate:
 *           type: number
 *           format: float
 */

import { Router, Request, Response } from "express";
import { McpServiceListManager } from "../core/McpServiceListManager";

export function createHealthRoutes(manager: McpServiceListManager): Router {
  const router = Router();

  /**
   * @openapi
   * /api/health:
   *   get:
   *     tags: [Health]
   *     summary: Get health records for all services
   *     description: Returns an array of ServiceHealthRecord for every registered service.
   *     responses:
   *       200:
   *         description: Array of service health records
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 $ref: '#/components/schemas/ServiceHealthRecord'
   */
  router.get("/health", (_req: Request, res: Response) => {
    res.json(manager.getAllServiceHealths());
  });

  /**
   * @openapi
   * /api/health/{serviceName}:
   *   get:
   *     tags: [Health]
   *     summary: Get health record for a single service
   *     parameters:
   *       - in: path
   *         name: serviceName
   *         required: true
   *         schema:
   *           type: string
   *         description: Registered service name
   *     responses:
   *       200:
   *         description: Service health record
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ServiceHealthRecord'
   *       404:
   *         description: Service not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
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

  /**
   * @openapi
   * /api/health/{serviceName}/reset:
   *   post:
   *     tags: [Health]
   *     summary: Reset service health to "healthy"
   *     parameters:
   *       - in: path
   *         name: serviceName
   *         required: true
   *         schema:
   *           type: string
   *         description: Registered service name
   *     responses:
   *       200:
   *         description: Reset successful
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 record:
   *                   $ref: '#/components/schemas/ServiceHealthRecord'
   *       404:
   *         description: Service not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
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
