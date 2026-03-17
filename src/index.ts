/**
 * src/index.ts
 *
 * myExtBot — Digital Avatar Asset System entry point.
 * Demonstrates M4: Service Health Monitoring.
 */

import { McpServiceListManager } from "./core/McpServiceListManager";
import { SearchService } from "./services/SearchService";
import { PerplexityService } from "./services/PerplexityService";

async function main(): Promise<void> {
  const manager = new McpServiceListManager();

  // ── 1. Register Services ────────────────────────────────────────────────────
  const searchService = new SearchService();
  const perplexityService = new PerplexityService();

  manager.register(searchService);
  manager.register(perplexityService);

  console.log("Registered services:", manager.listServices());

  // ── 2. Initial health state (should be "unknown") ───────────────────────────
  console.log(
    "\n=== Initial Health (should be 'unknown') ==="
  );
  console.log(JSON.stringify(manager.getAllServiceHealths(), null, 2));

  // ── 3. Successful call → health becomes "healthy" ───────────────────────────
  console.log("\n=== Successful call to PerplexityService ===");
  const successResult = await manager.dispatch("PerplexityService", {
    query: "What is myExtBot?",
  });
  console.log("Result:", successResult);
  console.log(
    "Health after success:",
    manager.getServiceHealth("PerplexityService").health
  );

  // ── 4. Simulate 3 failures → "degraded" ────────────────────────────────────
  console.log("\n=== Simulating 3 failures (expect 'degraded') ===");
  process.env.PERPLEXITY_SIMULATE_FAILURE = "true";
  for (let i = 1; i <= 3; i++) {
    await manager.dispatch("PerplexityService", { query: "test" });
    console.log(
      `  After failure #${i}: ${manager.getServiceHealth("PerplexityService").health}`
    );
  }
  delete process.env.PERPLEXITY_SIMULATE_FAILURE;

  // ── 5. Simulate 2 more failures → "down" ───────────────────────────────────
  console.log("\n=== Simulating 2 more failures (expect 'down') ===");
  process.env.PERPLEXITY_SIMULATE_FAILURE = "true";
  for (let i = 4; i <= 5; i++) {
    await manager.dispatch("PerplexityService", { query: "test" });
    console.log(
      `  After failure #${i}: ${manager.getServiceHealth("PerplexityService").health}`
    );
  }
  delete process.env.PERPLEXITY_SIMULATE_FAILURE;

  // ── 6. Dispatch to "down" service → fallback to SearchService ──────────────
  console.log(
    "\n=== Dispatch to 'down' PerplexityService (expect fallback to SearchService) ==="
  );
  const fallbackResult = await manager.dispatch("PerplexityService", {
    query: "fallback demo",
  });
  console.log("Fallback result:", fallbackResult);

  // ── 7. Rate-limit simulation ────────────────────────────────────────────────
  console.log("\n=== Simulating 429 Rate Limit ===");
  manager.resetServiceHealth("PerplexityService");
  process.env.PERPLEXITY_SIMULATE_RATE_LIMIT = "true";
  const rateLimitResult = await manager.dispatch("PerplexityService", {
    query: "rate limit demo",
  });
  console.log("Rate-limit result:", rateLimitResult);
  console.log(
    "Health after 429:",
    manager.getServiceHealth("PerplexityService").health
  );
  delete process.env.PERPLEXITY_SIMULATE_RATE_LIMIT;

  // ── 8. Manual health reset ───────────────────────────────────────────────────
  console.log("\n=== Manual health reset ===");
  const resetRecord = manager.resetServiceHealth("PerplexityService");
  console.log("Health after reset:", resetRecord.health);

  // ── 9. dispatchAs demo ───────────────────────────────────────────────────────
  console.log("\n=== dispatchAs demo ===");
  const delegateResult = await manager.dispatchAs(
    "intelligence-agent",
    "PerplexityService",
    { query: "dispatchAs demo" }
  );
  console.log("delegateAs result:", delegateResult);

  // ── 17. Service Health Demo ───────────────────────────────────────────────────
  console.log("\n=== Service Health Status ===");
  console.log(JSON.stringify(manager.getAllServiceHealths(), null, 2));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
import { McpServiceListManager } from "./core/McpServiceListManager";
import { McpService, ServiceResult } from "./core/types";

// ─────────────────────────────────────────────────────────────────────────────
// Helper: create a mock McpService for demo purposes
// ─────────────────────────────────────────────────────────────────────────────
function mockService(
  id: string,
  toolName: string,
  handler: (args: Record<string, unknown>) => ServiceResult
): McpService {
  return {
    id,
    name: id,
    tools: [{ name: toolName, description: `Mock tool: ${toolName}` }],
    async call(name: string, args: Record<string, unknown>): Promise<ServiceResult> {
      if (name !== toolName) {
        return { success: false, error: `Unknown tool: ${name}` };
      }
      return handler(args);
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap
// ─────────────────────────────────────────────────────────────────────────────
const manager = new McpServiceListManager();

// ── 1. Register mock services ─────────────────────────────────────────────────
manager.registerService(
  mockService("SearchService", "search_web", (args) => ({
    success: true,
    output: {
      results: [
        { url: "https://example.com/1", title: `Result for: ${args.query}` },
        { url: "https://example.com/2", title: "MCP pipeline best practices" },
        { url: "https://example.com/3", title: "Multi-agent orchestration" },
      ],
    },
  }))
);

manager.registerService(
  mockService("CodeRunnerService", "run_code", (args) => ({
    success: true,
    output: {
      stdout: `Processed ${JSON.stringify(args.code).slice(0, 80)}…`,
      exitCode: 0,
    },
  }))
);

// ── 2. Register agents ────────────────────────────────────────────────────────
manager.registerAgent({
  id: "research-bot",
  name: "Research Bot",
  description: "Specialized in web search and information retrieval",
  allowedServices: ["SearchService"],
  canDelegateTo: [],
  systemPrompt: "You are a research assistant. Find accurate, up-to-date information.",
  intents: ["web-search", "fact-check", "research"],
import { McpServiceListManager, BaseService } from "./core/McpServiceListManager";
import { ToolCall, ToolDefinition, ToolResult } from "./core/types";

// ── Mock services for demo purposes ──────────────────────────────────────────

class SearchService extends BaseService {
  readonly name = "research-bot";

  getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: "search_web",
        description: "Search the web for information.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
            maxResults: { type: "number", description: "Maximum results" },
          },
          required: ["query"],
        },
      },
    ];
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    if (call.toolName === "search_web") {
      return {
        success: true,
        output: {
          query: call.arguments["query"],
          results: [
            { title: "Lineage Graph Patterns", url: "https://example.com/1" },
            { title: "Call Graph Visualization", url: "https://example.com/2" },
          ],
        },
      };
    }
    return { success: false, error: `Unknown tool: ${call.toolName}` };
  }
}

class CodeRunnerService extends BaseService {
  readonly name = "dev-bot";

  getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: "run_code",
        description: "Run a code snippet and return the output.",
        parameters: {
          type: "object",
          properties: {
            language: { type: "string", description: "Programming language" },
            code: { type: "string", description: "Code to execute" },
          },
          required: ["language", "code"],
        },
      },
    ];
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    if (call.toolName === "run_code") {
      return {
        success: true,
        output: {
          language: call.arguments["language"],
          stdout: "lineage test",
          exitCode: 0,
        },
      };
    }
    return { success: false, error: `Unknown tool: ${call.toolName}` };
  }
}

