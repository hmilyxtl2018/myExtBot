import express from "express";
import { McpServiceListManager } from "./core/McpServiceListManager";
import { createPipelineRouter } from "./api/pipelineRoutes";

const app = express();
app.use(express.json());

export const manager = new McpServiceListManager();

// ── Mount pipeline routes ────────────────────────────────────────────────────
app.use("/api/pipelines", createPipelineRouter(manager));

// ── Health check ─────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// ── Start server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT ?? 3000;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`myExtBot server listening on http://localhost:${PORT}`);
  });
}

export default app;
