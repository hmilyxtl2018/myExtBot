# myExtBot

> **Digital Avatar Asset System** — A TypeScript framework for building multi-agent pipelines where each agent owns its tools as sovereign assets.

---

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [Core Concepts](#core-concepts)
- [Multi-Agent Pipelines](#multi-agent-pipelines)
- [REST API](#rest-api)
- [Architecture Roadmap](#architecture-roadmap)

---

## Overview

myExtBot is built around the philosophy that **Agents, Tools, and Services are digital assets you own** — not just utility functions.  Every delegation between agents is logged, every pipeline run is traceable, and every tool call is attributed to its owner.

---

## Quick Start

```bash
npm install
npm run dev        # Run the demo (src/index.ts)
npm run server     # Start the Express REST server
npm run build      # Compile TypeScript to dist/
```

---

## Core Concepts

| Concept | Description |
|---------|-------------|
| **McpService** | A service that exposes one or more tools (e.g., SearchService, CodeRunnerService) |
| **AgentProfile** | A named agent with a set of allowed services and delegation permissions |
| **DelegationLog** | Immutable record of every tool dispatch — the agent's behaviour memory |
| **AgentPipeline** | An ordered list of steps to be executed sequentially across agents |

### Agent Registration

```typescript
manager.registerAgent({
  id: "research-bot",
  name: "Research Bot",
  allowedServices: ["SearchService"],
  canDelegateTo: [],
  systemPrompt: "You are a research assistant.",
  intents: ["web-search", "research"],
});
```

### Dispatching a Tool Call

```typescript
const result = await manager.dispatchAs("research-bot", {
  toolName: "search_web",
  arguments: { query: "MCP pipeline patterns", maxResults: 3 },
});
```

---

## Multi-Agent Pipelines

**M3 — Multi-Agent Pipeline** lets you declare a sequence of agent steps where each step can reference the output of a previous step.  This enables powerful A → B → C execution chains with full context propagation.

### inputMapping — Two Modes

| Mode | Example | Meaning |
|------|---------|---------|
| **Literal** | `"query": "hello world"` | The string `"hello world"` is passed directly |
| **fromStep reference** | `"code": { fromStep: 0, outputPath: "results" }` | The value at path `results` from step 0's output |

`outputPath` supports dot-notation and array indices:

```
"results[0].url"   →  first result's URL
"answer"           →  top-level key
"meta.total"       →  nested key
```

### Registering a Pipeline

```typescript
manager.registerPipeline({
  id: "research-and-summarize",
  name: "Research & Summarize",
  description: "Search the web, then process the results.",
  steps: [
    {
      agentId: "research-bot",
      toolName: "search_web",
      description: "Step 1: Search for the topic",
      inputMapping: {
        query: "MCP agent pipeline patterns",
        maxResults: "3",
      },
    },
    {
      agentId: "dev-bot",
      toolName: "run_code",
      description: "Step 2: Process the search results",
      inputMapping: {
        language: "javascript",
        code: { fromStep: 0, outputPath: "results" }, // ← reference step 0 output
      },
    },
  ],
});
```

### Running a Pipeline Programmatically

```typescript
const result = await manager.runPipeline("research-and-summarize", {});
console.log(result.success);      // true / false
console.log(result.finalOutput);  // output of the last step
console.log(result.stepResults);  // per-step details
console.log(result.failedAtStep); // set if a step failed (failFast mode)
```

### PipelineRunResult Shape

```typescript
{
  pipelineId: string;
  startedAt: string;       // ISO-8601
  completedAt: string;     // ISO-8601
  success: boolean;
  stepResults: Array<{
    stepIndex: number;
    agentId: string;
    toolName: string;
    success: boolean;
    output?: unknown;
    error?: string;
    durationMs: number;
  }>;
  finalOutput?: unknown;   // last step's output
  failedAtStep?: number;   // index of the first failed step
  error?: string;
}
```

### Integration with M1 (DelegationLog) and M9 (Lineage Graph)

Every step in a pipeline is executed via `manager.dispatchAs()`, which appends an entry to the **DelegationLog**.  The `fromAgentId` field identifies the calling agent, providing a complete audit trail:

```
research-bot → SearchService :: search_web (0ms)
dev-bot      → CodeRunnerService :: run_code (1ms)
```

This chain of log entries naturally forms the **asset lineage graph** (M9), showing exactly which agents consumed which tools and in what order.

---

## REST API

Start the server with `npm run server` (default port 3000).

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/pipelines` | List all registered pipelines |
| `POST` | `/api/pipelines` | Register a new pipeline |
| `GET` | `/api/pipelines/:id` | Get a pipeline by ID |
| `DELETE` | `/api/pipelines/:id` | Unregister a pipeline |
| `POST` | `/api/pipelines/:id/run` | Execute a pipeline |

### POST /api/pipelines

```json
{
  "id": "my-pipeline",
  "name": "My Pipeline",
  "steps": [
    { "agentId": "research-bot", "toolName": "search_web", "inputMapping": { "query": "hello" } }
  ]
}
```

### POST /api/pipelines/:id/run

```json
{
  "initialInput": { "extra": "context" }
}
```

Response: `PipelineRunResult`

---

## Architecture Roadmap

| ID | Feature | Priority |
|----|---------|----------|
| **M1** | DelegationLog persistence (file / DB) | 🔴 P0 |
| **M2** | Plugin skill market (dynamic install/uninstall) | 🟢 P3 |
| **M3** | **Multi-Agent Pipeline** ← *this PR* | 🟠 P1 |
| **M4** | Service health & automatic fallback | 🟠 P1 |
| **M5** | Cost ledger (per-call billing) | 🟢 P3 |
| **M6** | Agent intent declaration & auto-routing | 🔴 P0 |
| **M7** | Scene triggers (keyword / time-based) | 🟡 P2 |
| **M8** | Agent SLA contracts | ⚪ P4 |
| **M9** | Asset lineage graph (visual call tree) | 🟡 P2 |
| **M10** | Agent lifecycle (sleep / wake / retire) | ⚪ P4 |
