# myExtBot

> **数字分身资产体系** — A lifecycle-aware multi-agent orchestration framework built on MCP (Model Context Protocol).

## Overview

myExtBot lets you manage a fleet of AI agents as first-class **digital assets**. Each agent has:

- **Owned services** — the tools/APIs that belong to it
- **Delegation rights** — which other agents it can ask for help
- **A lifecycle** — explicit operational states that can be monitored and managed

---

## Quick Start

```bash
npm install

# Run the demo (lifecycle walkthrough)
npm run dev

# Start the REST API server
npm run server

# Build TypeScript
npm run build
```

---

## Agent Lifecycle

Every agent has a **5-state lifecycle state machine** that makes its operational status explicit and manageable.

### States

| State | Meaning |
|---|---|
| `initializing` | Agent is starting up — plugin install or config check in progress |
| `active` | Ready; can accept new calls at any time |
| `busy` | Currently executing one or more tasks |
| `sleeping` | Temporarily suspended — API key expired, billing issue, manual maintenance |
| `retired` | **Terminal state** — permanently decommissioned; history preserved, no further calls allowed |

### State Machine (ASCII Diagram)

```
                      ┌─────────────────────┐
                      │     initializing     │
                      └──────────┬──────────┘
                    active ↗    │  sleeping ↘
                               ↓
    ┌──────────────────────── active ◄──────────────────────────┐
    │                      (callable ✓)                          │
    │  markBusy()             │ sleeping                         │
    ▼                         │ retired                          │
  busy ──────────────────────►│                                  │
  (callable ✓)               ↓                                  │
    │            ┌────────── sleeping ──────────────────────►   │
    │ markTask   │           (callable ✗)         retired        │
    │ Complete() │            └───── active ──────────────────►  │
    └────────────►          (API key renewed)                    │
                                                                 │
                 ┌────────── retired ─────────────────────────┘  │
                 │          (terminal, callable ✗)               │
                 │          no outgoing transitions              │
                 └──────────────────────────────────────────────►
```

More precisely, the valid transitions are:

```
initializing → active
initializing → sleeping   (config error on startup)
active       → busy       (task begins)
active       → sleeping   (manual suspend / API key failure)
active       → retired    (permanent decommission)
busy         → active     (task completes, queue empty)
busy         → sleeping   (API key fails mid-task)
sleeping     → active     (manual wake / API key restored)
sleeping     → retired    (decided to permanently decommission)
retired      → (terminal — no outgoing transitions)
```

### REST API

Start the server with `npm run server`, then use these endpoints:

```
GET  /api/agents/statuses
     Returns all agents' current lifecycle records

GET  /api/agents/:id/status
     Returns one agent's current lifecycle record

PATCH /api/agents/:id/status
     Body: { "status": "<AgentStatus>", "reason": "optional reason" }
     Transitions the agent to a new status (validates legality)
     → 200: { "success": true, "record": AgentLifecycleRecord }
     → 400: { "error": "..." } if the transition is illegal

GET  /api/agents/:id/lifecycle?limit=50
     Returns the agent's status-change history (newest first)

GET  /api/agents/lifecycle/all?limit=50
     Returns all agents' status-change history
```

#### Example: Suspend an agent

```bash
curl -X PATCH http://localhost:3000/api/agents/research-bot/status \
  -H "Content-Type: application/json" \
  -d '{"status":"sleeping","reason":"API key expired"}'
```

#### Example: Wake an agent

```bash
curl -X PATCH http://localhost:3000/api/agents/research-bot/status \
  -H "Content-Type: application/json" \
  -d '{"status":"active","reason":"API key renewed"}'
```

### dispatchAs Guard

When you call `manager.dispatchAs(agentId, request)`, the lifecycle is checked first:

- `active` or `busy` → call proceeds (agent is marked `busy` during execution)
- `sleeping`, `retired`, or `initializing` → throws an error with the current status

```typescript
// This will throw if research-bot is sleeping or retired
await manager.dispatchAs("research-bot", {
  toolName: "search_web",
  arguments: { query: "MCP protocol" },
});
```

---

## Integration Points

### M4 — Asset Health Monitor

When a service is continuously down, the associated agent can be automatically transitioned `active → sleeping`:

```typescript
lifecycleManager.transition(agentId, "sleeping",
  "Service unhealthy — auto-suspended by health monitor",
  "health-monitor"
);
```

### M8 — SLA Enforcer

Consecutive SLA violations can trigger `active → sleeping` to protect system resources:

```typescript
lifecycleManager.transition(agentId, "sleeping",
  "SLA violated 3 consecutive times",
  "sla-enforcer"
);
```

### M7 — Scene Triggers

Agent status changes (`active ↔ sleeping`) can serve as context conditions for `agent`-type scene triggers.

---

## Architecture

```
McpServiceListManager
 ├── Services  (McpService)        — tools/APIs owned by agents
 ├── Agents    (AgentProfile)      — digital personas with allowedServices + canDelegateTo
 ├── AgentLifecycleManager         — 5-state lifecycle state machine per agent
 └── DelegationLog                 — audit trail of cross-agent calls
```

### dispatchAs vs delegateAs

| Method | Usage |
|---|---|
| `dispatchAs(agentId, request)` | Direct call — agent uses its own tools |
| `delegateAs(fromId, toId, request)` | Cross-agent delegation — recorded in DelegationLog |
