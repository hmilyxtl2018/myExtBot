# myExtBot

myExtBot 是一个数字分身资产体系，支持多 Agent 协作、工具调用分发与成本追踪。

## 项目结构

```
src/
├── config/
│   └── toolCosts.ts        # 工具成本配置
├── core/
│   ├── types.ts            # 核心类型定义（CostEntry, CostSummary 等）
│   ├── CostLedger.ts       # 成本账本（记录 + 查询 + 汇总）
│   └── McpServiceListManager.ts  # 服务管理器（dispatch / dispatchAs）
├── api/
│   └── costRoutes.ts       # REST API 路由处理
├── server.ts               # HTTP 服务器入口
└── index.ts                # 演示脚本
```

## 快速开始

```bash
npm install
npm run dev      # TypeScript 类型检查
npm run build    # 编译到 dist/
npm start        # 运行演示脚本（需先 build）
npm run server   # 启动 HTTP 服务器（需先 build）
```

---

## Cost Ledger

**M5 资产成本账本** — 记录每次 Tool 调用的成本，提供按 Agent / Tool / 日期维度的聚合查询。

**核心哲学**：每一次 Tool 调用都有成本。不知道成本的系统，是失控的系统。成本账本让每个 Agent 的「消费行为」完全透明。

### 工具成本配置（`src/config/toolCosts.ts`）

每个工具的成本在 `TOOL_COSTS` 对象中定义：

```typescript
import { TOOL_COSTS, calculateCost } from "./src/config/toolCosts";

// 查看某工具的成本配置
console.log(TOOL_COSTS["intelligence_search"]);
// { costPerCall: 0.001, unit: "per-call" }

// 计算一次调用的成本
const cost = calculateCost("intelligence_search");
// 0.001

// per-char 计费工具
const translateCost = calculateCost("translate_text", { charsProcessed: 1000 });
// 0.001 + 1000 * 0.000001 = 0.002
```

#### 支持的计费单位

| 单位 | 说明 | 示例工具 |
|------|------|----------|
| `per-call` | 每次调用固定成本 | `intelligence_search`, `web_scrape` |
| `per-token` | 基础费 + token 数 × 单位价格 | （预留） |
| `per-char` | 基础费 + 字符数 × 单位价格 | `translate_text` |

#### 自定义工具成本

在 `TOOL_COSTS` 中添加新条目：

```typescript
// src/config/toolCosts.ts
export const TOOL_COSTS: Record<string, ToolCostConfig> = {
  // ...现有配置...

  // 自定义工具
  "my_custom_tool": { costPerCall: 0.005, unit: "per-call" },
  "my_token_tool":  { costPerCall: 0.001, unit: "per-token", unitCost: 0.000002 },
};
```

未在 `TOOL_COSTS` 中配置的工具，默认成本为 `0`。

### 使用 CostLedger

```typescript
import { McpServiceListManager } from "./src/core/McpServiceListManager";

const manager = new McpServiceListManager();

// 直接调用工具（agentId 为 undefined）
await manager.dispatch({
  toolName: "intelligence_search",
  serviceName: "PerplexityService",
  args: { query: "TypeScript best practices" },
});

// 以指定 Agent 身份调用工具
await manager.dispatchAs("research-bot", {
  toolName: "intelligence_search",
  serviceName: "PerplexityService",
  args: { query: "Agent cost management" },
});

// 获取今日某 Agent 的累计成本
const dailyCost = manager.getCostLedger().getDailyCostForAgent("research-bot");
console.log(`research-bot 今日成本: $${dailyCost}`);

// 获取完整汇总报告
const summary = manager.getCostSummary();
console.log(summary.totalCost);        // 总成本
console.log(summary.byAgent);          // 按 Agent 分组
console.log(summary.byTool);           // 按 Tool 分组
```

### 成本数据持久化

成本条目自动异步写入 `~/.myextbot/costs/costs-YYYY-MM-DD.jsonl`（JSON Lines 格式）。写入失败不影响主流程。

### REST API

启动服务器后（`npm run server`），可使用以下端点：

#### `GET /api/costs`

查询成本条目列表。

| 参数 | 类型 | 说明 |
|------|------|------|
| `agentId` | string | 按 Agent 过滤 |
| `toolName` | string | 按工具名过滤 |
| `date` | string | 按日期过滤（YYYY-MM-DD） |
| `limit` | number | 返回条数上限 |
| `offset` | number | 分页偏移 |

```bash
curl "http://localhost:3000/api/costs?agentId=research-bot&date=2024-01-15"
# { "entries": [...], "total": 5 }
```

#### `GET /api/costs/summary`

获取成本汇总报告。

```bash
curl "http://localhost:3000/api/costs/summary?agentId=research-bot"
# {
#   "totalCost": 0.006,
#   "totalCalls": 2,
#   "successfulCalls": 2,
#   "byAgent": { "research-bot": { "cost": 0.006, "calls": 2 } },
#   "byTool": { "intelligence_search": { "cost": 0.002, "calls": 2 } },
#   ...
# }
```

#### `GET /api/costs/agents`

按 Agent 汇总今日成本，降序排列。

```bash
curl "http://localhost:3000/api/costs/agents"
# [
#   { "agentId": "research-bot", "cost": 0.006, "calls": 2 },
#   { "agentId": "dev-bot",      "cost": 0.002, "calls": 1 }
# ]
```

#### `GET /api/costs/tools`

按 Tool 汇总今日成本，降序排列。

```bash
curl "http://localhost:3000/api/costs/tools"
# [
#   { "toolName": "web_crawl",          "cost": 0.005, "calls": 1 },
#   { "toolName": "intelligence_search","cost": 0.003, "calls": 3 },
#   { "toolName": "web_scrape",         "cost": 0.002, "calls": 1 }
# ]
```

### 与 M8（SLA 成本守卫）的联动

M8 ContractEnforcer 通过 `getCostLedger().getDailyCostForAgent(agentId)` 读取 Agent 今日累计成本，在超出预算时触发降级策略：

```typescript
// M8 示例（待实现）
const dailyCost = manager.getCostLedger().getDailyCostForAgent("research-bot");
if (dailyCost > contract.guarantees.maxCostPerDay) {
  // 触发 fallback 策略
}
```
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
