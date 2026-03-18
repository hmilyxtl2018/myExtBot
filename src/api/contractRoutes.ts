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
export function contractRoutes(manager: McpServiceListManager): Router {
  const router = Router();

  // GET /api/contracts
  router.get("/", (_req: Request, res: Response) => {
    res.json(manager.listContracts());
  });

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