// ── Main demo ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const manager = new McpServiceListManager();
  manager.register(new SearchService());
  manager.register(new CodeRunnerService());

  console.log("=== myExtBot — M9 Lineage Graph Demo ===\n");

  // ── 21. Lineage Graph Demo ────────────────────────────────────────────────
  // Generate delegation data via delegateAs()
  await manager.delegateAs("full-agent", "research-bot", {
    toolName: "search_web",
    arguments: { query: "lineage graph patterns", maxResults: 2 },
  });
  await manager.delegateAs("full-agent", "dev-bot", {
    toolName: "run_code",
    arguments: { language: "typescript", code: "console.log('lineage test')" },
  });

  const graph = manager.buildLineageGraph();
  console.log("=== Lineage Graph ===");
  console.log(
    JSON.stringify({ nodeCount: graph.nodeCount, edgeCount: graph.edgeCount }, null, 2)
  );

  console.log("\n=== Mermaid Export ===");
  console.log(manager.exportLineageMermaid());

  console.log("\n=== DOT Export ===");
  console.log(manager.exportLineageDOT());

  console.log("\n=== Summary ===");
  console.log(JSON.stringify(manager.getLineageSummary(), null, 2));

  console.log("\n=== Full Graph (JSON) ===");
  console.log(manager.exportLineageJSON());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
