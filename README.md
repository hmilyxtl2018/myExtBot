# myExtBot

myExtBot is a **digital-persona asset system** built around the concept that an Agent is not just a set of permissions — it is a persona with character, expertise, and intent.

---

## Quick Start

```bash
npm install
npm run dev       # run the routing demo (src/index.ts)
npm run server    # start the Express API server on port 3000
npx tsc --noEmit  # type-check only
```

---

## Agent Intent & Routing

> **M6 — 分身意图声明 (Agent Intent & Persona)**

### Extended `AgentProfile` Fields

| Field | Type | Description |
|---|---|---|
| `systemPrompt` | `string?` | System message injected to the LLM when running as this agent |
| `intents` | `string[]?` | Intent tags for routing (fine-grained; e.g. `"web-search"`, `"fact-check"`) |
| `domains` | `string[]?` | Domain tags (coarse-grained; e.g. `"research"`, `"coding"`) |
| `languages` | `string[]?` | Languages the agent is proficient in (e.g. `"zh-CN"`, `"en-US"`) |
| `responseStyle` | `"concise" \| "detailed" \| "bullet-points" \| "markdown"` | Preferred output style |

#### `systemPrompt` vs ordinary `description`

- **`description`** is for humans — it is displayed in UI and agent lists.
- **`systemPrompt`** is for the LLM — it is injected as the `system` message so the model stays in character throughout the conversation.

Example:
```typescript
manager.registerAgent({
  id: "research-bot",
  name: "Research Bot",
  systemPrompt: "你是一个专注于网络信息获取的智能助手。每次回答必须附上信息来源 URL。",
  intents: ["web-search", "fact-check", "news", "research", "搜索", "查询"],
  domains: ["research", "information"],
  responseStyle: "detailed",
});
```

#### `intents` vs `domains`

| | `intents` | `domains` |
|---|---|---|
| Granularity | Fine-grained action verbs | Coarse-grained subject areas |
| Examples | `"web-search"`, `"run-code"`, `"fact-check"` | `"research"`, `"coding"`, `"productivity"` |
| Router weight | **+3** per match | **+2** per match |
| Typical count | 5–10 per agent | 1–3 per agent |

Use `intents` for specific user actions; use `domains` for the general knowledge area.

---

### AgentRouter Scoring Algorithm

`AgentRouter.route(query, topN)` scores every enabled agent against the tokenised query and returns the top-N results.

| Signal | Score |
|---|---|
| Intent tag matched | +3 per intent |
| Domain tag matched | +2 per domain |
| `primarySkill` contains query token | +2 |
| Capability string contains query token | +1 per capability |
| Agent name or description contains query token | +1 |

**Tie-breaking**: agents with more tools (`toolCount`) rank higher.

**Zero-score filtering**: if *any* agent scores > 0, all zero-score agents are excluded from results.

**Tokenisation**: the query is lowercased and split on whitespace / punctuation; tokens shorter than 2 characters are ignored.

---

### REST API

Start the server with `npm run server`, then:

#### `GET /api/agents`
Returns all registered agents with M6 persona/intent fields.

```bash
curl http://localhost:3000/api/agents
```

#### `GET /api/agents/route?query=<text>&topN=<n>`
Recommends up to `topN` (default 3) agents for the given query.

```bash
curl "http://localhost:3000/api/agents/route?query=搜索新闻"
```

Response:
```json
[
  {
    "agentId": "research-bot",
    "agentName": "Research Bot",
    "score": 9,
    "matchedIntents": ["搜索", "news"],
    "matchedDomains": ["research"],
    "reasoning": "匹配意图: 搜索, news; 匹配领域: research"
  }
]
```

#### `GET /api/agents/route/best?query=<text>`
Returns the single best-matching agent (or `null` if no agent scores > 0).

```bash
curl "http://localhost:3000/api/agents/route/best?query=write+python+code"
```

Response:
```json
{
  "agentId": "dev-bot",
  "suggestion": {
    "agentId": "dev-bot",
    "agentName": "Dev Bot",
    "score": 6,
    "matchedIntents": ["coding", "script"],
    "matchedDomains": ["coding"],
    "reasoning": "匹配意图: coding, script; 匹配领域: coding"
  }
}
```

---

### Relationship to M7 (Scene Triggers)

M7's `keyword`-type scene trigger uses the same token-matching approach as `AgentRouter`.  
When a keyword trigger fires, the matched scene typically contains the agent that `AgentRouter` would recommend for the same query — they complement each other:

- **AgentRouter** answers *"which agent should handle this query?"*
- **Scene Triggers** answer *"which set of tools should be active for this query?"*

### Relationship to M3 (Multi-Agent Pipeline)

A Pipeline step can omit an explicit `agentId` and instead declare an `intent`.  
The Pipeline runner calls `AgentRouter.bestMatch(intent)` to resolve the step to a concrete agent at runtime, enabling **intent-driven, late-binding pipelines**.
