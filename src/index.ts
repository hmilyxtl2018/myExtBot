import { McpServiceListManager } from "./core/McpServiceListManager";
import { SearchService } from "./services/SearchService";
import { CalendarService } from "./services/CalendarService";
import { CodeRunnerService } from "./services/CodeRunnerService";
import { PerplexityService } from "./services/PerplexityService";
import { FirecrawlService } from "./services/FirecrawlService";

async function main() {
  // ── 1. Bootstrap the manager and register all services ──────────────────────
  const manager = new McpServiceListManager();
  manager.register(new SearchService());
  manager.register(new CalendarService());
  manager.register(new CodeRunnerService());
  manager.register(new PerplexityService());
  manager.register(new FirecrawlService());

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
    serviceNames: ["SearchService", "CalendarService", "CodeRunnerService", "PerplexityService", "FirecrawlService"],
  });
  manager.registerScene({
    id: "web-intelligence",
    name: "Web Intelligence",
    description: "实时网页搜索与内容抓取，适合需要获取最新信息的任务。",
    serviceNames: ["PerplexityService", "FirecrawlService"],
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

  // Web Intelligence Agent — scoped to the 'web-intelligence' scene
  manager.registerAgent({
    id: "web-intel-agent",
    name: "Web Intelligence Agent",
    description:
      "专门负责网络信息获取：实时搜索（Perplexity）和网页内容抓取（Firecrawl）。",
    sceneId: "web-intelligence",
    primarySkill: "Web research & content extraction",
    capabilities: [
      "Search the web with real-time results and citations",
      "Scrape any webpage and extract clean Markdown content",
      "Monitor websites for content changes",
    ],
    constraints: [
      "Cannot access internal databases",
      "Cannot scrape pages requiring authentication",
    ],
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

  // ── 9. New web intelligence tool demos ──────────────────────────────────────
  console.log("\n=== Web Intelligence demos ===");

  // intelligence_search — graceful error when API key is not configured
  const searchDemo = await manager.dispatch({
    toolName: "intelligence_search",
    arguments: { query: "latest AI agent frameworks 2025", focus: "web" },
  });
  console.log(
    "intelligence_search result:",
    JSON.stringify(searchDemo, null, 2)
  );

  // web_scrape — scrape example.com as a demo
  const scrapeDemo = await manager.dispatch({
    toolName: "web_scrape",
    arguments: { url: "https://example.com", format: "markdown" },
  });
  console.log("web_scrape result:", JSON.stringify(scrapeDemo, null, 2));
}

main().catch(console.error);
