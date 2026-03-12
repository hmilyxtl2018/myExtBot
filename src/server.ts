import express from "express";
import { McpServiceListManager } from "./core/McpServiceListManager";
import { createSceneTriggerRoutes } from "./api/sceneTriggerRoutes";

const app = express();
app.use(express.json());

const manager = new McpServiceListManager();

// ─── Register demo scenes ─────────────────────────────────────────────────────

manager.registerScene({
  id: "research",
  name: "Research",
  description: "Deep information search and web crawling.",
  serviceNames: ["SearchService", "FirecrawlService"],
  triggers: [
    {
      type: "keyword",
      keywords: ["搜索", "查一下", "search", "find", "最新", "news", "research"],
    },
    {
      type: "time",
      timeRange: { start: "08:00", end: "20:00" },
    },
  ],
});

manager.registerScene({
  id: "dev",
  name: "Development",
  description: "Code execution and technical documentation lookup.",
  serviceNames: ["CodeRunnerService", "FirecrawlService", "PerplexityService"],
  triggers: [
    {
      type: "keyword",
      keywords: ["代码", "编程", "code", "run", "execute", "debug", "compile"],
    },
    {
      type: "agent",
      agentId: "dev-agent",
    },
  ],
});

manager.registerScene({
  id: "degraded",
  name: "Degraded Mode",
  description: "Minimal fallback scene activated when services are unhealthy.",
  serviceNames: ["SearchService"],
  triggers: [
    {
      type: "health",
      condition: "any-service-down",
    },
  ],
});

manager.registerScene({
  id: "full",
  name: "Full Mode",
  description: "All services available — activated when everything is healthy.",
  serviceNames: [
    "SearchService",
    "FirecrawlService",
    "PerplexityService",
    "CodeRunnerService",
  ],
  triggers: [
    {
      type: "health",
      condition: "all-services-healthy",
    },
  ],
});

// ─── Mount routes ─────────────────────────────────────────────────────────────

app.use("/api/scenes", createSceneTriggerRoutes(manager));

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// ─── Export for programmatic use (e.g. index.ts demo) ─────────────────────────

export { app, manager };

// ─── Start server only when run directly ─────────────────────────────────────

if (require.main === module) {
  const PORT = process.env.PORT ?? 3000;
  app.listen(PORT, () => {
    console.log(`myExtBot server running on http://localhost:${PORT}`);
  });
}
