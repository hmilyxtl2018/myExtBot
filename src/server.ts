/**
 * Express server for myExtBot.
 *
 * REST API — M6: Agent Intent & Routing
 *
 *   GET /api/agents              — list all registered agents (with M6 fields)
 *   GET /api/agents/route        — recommend agents for a query
 *   GET /api/agents/route/best   — return the single best agent for a query
 *
 * Usage:
 *   npx ts-node src/server.ts
 */

import express, { Request, Response } from "express";
import { McpServiceListManager } from "./core/McpServiceListManager";

const app = express();
app.use(express.json());

// ── Bootstrap example agents ──────────────────────────────────────────────────

const manager = new McpServiceListManager();

manager.registerAgent({
  id: "research-bot",
  name: "Research Bot",
  description: "Specialized in web search and information retrieval.",
  sceneId: "research",
  systemPrompt:
    "你是一个专注于网络信息获取的智能助手。每次回答必须附上信息来源 URL。优先返回最新的信息。",
  intents: [
    "web-search",
    "fact-check",
    "news",
    "research",
    "information-retrieval",
    "搜索",
    "查询",
    "最新",
  ],
  domains: ["research", "information"],
  languages: ["zh-CN", "en-US"],
  responseStyle: "detailed",
  primarySkill: "Web research & information retrieval",
  capabilities: [
    "Search the web",
    "Find latest news",
    "Fact checking",
    "Research topics",
  ],
});

manager.registerAgent({
  id: "dev-bot",
  name: "Dev Bot",
  description: "Runs code snippets and searches for documentation.",
  allowedServices: ["CodeRunnerService", "SearchService"],
  systemPrompt:
    "你是一个专业的编程助手。优先提供可直接运行的代码示例。代码必须有注释。",
  intents: [
    "coding",
    "programming",
    "run-code",
    "debug",
    "script",
    "编程",
    "代码",
    "运行",
  ],
  domains: ["coding", "development"],
  languages: ["zh-CN", "en-US"],
  responseStyle: "markdown",
  primarySkill: "Code execution & technical documentation search",
  capabilities: [
    "Run code snippets",
    "Search documentation",
    "Debug code",
    "Write scripts",
  ],
});

// ── Routes ────────────────────────────────────────────────────────────────────

/** GET /api/agents — list all agents with M6 persona/intent fields */
app.get("/api/agents", (_req: Request, res: Response) => {
  res.json(manager.listAgents());
});

/**
 * GET /api/agents/route
 *   ?query=<string>  (required) — natural-language query
 *   ?topN=<number>   (optional, default 3)
 *
 * Returns AgentRouteSuggestion[]
 */
app.get("/api/agents/route", (req: Request, res: Response) => {
  const query = req.query["query"];
  if (typeof query !== "string" || query.trim() === "") {
    res
      .status(400)
      .json({ error: "Missing required query parameter: query" });
    return;
  }

  const topNRaw = req.query["topN"];
  const topN =
    typeof topNRaw === "string" && /^\d+$/.test(topNRaw)
      ? parseInt(topNRaw, 10)
      : 3;

  res.json(manager.routeAgent(query, topN));
});

/**
 * GET /api/agents/route/best
 *   ?query=<string>  (required)
 *
 * Returns { agentId: string | null, suggestion: AgentRouteSuggestion | null }
 */
app.get("/api/agents/route/best", (req: Request, res: Response) => {
  const query = req.query["query"];
  if (typeof query !== "string" || query.trim() === "") {
    res
      .status(400)
      .json({ error: "Missing required query parameter: query" });
    return;
  }

  const suggestions = manager.routeAgent(query, 1);
  const top = suggestions[0] ?? null;
  const agentId = top && top.score > 0 ? top.agentId : null;

  res.json({
    agentId,
    suggestion: top && top.score > 0 ? top : null,
  });
});

// ── Start server ──────────────────────────────────────────────────────────────

const PORT = process.env["PORT"] ?? 3000;
app.listen(PORT, () => {
  console.log(`myExtBot server running on http://localhost:${PORT}`);
  console.log(`  GET /api/agents`);
  console.log(`  GET /api/agents/route?query=<text>`);
  console.log(`  GET /api/agents/route/best?query=<text>`);
});

export { app, manager };
