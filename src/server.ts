import express from "express";
import { McpServiceListManager } from "./core/McpServiceListManager";
import { SearchService } from "./services/SearchService";
import { contractRoutes } from "./api/contractRoutes";

const app = express();
app.use(express.json());

// ── Manager setup ─────────────────────────────────────────────────────────────
const manager = new McpServiceListManager();
manager.register(new SearchService());

// ── Routes ────────────────────────────────────────────────────────────────────

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", services: manager.listServices() });
});

// Contract routes
app.use("/api/contracts", contractRoutes(manager));

// Dispatch a tool call
app.post("/api/dispatch/:agentId", async (req, res) => {
  const { agentId } = req.params;
  const toolCall = req.body;

  if (!toolCall?.toolName) {
    res.status(400).json({ error: "Request body must include 'toolName'" });
    return;
  }

  const result = await manager.dispatchAs(agentId, toolCall);
  res.json(result);
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => {
  console.log(`myExtBot server running on http://localhost:${PORT}`);
  console.log(`  GET  /health`);
  console.log(`  GET  /api/contracts`);
  console.log(`  POST /api/contracts/:agentId`);
  console.log(`  GET  /api/contracts/:agentId`);
  console.log(`  DELETE /api/contracts/:agentId`);
  console.log(`  POST /api/contracts/:agentId/check`);
  console.log(`  POST /api/dispatch/:agentId`);
});

export { app, manager };