/**
 * src/index.ts — myExtBot entry point / demo.
 *
 * Demonstrates M6: Agent Intent & Persona
 *  - Registering agents with systemPrompt, intents, domains, and responseStyle
 *  - Intent-driven routing via AgentRouter
 */

import { McpServiceListManager } from "./core/McpServiceListManager";

const manager = new McpServiceListManager();

// ─── Register base scenes ─────────────────────────────────────────────────────

manager.registerScene({
  id: "research",
  name: "Research",
  description: "Deep information search and web crawling.",
  serviceNames: ["SearchService", "FirecrawlService"],
});

manager.registerScene({
  id: "dev",
  name: "Development",
  description: "Code execution and technical documentation lookup.",
  serviceNames: ["CodeRunnerService", "FirecrawlService", "PerplexityService"],
});

// ─── Re-register with triggers (demo) ────────────────────────────────────────

manager.registerScene({
  id: "research-triggered",
  name: "Research (with triggers)",
  description: "Auto-activates when user wants to search for information.",
  serviceNames: ["SearchService"],
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
  id: "degraded",
  name: "Degraded Mode",
  description: "Fallback scene when services are down.",
  serviceNames: ["SearchService"], // 只保留最基础的服务
  triggers: [
    {
      type: "health",
      condition: "any-service-down",
    },
  ],
});

// ─── Scene Auto-Detection Demo ────────────────────────────────────────────────

console.log("\n=== Scene Auto-Detection Demo ===");

const suggestions = manager.autoDetectScene({
  userInput: "帮我搜索一下最新的 AI 新闻",
});
console.log("Suggested scenes for '帮我搜索一下最新的 AI 新闻':");
console.log(JSON.stringify(suggestions, null, 2));

const best = manager.bestSceneForContext({ userInput: "search for latest news" });
console.log("Best scene:", best);

// Health trigger demo
const healthSuggestions = manager.autoDetectScene({
  serviceHealths: {
    SearchService: "down",
    FirecrawlService: "healthy",
  },
});
console.log("\nSuggested scenes when SearchService is down:");
console.log(JSON.stringify(healthSuggestions, null, 2));

// Agent trigger demo (no match expected with basic setup)
const agentSuggestions = manager.autoDetectScene({
  activeAgentId: "dev-agent",
});
console.log("\nSuggested scenes when dev-agent is active:");
console.log(JSON.stringify(agentSuggestions, null, 2));
// ── Register agents with M6 persona/intent fields ────────────────────────────

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
  description: "Specialized in code execution and analysis",
  allowedServices: ["CodeRunnerService"],
  canDelegateTo: ["research-bot"],
  systemPrompt: "You are a software engineer. Write clean, efficient code.",
  intents: ["run-code", "code-analysis"],
});

manager.registerAgent({
  id: "full-agent",
  name: "Full Agent",
  description: "Orchestrator with access to all other agents",
  allowedServices: ["SearchService", "CodeRunnerService"],
  canDelegateTo: ["*"],
  systemPrompt: "You are a general-purpose assistant. Delegate to specialists when appropriate.",
  intents: ["orchestrate", "general"],
});

