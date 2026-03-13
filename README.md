# myExtBot

A TypeScript project that implements a **unified MCP Services List Manager** — a single source of truth for all tools that the LLM can actively call.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                  McpServiceListManager                      │
│                                                             │
│  ┌──────────────┐  ┌────────────────┐  ┌────────────────┐  │
│  │SearchService │  │CalendarService │  │CodeRunnerSvc   │  │
│  │  search_web  │  │  get_events    │  │  run_code      │  │
│  └──────────────┘  │  create_event  │  └────────────────┘  │
│                    └────────────────┘                       │
│                                                             │
│  • register / enable / disable services at runtime          │
│  • getToolDefinitions() → unified JSON Schema list          │
│  • dispatch(toolCall)   → route to the right service        │
└───────────────────────────┬─────────────────────────────────┘
                            │  tools list (JSON Schema)
                            ▼
                 ┌──────────────────────┐
                 │     LLM / Agent      │
                 │   (myExtBot Core)    │
                 └──────────────────────┘
```

---

## Directory Structure

```
myExtBot/
├── src/
│   ├── core/
│   │   ├── McpServiceListManager.ts   # Core manager
│   │   └── types.ts                   # Shared interfaces/types
│   ├── services/
│   │   ├── BaseService.ts             # Abstract base class
│   │   ├── SearchService.ts           # search_web tool
│   │   ├── CalendarService.ts         # get_events + create_event tools
│   │   └── CodeRunnerService.ts       # run_code tool
│   └── index.ts                       # Entry point
├── package.json
├── tsconfig.json
└── README.md
```

---

## Getting Started

```bash
npm install
npm start        # run with ts-node
npm run build    # compile to dist/
```

---

## How to Register a New MCP Service

1. **Create a new file** under `src/services/`, e.g. `EmailService.ts`.
2. **Extend `BaseService`** and implement `name`, `getToolDefinitions()`, and `execute()`:

```typescript
import { BaseService } from "./BaseService";
import { ToolCall, ToolDefinition, ToolResult } from "../core/types";

export class EmailService extends BaseService {
  readonly name = "EmailService";

  getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: "send_email",
        description: "Send an email to a recipient.",
        parameters: {
          type: "object",
          properties: {
            to:      { type: "string", description: "Recipient email address." },
            subject: { type: "string", description: "Email subject line." },
            body:    { type: "string", description: "Email body content." },
          },
          required: ["to", "subject", "body"],
        },
      },
    ];
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    if (call.toolName !== "send_email") {
      return { success: false, error: `Unknown tool: ${call.toolName}` };
    }
    // ... your implementation here
    return { success: true, output: { sent: true } };
  }
}
```

3. **Register it** in `src/index.ts` — that's all:

```typescript
manager.register(new EmailService());
```

No other code needs to change. ✅

---

## LLM Tool Call Flow

```
1. Your code calls manager.getToolDefinitions()
       └─► Returns a flat JSON Schema array of all enabled tools
2. Pass this array to the LLM as the "tools" parameter
3. LLM decides to call a tool → returns a tool_call object:
       { toolName: "search_web", arguments: { query: "..." } }
4. Your code calls manager.dispatch(toolCall)
       └─► Manager finds the right service → calls service.execute(toolCall)
       └─► Returns ToolResult { success, output, error? }
5. Feed the ToolResult back to the LLM as the tool response
```

---

## Runtime Enable / Disable

```typescript
// Hide a service from the LLM (e.g. for a restricted agent)
manager.disableService("CodeRunnerService");

// Re-enable it later
manager.enableService("CodeRunnerService");

// Inspect all services
console.log(manager.listServices());
// [
//   { name: "SearchService",     enabled: true,  toolCount: 1 },
//   { name: "CalendarService",   enabled: true,  toolCount: 2 },
//   { name: "CodeRunnerService", enabled: false, toolCount: 1 },
// ]
```

---

## Key Interfaces (`src/core/types.ts`)

| Interface | Purpose |
|-----------|---------|
| `ToolDefinition` | JSON Schema-compatible tool spec sent to the LLM |
| `ToolCall` | Tool invocation request coming from the LLM |
| `ToolResult` | Execution result returned to the LLM |
| `McpService` | Contract every service must implement |


---

## Delegation Log

Every call to `delegateAs()` (inter-agent delegation) is automatically persisted to a **JSON Lines** file on disk, in addition to the in-memory circular buffer.

### File location

| Priority | Source | Path |
|----------|--------|------|
| 1 | Environment variable | `$MYEXTBOT_LOG_DIR/delegation-YYYY-MM-DD.jsonl` |
| 2 | Default | `~/.myextbot/logs/delegation-YYYY-MM-DD.jsonl` |

Set a custom directory:
```bash
export MYEXTBOT_LOG_DIR=/var/log/myextbot
npm run server
```

### Log format

Each line is a complete JSON object (`DelegationLogEntry`):

```json
{"timestamp":"2024-03-12T06:00:00.000Z","fromAgentId":"dev-bot","toAgentId":"web-search-agent","toolName":"intelligence_search","arguments":{"query":"latest AI news"},"success":true,"output":{"text":"..."}}
```

### REST API

#### `GET /api/delegation-log`

Query delegation entries for a specific date.

| Query param | Type | Description |
|-------------|------|-------------|
| `date` | `YYYY-MM-DD` | Date to query (defaults to today) |
| `agentId` | `string` | Filter by `fromAgentId` or `toAgentId` |
| `toolName` | `string` | Filter by tool name |
| `success` | `"true"` \| `"false"` | Filter by outcome |
| `limit` | `number` | Max results (default: 100) |
| `offset` | `number` | Skip N results (default: 0) |

**Response:**
```json
{
  "entries": [ /* DelegationLogEntry[] */ ],
  "total": 3,
  "date": "2024-03-12"
}
```

**Example:**
```bash
curl "http://localhost:3000/api/delegation-log?agentId=dev-bot&success=true"
```

---

#### `GET /api/delegation-log/dates`

Returns all dates for which a log file exists, in descending order.

```bash
curl http://localhost:3000/api/delegation-log/dates
# { "dates": ["2024-03-12", "2024-03-11", "2024-03-10"] }
```

---

#### `GET /api/delegation-log/summary`

Aggregated statistics for a given date (defaults to today).

| Query param | Type | Description |
|-------------|------|-------------|
| `date` | `YYYY-MM-DD` | Date to summarise (defaults to today) |

**Response:**
```json
{
  "totalCalls": 42,
  "successRate": 0.95,
  "byAgent": {
    "dev-bot": { "calls": 20, "success": 19 },
    "web-search-agent": { "calls": 22, "success": 21 }
  },
  "byTool": {
    "intelligence_search": { "calls": 15, "success": 15 },
    "web_scrape": { "calls": 7, "success": 6 }
  }
}
```

```bash
curl "http://localhost:3000/api/delegation-log/summary?date=2024-03-12"
```
