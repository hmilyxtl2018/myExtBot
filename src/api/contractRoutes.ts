import { Router, Request, Response } from "express";
import { McpServiceListManager } from "../core/McpServiceListManager";
import { AgentContract } from "../core/types";

/**
 * Contract REST API routes.
 *
 * GET    /api/contracts                  → list all contracts
 * GET    /api/contracts/:agentId         → get contract for agent
 * POST   /api/contracts/:agentId         → register/replace contract for agent
 * DELETE /api/contracts/:agentId         → remove contract for agent
 * POST   /api/contracts/:agentId/check   → pre-check without executing
 */

/**
 * @openapi
 * components:
 *   schemas:
 *     AgentSla:
 *       type: object
 *       properties:
 *         maxCostPerCall:
 *           type: number
 *         maxCallsPerMinute:
 *           type: integer
 *         allowedTools:
 *           type: array
 *           items:
 *             type: string
 *         blockedTools:
 *           type: array
 *           items:
 *             type: string
 *     AgentContract:
 *       type: object
 *       required: [agentId, sla]
 *       properties:
 *         agentId:
 *           type: string
 *         sla:
 *           $ref: '#/components/schemas/AgentSla'
 */
export function contractRoutes(manager: McpServiceListManager): Router {
  const router = Router();

  /**
   * @openapi
   * /api/contracts:
   *   get:
   *     tags: [Contracts]
   *     summary: List all agent contracts
   *     responses:
   *       200:
   *         description: Array of AgentContract objects
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 $ref: '#/components/schemas/AgentContract'
   */
  // GET /api/contracts
  router.get("/", (_req: Request, res: Response) => {
    res.json(manager.listContracts());
  });

  /**
   * @openapi
   * /api/contracts/{agentId}:
   *   get:
   *     tags: [Contracts]
   *     summary: Get contract for a specific agent
   *     parameters:
   *       - in: path
   *         name: agentId
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: The agent contract
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/AgentContract'
   *       404:
   *         description: Contract not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  // GET /api/contracts/:agentId
  router.get("/:agentId", (req: Request, res: Response) => {
    const agentId = String(req.params.agentId);
    const contract = manager.getContract(agentId);
    if (!contract) {
      res.status(404).json({ error: `No contract found for agent "${agentId}"` });
      return;
    }
    res.json(contract);
  });

  /**
   * @openapi
   * /api/contracts/{agentId}:
   *   post:
   *     tags: [Contracts]
   *     summary: Register or replace a contract for an agent
   *     parameters:
   *       - in: path
   *         name: agentId
   *         required: true
   *         schema:
   *           type: string
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [sla]
   *             properties:
   *               sla:
   *                 $ref: '#/components/schemas/AgentSla'
   *     responses:
   *       201:
   *         description: Contract registered
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/AgentContract'
   *       400:
   *         description: Missing sla field
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  // POST /api/contracts/:agentId
  router.post("/:agentId", (req: Request, res: Response) => {
    const agentId = String(req.params.agentId);
    const body = req.body as Omit<AgentContract, "agentId">;

    if (!body.sla) {
      res.status(400).json({ error: "Request body must include a 'sla' object" });
      return;
    }

    const contract: AgentContract = { agentId, ...body };
    manager.registerContract(contract);
    res.status(201).json(contract);
  });

  /**
   * @openapi
   * /api/contracts/{agentId}:
   *   delete:
   *     tags: [Contracts]
   *     summary: Remove a contract for an agent
   *     parameters:
   *       - in: path
   *         name: agentId
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Contract removed
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *       404:
   *         description: Contract not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  // DELETE /api/contracts/:agentId
  router.delete("/:agentId", (req: Request, res: Response) => {
    const agentId = String(req.params.agentId);
    const removed = manager.removeContract(agentId);
    if (!removed) {
      res.status(404).json({ error: `No contract found for agent "${agentId}"` });
      return;
    }
    res.json({ success: true });
  });

  /**
   * @openapi
   * /api/contracts/{agentId}/check:
   *   post:
   *     tags: [Contracts]
   *     summary: Pre-check a tool call against an agent's contract (dry run)
   *     parameters:
   *       - in: path
   *         name: agentId
   *         required: true
   *         schema:
   *           type: string
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [toolName]
   *             properties:
   *               toolName:
   *                 type: string
   *     responses:
   *       200:
   *         description: Pre-check result
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 allowed:
   *                   type: boolean
   *                 reason:
   *                   type: string
   *       400:
   *         description: Missing toolName
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       404:
   *         description: Contract not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  // POST /api/contracts/:agentId/check
  router.post("/:agentId/check", (req: Request, res: Response) => {
    const agentId = String(req.params.agentId);
    const { toolName } = req.body as { toolName?: string };

    if (!toolName) {
      res.status(400).json({ error: "Request body must include 'toolName'" });
      return;
    }

    const contract = manager.getContract(agentId);
    if (!contract) {
      res.status(404).json({ error: `No contract found for agent "${agentId}"` });
      return;
    }

    // Access the enforcer via the public accessor
    const enforcer = manager.getContractEnforcer();
    const result = enforcer.preCheck(contract, agentId, toolName);
    res.json(result);
  });

  return router;
}