// ── 3. Simple dispatchAs demo ─────────────────────────────────────────────────
async function runDemo(): Promise<void> {
  console.log("=== myExtBot — Multi-Agent Pipeline Demo ===\n");

  // Direct dispatch
  const searchResult = await manager.dispatchAs("research-bot", {
    toolName: "search_web",
    arguments: { query: "MCP agent pipeline patterns", maxResults: 3 },
  });
  console.log("Direct search dispatch result:");
  console.log(JSON.stringify(searchResult, null, 2));

  // ── 16. Multi-Agent Pipeline Demo ────────────────────────────────────────────
  manager.registerPipeline({
    id: "research-and-summarize",
    name: "Research & Summarize",
    description: "Search the web, then summarize the results.",
    steps: [
      {
        agentId: "research-bot",
        toolName: "search_web",
        description: "Step 1: Search for the topic",
        inputMapping: {
          query: "MCP agent pipeline patterns",
          maxResults: "3",
        },
      },
      {
        agentId: "dev-bot",
        toolName: "run_code",
        description: "Step 2: Process the search results",
        inputMapping: {
          language: "javascript",
          // Use the output from step 0
          code: { fromStep: 0, outputPath: "results" },
        },
      },
    ],
  });

  const pipelineResult = await manager.runPipeline("research-and-summarize", {});
  console.log("\n=== Pipeline Run Result ===");
  console.log(JSON.stringify(pipelineResult, null, 2));

  // ── Delegation log ────────────────────────────────────────────────────────────
  console.log("\n=== Delegation Logs ===");
  const logs = manager.getDelegationLogs();
  logs.forEach((log) => {
    console.log(
      `[${log.id}] ${log.fromAgentId} → ${log.toAgentId} :: ${log.toolName} (${log.durationMs}ms)`
    );
  });
}

runDemo().catch(console.error);
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

// ── List all registered agents ───────────────────────────────────────────────

console.log("=== Registered Agents ===");
console.log(JSON.stringify(manager.listAgents(), null, 2));

// ── Agent Routing Demo ────────────────────────────────────────────────────────

console.log("\n=== Agent Routing Demo ===");

console.log("\nQuery: '帮我搜索最新的 AI 新闻'");
console.log(JSON.stringify(manager.routeAgent("帮我搜索最新的 AI 新闻"), null, 2));

console.log("\nQuery: 'write a python script'");
console.log(JSON.stringify(manager.routeAgent("write a python script"), null, 2));

console.log("\nBest match for '查询天气':", manager.bestAgentForQuery("查询天气"));

console.log("\nBest match for 'debug my code':", manager.bestAgentForQuery("debug my code"));

console.log("\nBest match for 'search for news':", manager.bestAgentForQuery("search for news"));
import { McpServiceListManager } from "./core/McpServiceListManager";

