# myExtBot

myExtBot is a TypeScript-based multi-agent bot framework with MCP (Model Context Protocol) service management, SLA contract enforcement, and a REST API.

## Quick Start

```bash
npm install
npm run dev      # Run the demo
npm run server   # Start the REST API server
npm run build    # Compile TypeScript
```

## Agent Contracts (SLA)

Every Agent can be bound to an **SLA Contract** (`AgentContract`) that enforces runtime guarantees before and during each tool call. The `ContractEnforcer` wraps `dispatchAs()` and evaluates four types of rules:

### SLA Rules

| Rule | Field | Description |
|------|-------|-------------|
| **Timeout** | `maxResponseTimeMs` | Cancels the call if it exceeds the limit (ms). Returns `{ success: false, error: "timeout: ..." }` |
| **Cost per call** | `maxCostPerCall` | Rejects calls where the estimated tool cost (USD) exceeds the limit |
| **Daily cost** | `maxDailyCost` | Rejects calls when the agent's daily cumulative cost (via CostLedger/M5) exceeds the limit |
| **Rate limit** | `maxCallsPerMinute` | Sliding-window rate limiter; rejects calls that exceed the per-minute quota |

### Retry Policies

| Policy | Behaviour |
|--------|-----------|
| `"none"` | No retry on failure (default) |
| `"once"` | Retry once after the first failure |
| `"exponential-backoff"` | Up to 3 retries with delays: 1 s → 2 s → 4 s |

### Fallback / Degradation

```typescript
fallback: {
  agentId: "backup-bot",        // Delegate to another agent on SLA violation
  returnPartialResult: false,   // true = return partial output on timeout instead of error
}
```

### Alert Thresholds

```typescript
alertThresholds: {
  warnAt: 0.8,  // Emit console.warn when usage reaches 80% of any limit
}
```

### Registering a Contract

```typescript
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
  alertThresholds: { warnAt: 0.8 },
});
```

Once registered, any `manager.dispatchAs("research-bot", toolCall)` call is automatically protected.

### REST API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/contracts` | List all contracts |
| `GET` | `/api/contracts/:agentId` | Get contract for agent |
| `POST` | `/api/contracts/:agentId` | Register/replace contract |
| `DELETE` | `/api/contracts/:agentId` | Remove contract |
| `POST` | `/api/contracts/:agentId/check` | Pre-check without executing (`{ toolName }`) |

**Examples:**

```bash
# Register a contract
curl -X POST http://localhost:3000/api/contracts/research-bot \
  -H "Content-Type: application/json" \
  -d '{"sla":{"maxResponseTimeMs":5000,"maxCallsPerMinute":10}}'

# List all contracts
curl http://localhost:3000/api/contracts

# Pre-check
curl -X POST http://localhost:3000/api/contracts/research-bot/check \
  -H "Content-Type: application/json" \
  -d '{"toolName":"search_web"}'
```

### Integration with M5 (CostLedger)

`ContractEnforcer` accepts an optional `CostLedger` instance. When provided:

- The `maxDailyCost` guard reads today's cumulative cost via `costLedger.getDailyCost(agentId)`.
- After a successful call, the estimated tool cost is recorded via `costLedger.recordCost(agentId, cost)`.

```typescript
import { CostLedger } from "./core/CostLedger";
import { ContractEnforcer } from "./core/ContractEnforcer";

const ledger = new CostLedger();
const enforcer = new ContractEnforcer(ledger);
```

`McpServiceListManager` creates its own `CostLedger` and `ContractEnforcer` automatically.

## Architecture

```
src/
├── core/
│   ├── types.ts              — ToolCall, ToolResult, AgentContract, ContractCheckResult
│   ├── CostLedger.ts         — M5: per-agent daily cost tracking
│   ├── ContractEnforcer.ts   — M8: SLA enforcement (timeout, cost, rate, retry, fallback)
│   └── McpServiceListManager.ts — orchestrates services, contracts, and dispatch
├── services/
│   ├── BaseService.ts        — abstract base for all services
│   └── SearchService.ts      — stub search service for demo
├── api/
│   └── contractRoutes.ts     — Express router for /api/contracts
├── server.ts                 — Express server entry point
└── index.ts                  — Demo / CLI entry point
```
