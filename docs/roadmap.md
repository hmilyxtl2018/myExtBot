# Roadmap

> Last updated: 2026-03-21

This document tracks what has been delivered, what is in progress, and what comes next for myExtBot.

---

## Completed

### Phase 1 — Foundation & Type Safety

| Item | PR(s) | Status |
|------|-------|--------|
| TypeScript compilation fixes (`tsc --noEmit` exits 0) | #33 | ✅ Done |
| 9-Pillar AgentSpec type definitions (Pillars 1-9) | #26 | ✅ Done |
| AgentSpec registration schema validation | #35 | ✅ Done |
| Unit tests for CommunicationBridge, OrchestrationAdapter, MemoryAdapter | #34 | ✅ Done |
| Security hardening — 7-layer defence-in-depth middleware | #7 | ✅ Done |

### Milestones M1–M10 — Core Digital-Asset Features

| Milestone | Feature | PR(s) | Status |
|-----------|---------|-------|--------|
| M1 | DelegationLog disk persistence + REST API | #9 | ✅ Done |
| M2 | Plugin Marketplace — install/uninstall with REST API | #11 | ✅ Done |
| M3 | Multi-Agent Pipeline — sequential execution with context threading | #12, #20 | ✅ Done |
| M4 | Service Health Monitoring — passive tracking, fallback routing | #13, #21 | ✅ Done |
| M5 | Cost Ledger — per-call cost tracking for all Tool dispatches | #14 | ✅ Done |
| M6 | Agent Intent & Persona with intent-driven AgentRouter | #15 | ✅ Done |
| M7 | Scene Trigger Engine — keyword/time/agent/health auto-detection | #16 | ✅ Done |
| M8 | Agent SLA Contract enforcement | #17 | ✅ Done |
| M9 | Asset Lineage Graph — directed call graph from DelegationLog | #18 | ✅ Done |
| M10 | Agent Lifecycle State Machine | #10, #19 | ✅ Done |

### Phase 2 — Replace Stubs with Real Implementations

| Item | PR(s) | Status |
|------|-------|--------|
| SearchService → real Perplexity API with graceful fallback | #37 | ✅ Done |
| PluginService — timeout, exponential retry, structured errors | #38, #39 | ✅ Done |
| K-DB SQLite persistence via KnowledgeDbStore | #40 | ✅ Done |
| MemoryAdapter full KnowledgeDbStore integration | #44 | ✅ Done |
| Desktop automation tools — screenshot, click_rect, OCR via Tauri IPC | #45 | ✅ Done |

### Phase 3 — Bridge TypeScript Core ↔ Rust Desktop

| Item | PR(s) | Status |
|------|-------|--------|
| Sync AgentSpec types to Rust (9-pillar type parity) | #46 | ✅ Done |
| Tauri commands ↔ McpServiceListManager HTTP bridge | #47 | ✅ Done |
| Planner integrates AgentSpec routing via AgentRouter | #48–#51 | ✅ Done |

---

## Next — Phase 4: Production-Grade Features

> Tracking issue: [#31](https://github.com/hmilyxtl2018/myExtBot/issues/31)

### 4.1 LLM Prompt Injection from AgentSpec ✅ Done (#56)

- Inject `AgentSpec.prompts.system` as the LLM system prompt so each agent carries its own persona and instructions.
- Support `prompts.preamble` and `prompts.suffix` for composable prompt templates.

### 4.2 Auto-Retire Mechanism ✅ Done (#57)

- Honour `memory.autoRetireAfterMinutes` in the MemoryAdapter.
- Implement lazy cleanup on `extractTrace()` and/or a background `setInterval` sweep.
- Expired entries are soft-deleted in KnowledgeDbStore (retain for audit, exclude from search).

### 4.3 GuardrailsEnforcer ✅ Done (#55)

- Input/output content filtering (block PII, secrets, banned patterns).
- Per-agent cost ceiling — halt tool execution when an agent exceeds its `guardrails.maxCostPerTask`.
- Mandatory human-approval gate for high-risk tools (configurable via `guardrails.requireApproval`).
- Integrate as middleware before every `dispatch()` / `dispatchAs()` call.

### 4.4 K-DB RAG Integration

- Add a vector-similarity path to `KnowledgeDbStore.search()` (e.g. via `sqlite-vss` or an external embedding service).
- `lookupSimilar()` returns semantically relevant memories, not just keyword matches.
- Optional hybrid search: keyword + vector, with configurable weight.

### 4.5 AgentSpec Schema Versioning

- Add a `specVersion` field to AgentSpec (initial value `"1.0"`).
- Dispatch to version-specific validators (see `AgentSpecValidator.ts` TODO).
- Provide migration helpers for future schema upgrades.

---

## Next — Phase 5: Quality Engineering

### 5.1 CI/CD Pipeline

- GitHub Actions workflow: lint → type-check (`tsc --noEmit`) → unit tests (`jest`) → build. ✅ Done (#53)
- Gate PRs on passing CI. ✅ Done (#53)
- Automate Tauri desktop builds for Windows (and optionally macOS/Linux). ✅ Done (#53)

### 5.2 API Documentation

- Auto-generate OpenAPI/Swagger spec from Express route definitions.
- Publish interactive API docs to GitHub Pages alongside existing docs.

### 5.3 Integration & E2E Tests

- Integration tests for REST API routes (supertest or similar).
- E2E tests covering the Tauri desktop flow (Playwright + Tauri driver).
- Target ≥ 80 % line coverage for `src/core/` and `src/api/`.

### 5.4 Observability

- Structured JSON logging (replace ad-hoc `console.log`).
- OpenTelemetry traces for cross-agent pipeline execution.
- Expose `/metrics` endpoint (Prometheus format) from the Express server.

---

## Future — Phase 6: Ecosystem & Scaling

> Items below are exploratory; sequencing will be refined after Phase 5.

| Area | Description |
|------|-------------|
| **Multi-user support** | Tenant isolation — each user gets their own agent fleet, cost ledger, and audit DB. |
| **Cloud deployment** | Package the Express server as a Docker container; deploy the Playwright sidecar as a sidecar pod. |
| **Plugin SDK** | Publish an npm package (`@myextbot/plugin-sdk`) so third-party developers can author, test, and distribute plugins. |
| **Natural-language config** | Let users describe agent behaviour in plain language; the system generates the `AgentSpec` TOML/JSON automatically. |
| **Cross-platform desktop** | Expand first-class support to macOS and Linux (currently Windows-first). |
| **Agent-to-agent auth** | Mutual TLS or token-based authentication for inter-agent delegation across network boundaries. |
