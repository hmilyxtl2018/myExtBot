# myExtBot

myExtBot is a digital avatar (数字分身) asset system built on TypeScript/Node.js.
It models **Scenes** — named collections of services — and provides a trigger
engine that automatically recommends the most relevant Scene based on runtime
context.

---

## Getting Started

```bash
npm install
npm run dev     # runs src/index.ts (demo)
npm run build   # compile TypeScript → dist/
npm start       # start the REST server
```

---

## Scene Triggers

**M7 — Responsive Scene Auto-Detection**

Users should never have to manually switch modes. The `SceneTriggerEngine`
evaluates each Scene's declared trigger conditions against the current runtime
context and surfaces the best match automatically.

### Trigger Types

| Type | Description | Key field(s) |
|------|-------------|--------------|
| `keyword` | Fires when the user's input contains one or more of the listed keywords (case-insensitive). | `keywords: string[]` |
| `time` | Fires when the current local time falls within a HH:MM range. Supports overnight ranges (e.g. `22:00`–`06:00`). | `timeRange: { start, end }` |
| `agent` | Fires when a specific Agent is currently being invoked. | `agentId: string` |
| `health` | Fires when the service health map satisfies a condition. | `condition: "any-service-down" \| "all-services-healthy"` |

### Trigger Weights

Weights control how confidently a trigger recommends a Scene.
The final score for a Scene is the sum of weights of all matching triggers.

| Trigger type | Weight | Rationale |
|---|---|---|
| `health` | **4** | System anomalies are highest priority |
| `keyword` | **3** | Most direct expression of user intent |
| `agent` | **2** | Current agent provides strong context |
| `time` | **1** | Background condition, lowest priority |

### TriggerContext Fields

```typescript
interface TriggerContext {
  userInput?:      string;                          // for keyword triggers
  currentTime?:    string;                          // HH:MM, defaults to now
  activeAgentId?:  string;                          // for agent triggers
  serviceHealths?: Record<string, ServiceHealth>;   // for health triggers
}
```

### Registering a Scene with Triggers

```typescript
manager.registerScene({
  id: "research-triggered",
  name: "Research (with triggers)",
  description: "Auto-activates when user wants to search for information.",
  serviceNames: ["SearchService"],
  triggers: [
    { type: "keyword", keywords: ["搜索", "search", "find", "research"] },
    { type: "time",    timeRange: { start: "08:00", end: "20:00" } },
  ],
});
```

### Programmatic Auto-Detection

```typescript
// All matching scenes (ranked by score)
const suggestions = manager.autoDetectScene({ userInput: "帮我搜索一下" });
// → [{ sceneId: "research-triggered", score: 3, matchedTriggers: [...] }]

// Single best match
const best = manager.bestSceneForContext({ userInput: "search for news" });
// → "research-triggered"
```

### REST API

#### `POST /api/scenes/auto-detect`

Returns all Scenes that match the provided context, ranked by score.

```bash
curl -X POST http://localhost:3000/api/scenes/auto-detect \
  -H "Content-Type: application/json" \
  -d '{ "userInput": "帮我搜索最新AI新闻" }'
```

Response:

```json
[
  {
    "sceneId": "research-triggered",
    "sceneName": "Research (with triggers)",
    "matchedTriggers": [
      { "type": "keyword", "reason": "关键词匹配: 搜索, 最新" },
      { "type": "time",    "reason": "时间范围匹配: 08:00 – 20:00 (当前 09:30)" }
    ],
    "score": 4
  }
]
```

#### `POST /api/scenes/best-match`

Returns only the single highest-scoring match (or `null` if nothing matches).

```bash
curl -X POST http://localhost:3000/api/scenes/best-match \
  -H "Content-Type: application/json" \
  -d '{ "userInput": "search for latest news" }'
```

Response:

```json
{
  "sceneId": "research-triggered",
  "result": {
    "sceneId": "research-triggered",
    "sceneName": "Research (with triggers)",
    "matchedTriggers": [...],
    "score": 4
  }
}
```

### Relationship with Other Modules

| Module | Integration |
|--------|-------------|
| **M4 — 资产健康度** | `health` triggers read the service health status map from HealthMonitor |
| **M6 — 分身意图声明** | `keyword` triggers share vocabulary-matching logic with AgentRouter |
| **M10 — 分身生命周期** | Agent state changes can be fed as `activeAgentId` context to trigger scene switches |

---

## Architecture

```
src/
├── core/
│   ├── types.ts                  # Scene, SceneTrigger, TriggerContext, SceneTriggerResult
│   ├── SceneTriggerEngine.ts     # Trigger evaluation logic + scoring
│   └── McpServiceListManager.ts  # Scene registry + autoDetectScene / bestSceneForContext
├── api/
│   └── sceneTriggerRoutes.ts     # Express routes: /api/scenes/auto-detect, /api/scenes/best-match
├── server.ts                     # Express app setup + demo scene registration
└── index.ts                      # CLI demo (npm run dev)
```
