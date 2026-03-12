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
