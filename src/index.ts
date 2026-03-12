/**
 * src/index.ts
 *
 * myExtBot — Digital Avatar Asset System entry point.
 * Demonstrates M4: Service Health Monitoring.
 */

import { McpServiceListManager } from "./core/McpServiceListManager";
import { SearchService } from "./services/SearchService";
import { PerplexityService } from "./services/PerplexityService";

async function main(): Promise<void> {
  const manager = new McpServiceListManager();

  // ── 1. Register Services ────────────────────────────────────────────────────
  const searchService = new SearchService();
  const perplexityService = new PerplexityService();

  manager.register(searchService);
  manager.register(perplexityService);

  console.log("Registered services:", manager.listServices());

  // ── 2. Initial health state (should be "unknown") ───────────────────────────
  console.log(
    "\n=== Initial Health (should be 'unknown') ==="
  );
  console.log(JSON.stringify(manager.getAllServiceHealths(), null, 2));

  // ── 3. Successful call → health becomes "healthy" ───────────────────────────
  console.log("\n=== Successful call to PerplexityService ===");
  const successResult = await manager.dispatch("PerplexityService", {
    query: "What is myExtBot?",
  });
  console.log("Result:", successResult);
  console.log(
    "Health after success:",
    manager.getServiceHealth("PerplexityService").health
  );

  // ── 4. Simulate 3 failures → "degraded" ────────────────────────────────────
  console.log("\n=== Simulating 3 failures (expect 'degraded') ===");
  process.env.PERPLEXITY_SIMULATE_FAILURE = "true";
  for (let i = 1; i <= 3; i++) {
    await manager.dispatch("PerplexityService", { query: "test" });
    console.log(
      `  After failure #${i}: ${manager.getServiceHealth("PerplexityService").health}`
    );
  }
  delete process.env.PERPLEXITY_SIMULATE_FAILURE;

  // ── 5. Simulate 2 more failures → "down" ───────────────────────────────────
  console.log("\n=== Simulating 2 more failures (expect 'down') ===");
  process.env.PERPLEXITY_SIMULATE_FAILURE = "true";
  for (let i = 4; i <= 5; i++) {
    await manager.dispatch("PerplexityService", { query: "test" });
    console.log(
      `  After failure #${i}: ${manager.getServiceHealth("PerplexityService").health}`
    );
  }
  delete process.env.PERPLEXITY_SIMULATE_FAILURE;

  // ── 6. Dispatch to "down" service → fallback to SearchService ──────────────
  console.log(
    "\n=== Dispatch to 'down' PerplexityService (expect fallback to SearchService) ==="
  );
  const fallbackResult = await manager.dispatch("PerplexityService", {
    query: "fallback demo",
  });
  console.log("Fallback result:", fallbackResult);

  // ── 7. Rate-limit simulation ────────────────────────────────────────────────
  console.log("\n=== Simulating 429 Rate Limit ===");
  manager.resetServiceHealth("PerplexityService");
  process.env.PERPLEXITY_SIMULATE_RATE_LIMIT = "true";
  const rateLimitResult = await manager.dispatch("PerplexityService", {
    query: "rate limit demo",
  });
  console.log("Rate-limit result:", rateLimitResult);
  console.log(
    "Health after 429:",
    manager.getServiceHealth("PerplexityService").health
  );
  delete process.env.PERPLEXITY_SIMULATE_RATE_LIMIT;

  // ── 8. Manual health reset ───────────────────────────────────────────────────
  console.log("\n=== Manual health reset ===");
  const resetRecord = manager.resetServiceHealth("PerplexityService");
  console.log("Health after reset:", resetRecord.health);

  // ── 9. dispatchAs demo ───────────────────────────────────────────────────────
  console.log("\n=== dispatchAs demo ===");
  const delegateResult = await manager.dispatchAs(
    "intelligence-agent",
    "PerplexityService",
    { query: "dispatchAs demo" }
  );
  console.log("delegateAs result:", delegateResult);

  // ── 17. Service Health Demo ───────────────────────────────────────────────────
  console.log("\n=== Service Health Status ===");
  console.log(JSON.stringify(manager.getAllServiceHealths(), null, 2));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
