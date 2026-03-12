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
