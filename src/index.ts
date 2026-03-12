import { McpServiceListManager } from "./core/McpServiceListManager";
import { SearchService } from "./services/SearchService";

async function main(): Promise<void> {
  const manager = new McpServiceListManager();

  // ── Register services ────────────────────────────────────────────────────
  manager.register(new SearchService());

  // ── Register scenes ──────────────────────────────────────────────────────
  manager.registerScene({
    id: "research",
    name: "Research",
    description: "Web research: search, crawl, and answer questions with citations.",
    serviceNames: ["SearchService"],
  });

  console.log("=== myExtBot M8: Agent SLA Contract Demo ===\n");
  console.log("Registered services:", manager.listServices());
  console.log("Registered scenes:", manager.listScenes().map((s) => s.id));

  // ── 1. Basic dispatch (no contract) ─────────────────────────────────────
  console.log("\n── 1. Basic dispatch without contract ──");
  const basicResult = await manager.dispatchAs("dev-bot", {
    toolName: "search_web",
    arguments: { query: "TypeScript best practices", maxResults: 2 },
  });
  console.log("Basic dispatch success:", basicResult.success);

  // ── 20. Agent Contract / SLA Demo ──────────────────────────────────────
  manager.registerContract({
    agentId: "research-bot",
    sla: {
      maxResponseTimeMs: 5000,
      maxCostPerCall: 0.01,
      maxDailyCost: 0.10,
      maxCallsPerMinute: 10,
      retryPolicy: "once",
    },
    fallback: {
      agentId: "dev-bot",
      returnPartialResult: false,
    },
    alertThresholds: {
      warnAt: 0.8,
    },
  });

  console.log("\n=== Contract registered for research-bot ===");
  console.log(JSON.stringify(manager.getContract("research-bot"), null, 2));

  // Normal call (should succeed)
  const contractedResult = await manager.dispatchAs("research-bot", {
    toolName: "search_web",
    arguments: { query: "SLA contract patterns", maxResults: 1 },
  });
  console.log("Contracted dispatch result:", contractedResult.success);

  // ── 2. Timeout demo ──────────────────────────────────────────────────────
  console.log("\n── 2. Timeout contract demo ──");
  manager.registerContract({
    agentId: "timeout-bot",
    sla: { maxResponseTimeMs: 1 }, // 1ms — will always timeout
  });

  const timeoutResult = await manager.dispatchAs("timeout-bot", {
    toolName: "search_web",
    arguments: { query: "timeout test" },
  });
  console.log("Timeout result success:", timeoutResult.success); // false
  console.log("Timeout error:", timeoutResult.error);
  const hasTimeout = timeoutResult.error?.toLowerCase().includes("timeout") ?? false;
  console.log("Error contains 'timeout':", hasTimeout);

  // ── 3. Rate limit demo ───────────────────────────────────────────────────
  console.log("\n── 3. Rate limit demo (maxCallsPerMinute: 1) ──");
  manager.registerContract({
    agentId: "rate-bot",
    sla: { maxCallsPerMinute: 1 },
  });

  const rate1 = await manager.dispatchAs("rate-bot", {
    toolName: "search_web",
    arguments: { query: "first call" },
  });
  console.log("Rate-bot call 1 success:", rate1.success); // true

  const rate2 = await manager.dispatchAs("rate-bot", {
    toolName: "search_web",
    arguments: { query: "second call" },
  });
  console.log("Rate-bot call 2 success:", rate2.success); // false (rate limited)
  console.log("Rate-bot call 2 error:", rate2.error);

  // ── 4. listContracts ─────────────────────────────────────────────────────
  console.log("\n── 4. listContracts ──");
  const contracts = manager.listContracts();
  console.log(
    "All registered contracts:",
    contracts.map((c) => c.agentId)
  );

  // ── 5. preCheck ──────────────────────────────────────────────────────────
  console.log("\n── 5. preCheck via ContractEnforcer ──");
  const contract = manager.getContract("research-bot")!;
  const checkResult = manager.getContractEnforcer().preCheck(
    contract,
    "research-bot",
    "search_web"
  );
  console.log("preCheck result:", checkResult);

  console.log("\n=== Demo complete ===");
}

main().catch(console.error);
