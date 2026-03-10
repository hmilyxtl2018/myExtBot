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

  // ── 5. Simulate LLM tool_call dispatch ──────────────────────────────────────
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
}

main().catch(console.error);
