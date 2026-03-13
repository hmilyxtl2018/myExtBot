import { McpServiceListManager } from "./core/McpServiceListManager";
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
