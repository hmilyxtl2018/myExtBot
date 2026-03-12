import { McpServiceListManager } from "./core/McpServiceListManager";
import { McpService, ToolCallRequest, ToolResult } from "./core/types";

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

// ─── Bootstrap ───────────────────────────────────────────────────────────────

async function main() {
  const manager = new McpServiceListManager();

  // ── 1. Register Services ────────────────────────────────────────────────────
  console.log("=== Registering Services ===");
  manager.registerService(searchService);
  manager.registerService(calendarService);
  manager.registerService(codeRunnerService);
  console.log(manager.getAllServices().map((s) => s.name));

  // ── 2. Register Agents ──────────────────────────────────────────────────────
  console.log("\n=== Registering Agents ===");
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

  console.log(manager.getAllAgents().map((a) => a.name));

  // ── 3. Dispatch a tool call ─────────────────────────────────────────────────
  console.log("\n=== Dispatch: research-bot → search_web ===");
  const searchResult = await manager.dispatchAs("research-bot", {
    toolName: "search_web",
    arguments: { query: "MCP protocol" },
  });
  console.log(searchResult);

  // ── 4. Delegate across agents ───────────────────────────────────────────────
  console.log("\n=== Delegate: dev-bot → research-bot → search_web ===");
  const delegateResult = await manager.delegateAs(
    "dev-bot",
    "research-bot",
    { toolName: "search_web", arguments: { query: "TypeScript generics" } }
  );
  console.log(delegateResult);

  // ── 14. Agent Lifecycle Demo ─────────────────────────────────────────────────
  console.log("\n=== Agent Lifecycle Statuses ===");
  console.log(JSON.stringify(manager.getAllAgentStatuses(), null, 2));

  // 手动挂起 research-bot（模拟 API key 失效）
  manager.transitionAgentStatus(
    "research-bot",
    "sleeping",
    "API key expired — pending renewal"
  );
  console.log("\n=== research-bot sleeping ===");
  console.log(manager.getAgentStatus("research-bot"));

  // sleeping 时调用应该被拒绝
  try {
    await manager.dispatchAs("research-bot", {
      toolName: "search_web",
      arguments: { query: "test" },
    });
  } catch (err) {
    console.log(
      "research-bot sleeping — call rejected ✓:",
      (err as Error).message
    );
  }

  // 唤醒 research-bot
  manager.transitionAgentStatus("research-bot", "active", "API key renewed");

  // 查看历史
  console.log("\n=== research-bot lifecycle history ===");
  console.log(
    JSON.stringify(manager.getAgentLifecycleHistory("research-bot"), null, 2)
  );

  // 验证非法状态转换
  console.log("\n=== Testing invalid transition: active → retired → active ===");
  manager.transitionAgentStatus("dev-bot", "retired", "permanent shutdown");
  try {
    manager.transitionAgentStatus("dev-bot", "active", "attempt to revive");
  } catch (err) {
    console.log("Illegal transition caught ✓:", (err as Error).message);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