async function main() {
  const manager = new McpServiceListManager();

  // ── 1. dispatch() — 直接调用工具（agentId 为 undefined）────────────────────
  console.log("=== dispatch: intelligence_search ===");
  await manager.dispatch({
    toolName: "intelligence_search",
    serviceName: "PerplexityService",
    args: { query: "TypeScript best practices 2024" },
  });

  // ── 2. dispatch() — 免费工具 ───────────────────────────────────────────────
  console.log("=== dispatch: search_web (free) ===");
  await manager.dispatch({
    toolName: "search_web",
    serviceName: "SearchService",
    args: { query: "open source MCP tools" },
  });

  // ── 3. dispatchAs() — 以 research-bot 身份调用 ────────────────────────────
  console.log("=== dispatchAs: research-bot → intelligence_search ===");
  await manager.dispatchAs("research-bot", {
    toolName: "intelligence_search",
    serviceName: "PerplexityService",
    args: { query: "Agent cost management patterns" },
  });

  // ── 4. dispatchAs() — 以 dev-bot 身份调用 Firecrawl ──────────────────────
  console.log("=== dispatchAs: dev-bot → web_scrape ===");
  await manager.dispatchAs("dev-bot", {
    toolName: "web_scrape",
    serviceName: "FirecrawlService",
    args: { url: "https://example.com" },
  });

  // ── 5. dispatchAs() — 以 research-bot 身份再次调用 ────────────────────────
  console.log("=== dispatchAs: research-bot → web_crawl ===");
  await manager.dispatchAs("research-bot", {
    toolName: "web_crawl",
    serviceName: "FirecrawlService",
    args: { url: "https://docs.example.com" },
  });

  // ── 6. dispatchAs() — translate_text（per-char 计费）──────────────────────
  console.log("=== dispatchAs: translator-bot → translate_text ===");
  await manager.dispatchAs("translator-bot", {
    toolName: "translate_text",
    serviceName: "TranslationService",
    args: { text: "Hello, world!", targetLang: "zh" },
    metadata: { charsProcessed: 13 },
  });

  // ── 7. getDailyCostForAgent ────────────────────────────────────────────────
  const ledger = manager.getCostLedger();
  const researchBotCost = ledger.getDailyCostForAgent("research-bot");
  console.log(`\n=== research-bot 今日累计成本: $${researchBotCost.toFixed(6)} ===`);

  // ── 8. 验收检查 ────────────────────────────────────────────────────────────
  const summary = manager.getCostSummary();

  console.log("\n=== Acceptance Checks ===");

  // 检查1: intelligence_search 后 totalCost > 0
  const check1 = summary.totalCost > 0;
  console.log(`[${check1 ? "✅" : "❌"}] totalCost > 0: $${summary.totalCost.toFixed(6)}`);

  // 检查2: research-bot byAgent 成本 > 0
  const researchBotSummary = summary.byAgent["research-bot"];
  const check2 = researchBotSummary !== undefined && researchBotSummary.cost > 0;
  console.log(`[${check2 ? "✅" : "❌"}] byAgent["research-bot"].cost > 0: $${researchBotSummary?.cost.toFixed(6) ?? 0}`);

  // 检查3: search_web cost = 0
  const searchWebSummary = summary.byTool["search_web"];
  const check3 = searchWebSummary !== undefined && searchWebSummary.cost === 0;
  console.log(`[${check3 ? "✅" : "❌"}] byTool["search_web"].cost === 0`);

  // 检查4: getDailyCostForAgent("research-bot") 正确
  const dailyCost = ledger.getDailyCostForAgent("research-bot");
  const check4 = dailyCost === (researchBotSummary?.cost ?? -1);
  console.log(`[${check4 ? "✅" : "❌"}] getDailyCostForAgent("research-bot") = $${dailyCost.toFixed(6)}`);

  // ── 18. Cost Ledger Demo ──────────────────────────────────────────────────────
  console.log("\n=== Cost Summary ===");
  console.log(JSON.stringify(manager.getCostSummary(), null, 2));
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
import { SearchService } from "./services/SearchService";
import { CalendarService } from "./services/CalendarService";
import { CodeRunnerService } from "./services/CodeRunnerService";

async function main() {
  // ── 1. Bootstrap the manager and register all services ──────────────────────
  const manager = new McpServiceListManager();
  manager.register(new SearchService());
  manager.register(new CalendarService());
  manager.register(new CodeRunnerService());

  // ── 2. Inspect registered services ──────────────────────────────────────────
  console.log("=== Registered Services ===");
  console.log(JSON.stringify(manager.listServices(), null, 2));

  // ── 3. Show the unified tool definitions list (sent to the LLM) ─────────────
  console.log("\n=== Tool Definitions (for LLM) ===");
  console.log(JSON.stringify(manager.getToolDefinitions(), null, 2));

  // ── 4. Demonstrate dynamic enable/disable ───────────────────────────────────
  console.log("\n=== Disabling CodeRunnerService ===");
  manager.disableService("CodeRunnerService");
  console.log("Active tools:", manager.getToolDefinitions().map((t) => t.name));

  manager.enableService("CodeRunnerService");
  console.log("After re-enable:", manager.getToolDefinitions().map((t) => t.name));

  // ── 5. Register Scenes ───────────────────────────────────────────────────────
  manager.registerScene({
    id: "research",
    name: "Research",
    description: "Web research and information gathering tasks.",
    serviceNames: ["SearchService"],
  });
  manager.registerScene({
    id: "productivity",
    name: "Productivity",
    description: "Calendar and scheduling tasks.",
    serviceNames: ["CalendarService"],
  });
  manager.registerScene({
    id: "dev",
    name: "Development",
    description: "Coding, scripting, and automation tasks.",
    serviceNames: ["CodeRunnerService"],
  });
  manager.registerScene({
    id: "full",
    name: "Full Access",
    description: "All services available — for power users.",
    serviceNames: ["SearchService", "CalendarService", "CodeRunnerService"],
  });

  console.log("\n=== Scenes ===");
  console.log(JSON.stringify(manager.listScenes(), null, 2));

  console.log("\n=== Tools in 'research' scene ===");
  console.log(manager.getToolDefinitionsForScene("research").map((t) => t.name));

  // ── 6. Register Agents ───────────────────────────────────────────────────────
  // Research Bot — scoped to the 'research' scene
  manager.registerAgent({
    id: "research-bot",
    name: "Research Bot",
    description: "Specialized in web search and information retrieval.",
    sceneId: "research",
  });

  // Scheduling Assistant — scoped to the 'productivity' scene
  manager.registerAgent({
    id: "scheduling-assistant",
    name: "Scheduling Assistant",
    description: "Manages calendar events and scheduling.",
    sceneId: "productivity",
  });

  // Dev Bot — explicitly lists the services it needs (overrides scene)
  manager.registerAgent({
    id: "dev-bot",
    name: "Dev Bot",
    description: "Runs code snippets and searches for documentation.",
    allowedServices: ["CodeRunnerService", "SearchService"],
  });

  // Full Agent — no restrictions; has access to all services
  manager.registerAgent({
    id: "full-agent",
    name: "Full Agent",
    description: "Unrestricted access to all registered services.",
    sceneId: "full",
  });

  console.log("\n=== Agents ===");
  console.log(JSON.stringify(manager.listAgents(), null, 2));

  console.log("\n=== Tools available to 'research-bot' ===");
  console.log(manager.getToolDefinitionsForAgent("research-bot").map((t) => t.name));

  console.log("\n=== Tools available to 'dev-bot' ===");
  console.log(manager.getToolDefinitionsForAgent("dev-bot").map((t) => t.name));

  // ── 7. Simulate LLM tool_call dispatch ──────────────────────────────────────
  console.log("\n=== Dispatching tool calls ===");

  const searchResult = await manager.dispatch({
    toolName: "search_web",
    arguments: { query: "MCP protocol overview", maxResults: 2 },
  });
  console.log("search_web result:", JSON.stringify(searchResult, null, 2));

  const calendarResult = await manager.dispatch({
    toolName: "create_event",
    arguments: {
      title: "Architecture Review",
      startTime: "2024-06-01T10:00:00Z",
      endTime: "2024-06-01T11:00:00Z",
      description: "Review the MCP Services List Manager design.",
    },
  });
  console.log("create_event result:", JSON.stringify(calendarResult, null, 2));

  const codeResult = await manager.dispatch({
    toolName: "run_code",
    arguments: { language: "typescript", code: 'console.log("Hello, MCP!")' },
  });
  console.log("run_code result:", JSON.stringify(codeResult, null, 2));

  // ── 8. Agent-scoped dispatch ─────────────────────────────────────────────────
  console.log("\n=== Agent-scoped dispatch ===");

  // research-bot is allowed to call search_web
  const agentSearch = await manager.dispatchAs("research-bot", {
    toolName: "search_web",
    arguments: { query: "LLM agent design patterns", maxResults: 1 },
  });
  console.log("research-bot → search_web:", JSON.stringify(agentSearch, null, 2));

  // research-bot is NOT allowed to call run_code — should throw
  try {
    await manager.dispatchAs("research-bot", {
      toolName: "run_code",
      arguments: { language: "python", code: "print(42)" },
    });
  } catch (err) {
    console.log("research-bot blocked from run_code ✓:", (err as Error).message);
  }

  // dev-bot CAN call run_code
  const devResult = await manager.dispatchAs("dev-bot", {
    toolName: "run_code",
    arguments: { language: "python", code: "print(42)" },
  });
  console.log("dev-bot → run_code:", JSON.stringify(devResult, null, 2));
}

main().catch(console.error);
