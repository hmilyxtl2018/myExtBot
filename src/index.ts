/**
 * src/index.ts — myExtBot entry point / demo.
 *
 * Demonstrates M6: Agent Intent & Persona
 *  - Registering agents with systemPrompt, intents, domains, and responseStyle
 *  - Intent-driven routing via AgentRouter
 */

import { McpServiceListManager } from "./core/McpServiceListManager";

const manager = new McpServiceListManager();

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
