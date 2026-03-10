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

