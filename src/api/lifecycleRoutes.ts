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

  /**
   * @openapi
   * /api/agents/statuses:
   *   get:
   *     tags: [Lifecycle]
   *     summary: Get current status of all agents
   *     responses:
   *       200:
   *         description: Map of agentId to AgentStatus
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               additionalProperties:
   *                 type: string
   *                 enum: [initializing, active, busy, sleeping, retired]
   */
  router.get("/agents/statuses", (_req: Request, res: Response) => {
    res.json(manager.getAllAgentStatuses());
  });

  /**
   * @openapi
   * /api/agents/lifecycle/all:
   *   get:
   *     tags: [Lifecycle]
   *     summary: Get lifecycle history for all agents
   *     parameters:
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           minimum: 1
   *         description: Maximum number of history entries to return
   *     responses:
   *       200:
   *         description: Lifecycle history records
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 type: object
   */
  router.get("/agents/lifecycle/all", (req: Request, res: Response) => {
    const limit = parseLimit(req.query["limit"]);
    res.json(manager.getAllAgentLifecycleHistory(limit));
  });

  /**
   * @openapi
   * /api/agents/{id}/status:
   *   get:
   *     tags: [Lifecycle]
   *     summary: Get current lifecycle status of an agent
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Agent ID
   *     responses:
   *       200:
   *         description: Current status record
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   */
  router.get("/agents/:id/status", (req: Request, res: Response) => {
    res.json(manager.getAgentStatus(req.params["id"] as string));
  });

  /**
   * @openapi
   * /api/agents/{id}/status:
   *   patch:
   *     tags: [Lifecycle]
   *     summary: Transition an agent to a new lifecycle status
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Agent ID
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [status]
   *             properties:
   *               status:
   *                 type: string
   *                 enum: [initializing, active, busy, sleeping, retired]
   *               reason:
   *                 type: string
   *     responses:
   *       200:
   *         description: Transition successful
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 record:
   *                   type: object
   *       400:
   *         description: Invalid status or transition error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
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

  /**
   * @openapi
   * /api/agents/{id}/lifecycle:
   *   get:
   *     tags: [Lifecycle]
   *     summary: Get lifecycle history for a specific agent
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Agent ID
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           minimum: 1
   *         description: Maximum number of history entries to return
   *     responses:
   *       200:
   *         description: Lifecycle history for the agent
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 type: object
   */
  router.get("/agents/:id/lifecycle", (req: Request, res: Response) => {
    const limit = parseLimit(req.query["limit"]);
    res.json(manager.getAgentLifecycleHistory(req.params["id"] as string, limit));
  });

  return router;
}
