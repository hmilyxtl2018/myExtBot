# Architecture

## Overview

myExtBot is a Windows-first "digital twin" desktop bot, structured as:

```
┌──────────────────────────────────────────────────────┐
│  Tauri Desktop App (apps/desktop)                    │
│                                                      │
│  ┌──────────────┐    ┌──────────────────────────┐   │
│  │  React UI    │◄───│  Rust Event Bus           │   │
│  │  (Vite)      │    │  (Tauri IPC / agent-event)│   │
│  └──────┬───────┘    └──────────┬───────────────┘   │
│         │ invoke/listen         │                     │
│         │              ┌────────┴──────────┐         │
│         │              │  Agent FSM        │         │
│         │              │  (9 states)       │         │
│         │              └────────┬──────────┘         │
│         │                       │                     │
│         │              ┌────────┴──────────┐         │
│         │              │  Planner (LLM)    │         │
│         │              │  → AgentPlan      │         │
│         │              └────────┬──────────┘         │
│         │                       │                     │
│         │              ┌────────┴──────────┐         │
│         │              │  Executor (LLM)   │         │
│         │              │  → tool dispatch  │         │
│         │              └────────┬──────────┘         │
│         │                       │                     │
│         │              ┌────────┴──────────┐         │
│         │              │  Tool Registry    │         │
│         │              │  + Permissions    │         │
│         │              └────────┬──────────┘         │
│         │                       │                     │
│         │              ┌────────┴──────────┐         │
│         │              │  Audit DB         │         │
│         │              │  (SQLite)         │         │
│         │              └───────────────────┘         │
└─────────┼────────────────────────────────────────────┘
          │ WebSocket JSON-RPC (planned)
          ▼
┌──────────────────────────────────┐
│  Playwright Sidecar              │
│  (services/playwright-sidecar)   │
│  Node.js + Playwright            │
└──────────────────────────────────┘
          │
          ▼
    Browser (Chromium)
```

## Modules

### apps/desktop/src-tauri/src/

| Module | Purpose | Status |
|--------|---------|--------|
| `events.rs` | Typed event model — `AgentEvent` enum, `AgentStatus`, `AgentPlan`, etc. | ✅ Complete |
| `agent.rs` | 9-state FSM with oneshot approval channels for plan and tool calls | ✅ Complete |
| `llm.rs` | OpenAI-compatible client — `chat_completion`, zeroizing `ApiKey`, `LlmError` | ✅ Complete |
| `planner.rs` | `run_planner()` — single LLM call produces a structured `AgentPlan` | ✅ Complete |
| `executor.rs` | `run_executor()` — topological step traversal, per-step LLM, approval gate | ✅ Complete |
| `commands.rs` | Tauri IPC: `send_message`, `approve/deny_plan`, `approve/deny_tool_call`, `get_audit_log` | ✅ Complete |
| `permissions.rs` | Session-scoped permit cache; static allowlists not yet wired | 🔶 Partial |
| `audit.rs` | SQLite (5 tables) — sessions, messages, tool_calls, artifacts, llm_calls | ✅ Complete |
| `tools/` | Registry + JSON Schema validation + 8 tool definitions | ✅ Registry; tools partial |

### apps/desktop/src/ (React)

| Component | Purpose | Status |
|-----------|---------|--------|
| `ChatPanel` | User/assistant chat messages | ✅ Complete |
| `PlanPanel` | Live execution plan progress | ✅ Complete |
| `ApprovalModal` | Tool-call approval dialog | ✅ Complete |
| `PlanApprovalModal` | Plan approval dialog (new) | ✅ Complete |
| `AuditTimeline` | Real-time audit event stream | ✅ Complete |
| `AgentLogPanel` | Agent thinking + tool results | ✅ Complete |
| `EmergencyStop` | One-click agent halt | ✅ Complete |
| `useEventStream` | Tauri event listener hook | ✅ Complete |

### services/playwright-sidecar/

WebSocket JSON-RPC 2.0 server. The Tauri backend connects as a client and invokes browser automation via structured method calls. Currently a scaffold — method implementations are placeholders.

## Agent FSM

```
Idle ──────────────────────────────────────► Planning
                                                │
                              ┌─────────────────┴──── Failed
                              │
                              ▼
                       WaitingPlanApproval
                         │         │
                    deny │         │ approve
                         ▼         ▼
                        Idle     Thinking ◄──────────────────────┐
                                   │                              │
                        ┌──────────┴────────────┐                │
                        │                       │                 │
                        ▼                       ▼                 │
                  WaitingApproval          Completed              │
                    │       │                                     │
               deny │       │ approve                            │
                    ▼       ▼                                     │
                 Thinking  RunningTool ──────────────────────────┘
                              │
                              ▼
                           Completed / Failed

Any state ──► Stopped (emergency stop)
Stopped  ──► Idle
```

| State | Meaning |
|-------|---------|
| `Idle` | Waiting for user input |
| `Planning` | Planner LLM call in progress |
| `WaitingPlanApproval` | Plan generated, waiting for user to approve/cancel |
| `Thinking` | Executor LLM call in progress for a specific step |
| `WaitingApproval` | Tool call proposed, waiting for user approval |
| `RunningTool` | Tool executing |
| `Completed` | All steps done |
| `Failed` | Unrecoverable error |
| `Stopped` | Emergency stop triggered |

## Message Flow

```
User types message
    → React invoke("send_message")
    → Rust: log to audit DB, emit ChatMessage
    → transition: Idle → Planning
    → emit: PlanningStarted
    → Planner LLM call → AgentPlan
    → emit: PlanReady { plan }
    → transition: Planning → WaitingPlanApproval
    → React shows PlanApprovalModal
    → User clicks "批准执行" → invoke("approve_plan")
    → transition: WaitingPlanApproval → Thinking
    → Executor loops over plan.steps (topological order):
        → Executor LLM call → ToolCall { name, arguments }
        → transition: Thinking → WaitingApproval
        → emit: ToolCallRequest
        → React shows ApprovalModal
        → User approves → invoke("approve_tool_call")
        → transition: WaitingApproval → RunningTool
        → Tool dispatched, result captured
        → emit: ToolCallResult
        → audit DB updated
        → transition: RunningTool → Thinking (next step)
    → All steps done → transition: → Completed
```

