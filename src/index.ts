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
