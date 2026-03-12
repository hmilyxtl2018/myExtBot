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
