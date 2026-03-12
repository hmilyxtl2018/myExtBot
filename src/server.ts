import express from "express";
import { McpServiceListManager } from "./core/McpServiceListManager";
import { createLineageRoutes } from "./api/lineageRoutes";

const app = express();
const rawPort = process.env.PORT;
const PORT = rawPort && /^\d+$/.test(rawPort) ? parseInt(rawPort, 10) : 3000;

app.use(express.json());

// Create a shared manager instance
const manager = new McpServiceListManager();

// Mount lineage routes
app.use("/api/lineage", createLineageRoutes(manager));

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`myExtBot server running on http://localhost:${PORT}`);
  console.log(`  GET /api/lineage          — full graph (JSON/Mermaid/DOT)`);
  console.log(`  GET /api/lineage/mermaid  — Mermaid text`);
  console.log(`  GET /api/lineage/summary  — summary statistics`);
});

export { manager };
