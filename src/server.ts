import express from "express";
import { McpServiceListManager } from "./core/McpServiceListManager";
import { McpService, ToolCallRequest, ToolResult } from "./core/types";
import { createLifecycleRoutes } from "./api/lifecycleRoutes";

// ─── Mock Services ──────────────────────────────────────────────────────────

const searchService: McpService = {
  id: "SearchService",
  name: "Search Service",
  tools: [
    {
      name: "search_web",
      description: "Search the web for information",
      inputSchema: { query: { type: "string" } },
    },
  ],
  async call(req: ToolCallRequest): Promise<ToolResult> {
    return {
      toolName: req.toolName,
      result: `[mock] Search results for: ${req.arguments["query"]}`,
    };
  },
};

const calendarService: McpService = {
  id: "CalendarService",
  name: "Calendar Service",
  tools: [
    {
      name: "create_event",
      description: "Create a calendar event",
      inputSchema: { title: { type: "string" }, date: { type: "string" } },
    },
  ],
  async call(req: ToolCallRequest): Promise<ToolResult> {
    return {
      toolName: req.toolName,
      result: `[mock] Event created: ${req.arguments["title"]}`,
    };
  },
};

const codeRunnerService: McpService = {
  id: "CodeRunnerService",
  name: "Code Runner Service",
  tools: [
    {
      name: "run_code",
      description: "Run a code snippet",
      inputSchema: { code: { type: "string" }, language: { type: "string" } },
    },
  ],
  async call(req: ToolCallRequest): Promise<ToolResult> {
    return {
      toolName: req.toolName,
      result: `[mock] Code executed (${req.arguments["language"]}): ${req.arguments["code"]}`,
    };
  },
};

// ─── Bootstrap Manager ──────────────────────────────────────────────────────

const manager = new McpServiceListManager();

manager.registerService(searchService);
manager.registerService(calendarService);
manager.registerService(codeRunnerService);

manager.registerAgent({
  id: "research-bot",
  name: "Research Bot",
  description: "专注于信息搜集和情报分析的分身",
  allowedServices: ["SearchService"],
  canDelegateTo: [],
});

manager.registerAgent({
  id: "dev-bot",
  name: "Dev Bot",
  description: "专注于代码开发和技术任务的分身",
  allowedServices: ["CodeRunnerService"],
  canDelegateTo: ["research-bot"],
});

manager.registerAgent({
  id: "full-agent",
  name: "Full Agent",
  description: "全能分身，可以委托给所有其他分身",
  allowedServices: ["SearchService", "CalendarService", "CodeRunnerService"],
  canDelegateTo: ["*"],
});

manager.registerAgent({
  id: "scheduler-bot",
  name: "Scheduler Bot",
  description: "专注于日程管理的分身",
  allowedServices: ["CalendarService"],
  canDelegateTo: [],
});

// ─── Express App ─────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

// Mount lifecycle routes under /api
app.use("/api", createLifecycleRoutes(manager));

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// List all agents
app.get("/api/agents", (_req, res) => {
  res.json(manager.getAllAgents());
});

// List all services
app.get("/api/services", (_req, res) => {
  res.json(manager.getAllServices());
});

// Dispatch a tool call as an agent
app.post("/api/agents/:id/dispatch", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await manager.dispatchAs(id, req.body as ToolCallRequest);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

const PORT = process.env["PORT"] ?? 3000;
app.listen(PORT, () => {
  console.log(`myExtBot server running on http://localhost:${PORT}`);
  console.log(`  GET  /health`);
  console.log(`  GET  /api/agents`);
  console.log(`  GET  /api/services`);
  console.log(`  GET  /api/agents/statuses`);
  console.log(`  GET  /api/agents/lifecycle/all`);
  console.log(`  GET  /api/agents/:id/status`);
  console.log(`  PATCH /api/agents/:id/status`);
  console.log(`  GET  /api/agents/:id/lifecycle`);
  console.log(`  POST /api/agents/:id/dispatch`);
});
