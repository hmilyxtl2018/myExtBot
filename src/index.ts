import { McpServiceListManager } from "./core/McpServiceListManager";
import { SearchService } from "./services/SearchService";
import { CalendarService } from "./services/CalendarService";
import { CodeRunnerService } from "./services/CodeRunnerService";
import { createServer } from "./server";

async function main(): Promise<void> {
  console.log("=".repeat(60));
  console.log("  myExtBot — Digital Twin Asset System");
  console.log("=".repeat(60));

  // ── 1. Bootstrap the manager ─────────────────────────────────────────────────
  const manager = new McpServiceListManager();
  manager.register(new SearchService());
  manager.register(new CalendarService());
  manager.register(new CodeRunnerService());

  // ── 2. Start the HTTP server ──────────────────────────────────────────────────
  createServer(manager);

  // ── 3. Register Scenes ────────────────────────────────────────────────────────
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
    description: "All services — for power users.",
    serviceNames: ["SearchService", "CalendarService", "CodeRunnerService"],
  });

  // ── 4. Register Agents with 9-Pillar Specs ────────────────────────────────────

  // Pillar 1-6: Identity, Scene, Delegation, Capabilities, Persona, Routing
  manager.registerAgent({
    id: "research-bot",
    name: "Research Bot",
    description: "Specialized in web search and information retrieval.",
    sceneId: "research",
    canDelegateTo: ["scheduling-assistant"],
    primarySkill: "Web research & information retrieval",
    secondarySkills: ["Summarisation", "Source citation", "Fact verification"],
    capabilities: ["Search the web", "Summarise documents", "Retrieve and cite sources"],
    constraints: ["Cannot access private databases"],
    systemPrompt: "你是一个专注于网络信息获取的智能助手。每次回答必须附上信息来源 URL。",
    intents: ["web-search", "fact-check", "news", "research"],
    domains: ["research", "information"],
    languages: ["zh-CN", "en-US"],
    responseStyle: "detailed",
    // Pillar 7: Communication Protocol
    communication: {
      delegationTargets: ["scheduling-assistant"],
      supportedMessageTypes: ["delegation", "task-result", "query"],
      protocolVersion: "1.0",
      channel: "in-memory",
    },
    // Pillar 8: Orchestration Config
    orchestration: {
      sceneAffinities: ["research"],
      routing: {
        intents: ["web-search", "fact-check", "news", "research"],
        domains: ["research", "information"],
        languages: ["zh-CN", "en-US"],
        responseStyle: "detailed",
        minConfidence: 0.6,
      },
      maxConcurrentTasks: 3,
      priority: 1.2,
    },
    // Pillar 9: Memory & Observability
    memory: {
      knowledgeDb: {
        enabled: true,
        autoPromoteThreshold: 0.8,
        maxEntries: 500,
      },
      costTracking: {
        enabled: true,
        dailyBudget: 0.50,
        alertThreshold: 0.8,
      },
      lineageTracking: {
        enabled: true,
        maxDepth: 5,
        includeArguments: true,
      },
      healthMonitoring: {
        enabled: true,
        degradedThreshold: 3,
        downThreshold: 5,
        autoRetireAfterMinutes: 60,
      },
    },
  });

  manager.registerAgent({
    id: "scheduling-assistant",
    name: "Scheduling Assistant",
    description: "Manages calendar events and scheduling.",
    sceneId: "productivity",
    primarySkill: "Calendar event management",
    capabilities: ["Create, read, and update calendar events"],
    constraints: ["Cannot send external emails"],
    systemPrompt: "You are a precise scheduling assistant. Always confirm time zones.",
    intents: ["scheduling", "calendar", "meeting"],
    domains: ["productivity"],
    languages: ["en-US", "zh-CN"],
    responseStyle: "concise",
    // Pillar 7: Communication
    communication: {
      supportedMessageTypes: ["task-assigned", "task-result"],
      channel: "in-memory",
    },
    // Pillar 8: Orchestration
    orchestration: {
      routing: {
        intents: ["scheduling", "calendar", "meeting"],
        domains: ["productivity"],
      },
      maxConcurrentTasks: 5,
      priority: 1.0,
    },
    // Pillar 9: Memory
    memory: {
      costTracking: { enabled: true, dailyBudget: 0.10 },
      healthMonitoring: { enabled: true },
    },
  });

  manager.registerAgent({
    id: "dev-bot",
    name: "Dev Bot",
    description: "Runs code snippets and searches for documentation.",
    allowedServices: ["CodeRunnerService", "SearchService"],
    canDelegateTo: ["research-bot"],
    primarySkill: "Code execution & developer tooling",
    systemPrompt: "你是一个专业的编程助手。优先提供可直接运行的代码示例。",
    intents: ["coding", "programming", "run-code", "debug"],
    domains: ["coding", "development"],
    responseStyle: "markdown",
    // Pillar 7: Communication
    communication: {
      delegationTargets: ["research-bot"],
      supportedMessageTypes: ["delegation", "query"],
      channel: "in-memory",
    },
    // Pillar 8: Orchestration
    orchestration: {
      routing: {
        intents: ["coding", "programming", "run-code"],
        domains: ["coding", "development"],
      },
      priority: 1.1,
    },
    // Pillar 9: Memory
    memory: {
      lineageTracking: { enabled: true, maxDepth: 3 },
      healthMonitoring: { enabled: true, autoRetireAfterMinutes: 30 },
    },
  });

  manager.registerAgent({
    id: "full-agent",
    name: "Full Agent",
    description: "Unrestricted access to all services. Can delegate to any agent.",
    sceneId: "full",
    canDelegateTo: ["*"],
    primarySkill: "Multi-domain orchestration",
    capabilities: [
      "Access all registered services",
      "Orchestrate multi-step workflows",
      "Delegate any task to any agent",
    ],
    // Pillar 7: Communication
    communication: {
      delegationTargets: ["*"],
      supportedMessageTypes: ["delegation", "task-assigned", "task-update", "task-result", "notification"],
      channel: "in-memory",
    },
    // Pillar 8: Orchestration
    orchestration: {
      sceneAffinities: ["full"],
      maxConcurrentTasks: 10,
      priority: 1.5,
    },
    // Pillar 9: Memory
    memory: {
      knowledgeDb: { enabled: true, maxEntries: 1000 },
      costTracking: { enabled: true, dailyBudget: 5.0 },
      lineageTracking: { enabled: true, maxDepth: 10, includeArguments: true },
      healthMonitoring: { enabled: true },
    },
  });

  // ── 5. Show registered agents ─────────────────────────────────────────────────
  console.log("\n=== Registered Agents ===");
  manager.listAgents().forEach((a) => {
    console.log(`  ${a.id}: ${a.name} (Pillar 8 priority=${a.orchestration?.priority ?? 1})`);
  });

  // ── 6. Route a query ──────────────────────────────────────────────────────────
  console.log("\n=== Agent Routing: 'search for latest news' ===");
  const suggestions = manager.routeAgent("search for latest news", 3);
  suggestions.forEach((s) => {
    console.log(`  ${s.agentId} (score=${s.score}): ${s.reasoning}`);
  });

  // ── 7. Pillar 7: Communication Bridge demo ────────────────────────────────────
  console.log("\n=== Pillar 7: Communication Bridge ===");
  const canDelegate = manager.communicationBridge.canDelegate("research-bot", "scheduling-assistant");
  console.log(`  research-bot → scheduling-assistant: ${canDelegate ? "allowed ✓" : "denied ✗"}`);
  const cannotDelegate = manager.communicationBridge.canDelegate("scheduling-assistant", "dev-bot");
  console.log(`  scheduling-assistant → dev-bot: ${cannotDelegate ? "allowed ✓" : "denied ✗"}`);

  // ── 8. Pillar 8: Orchestration — resolve agent for task ───────────────────────
  console.log("\n=== Pillar 8: Orchestration Adapter ===");
  const { OrchestrationAdapter } = await import("./core/OrchestrationAdapter");
  const orchestrationAdapter = new OrchestrationAdapter(manager);
  const bestAgent = orchestrationAdapter.resolveAgentForTask({
    requiredIntents: ["web-search"],
    requiredDomains: ["research"],
  });
  console.log(`  Best agent for web-search/research: ${bestAgent?.id ?? "none"}`);

  // ── 9. Pillar 9: Memory Adapter demo ─────────────────────────────────────────
  console.log("\n=== Pillar 9: Memory Adapter ===");
  const { MemoryAdapter } = await import("./core/MemoryAdapter");
  const memoryAdapter = new MemoryAdapter(manager);

  const trace = memoryAdapter.extractTrace(
    "research-bot",
    "TypeScript 5.x introduces satisfies operator for type validation",
    0.92,
    ["typescript", "type-system"]
  );
  console.log(`  Knowledge trace stored: ${trace !== null ? "yes ✓" : "no (disabled)"}`);

  const health = memoryAdapter.getAgentHealth("research-bot");
  console.log(`  research-bot health: ${health.status}`);

  // ── 10. Register Pipeline with Pillar 8 participants ─────────────────────────
  manager.registerPipeline({
    id: "research-then-schedule",
    name: "Research Then Schedule",
    description: "Search for a topic and create a follow-up meeting.",
    steps: [
      {
        agentId: "research-bot",
        toolName: "search_web",
        description: "Search for the topic",
        inputMapping: { query: "Research and schedule a meeting about MCP protocol" },
      },
      {
        agentId: "scheduling-assistant",
        toolName: "create_event",
        description: "Schedule a follow-up meeting",
        inputMapping: {
          title: "MCP Protocol Review Meeting",
          startTime: "2024-12-01T10:00:00Z",
          endTime: "2024-12-01T11:00:00Z",
        },
      },
    ],
  });
  console.log("\n=== Pipelines ===");
  console.log("  Registered:", manager.listPipelines().map((p) => p.id).join(", "));

  console.log("\n✓ All Pillars 1-9 configured and demonstrated.");
}

main().catch((err) => {
  console.error("[main] Fatal error:", err);
  process.exit(1);
});
