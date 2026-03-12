# myExtBot

myExtBot — Digital Avatar Asset System (数字分身资产体系)

A TypeScript framework for managing AI service agents with health monitoring,
fallback routing, delegation logging, and plugin extensibility.

---

## Quick Start

```bash
npm install
npm run dev    # run the demo
npm run build  # TypeScript compile check
```

---

## Service Health Monitoring (M4)

### Overview

Every external API can fail, be rate-limited, or become unavailable.
The M4 health monitoring layer gives every Service a **visible health status**
and automatically routes calls to a fallback Service when a primary Service is
unhealthy — ensuring system resilience.

### 5 Health States

| State | Meaning | Callable? |
|---|---|---|
| `unknown` | No calls recorded yet (initial state after `register()`) | ✅ Yes |
| `healthy` | API responding normally | ✅ Yes |
| `degraded` | 3–4 consecutive failures — reduced confidence but still usable | ✅ Yes |
| `down` | 5+ consecutive failures — calls suspended | ❌ No |
| `rate-limited` | HTTP 429 received — waiting for `rateLimitResetAt` | ❌ No |

### State Transition Rules

```
register()         → "unknown"
recordSuccess()    → "healthy"  (resets consecutiveFailures to 0)
recordFailure()    (non-429):
  consecutiveFailures < 3   → stays "healthy" (transient errors don't degrade)
  consecutiveFailures >= 3  → "degraded"
  consecutiveFailures >= 5  → "down"
recordFailure()    (429 / "rate limit"):
  → "rate-limited" + sets rateLimitResetAt (Retry-After seconds)
checkRateLimitRecovery() called before every dispatch:
  if rateLimitResetAt < now → auto-recover to "healthy"
```

### Automatic Fallback Routing

Configure `fallbackServiceName` on any `BaseService` subclass:

```typescript
export class PerplexityService extends BaseService {
  readonly name = "PerplexityService";
  fallbackServiceName = "SearchService";   // ← fallback when "down" / "rate-limited"
  // ...
}
```

When `McpServiceListManager.dispatch("PerplexityService", payload)` is called
and `PerplexityService` is `"down"` or `"rate-limited"`, the manager
automatically routes to `"SearchService"` and logs a warning.

If no fallback is configured and the service is not callable, dispatch returns:

```json
{ "success": false, "error": "Service \"X\" is down, no fallback available." }
```

### REST API

Mount the health routes on your Express app:

```typescript
import { mountHealthRoutes } from "./api/healthRoutes";
mountHealthRoutes(app, manager);
```

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | All `ServiceHealthRecord[]` |
| `GET` | `/api/health/:serviceName` | Single record |
| `POST` | `/api/health/:serviceName/reset` | Reset to `"healthy"` (ops) |

Example response for `GET /api/health/PerplexityService`:

```json
{
  "serviceName": "PerplexityService",
  "health": "degraded",
  "lastCheckedAt": "2026-03-12T08:00:00.000Z",
  "consecutiveFailures": 3,
  "lastError": "503 Service Unavailable",
  "totalCalls": 10,
  "totalSuccesses": 7,
  "successRate": 0.7
}
```

### Programmatic API

```typescript
const manager = new McpServiceListManager();
manager.register(new PerplexityService());

// Health queries
manager.getServiceHealth("PerplexityService");  // ServiceHealthRecord
manager.getAllServiceHealths();                  // ServiceHealthRecord[]

// Ops reset
manager.resetServiceHealth("PerplexityService");
```

### Integration with Other Milestones

| Milestone | Integration |
|-----------|-------------|
| **M10 — Agent Lifecycle** | When a Service is persistently `"down"`, the owning Agent can transition `active → sleeping` |
| **M8 — Agent SLA** | Timeout failures increment `consecutiveFailures`; SLA violations are tracked alongside health |
| **M7 — Scene Triggers** | A `health` trigger type reads health state to automatically switch Scenes |

---

## Architecture

```
src/
  core/
    types.ts                 ← All shared types (ServiceHealth, ServiceHealthRecord, …)
    HealthMonitor.ts         ← Health state machine
    McpServiceListManager.ts ← Central registry & health-aware dispatcher
  services/
    BaseService.ts           ← Abstract base with fallbackServiceName
    SearchService.ts         ← Mock fallback service
    PerplexityService.ts     ← AI search service (with fallback config)
  api/
    healthRoutes.ts          ← REST API handlers
  index.ts                   ← Demo entry point
```
