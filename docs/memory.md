# Memory & Knowledge Database (K-DB)

## Overview

The **Knowledge Database (K-DB)** is the long-term memory layer of myExtBot. While the [Audit Log](audit.md) records *what happened*, the K-DB distils *what worked* into reusable, permanent assets that allow the digital twin to grow over time and adapt to the user's habits.

---

## Vision

The digital twin starts as a general-purpose agent. With each successful, verified task it accumulates structured knowledge:

- **Procedural memory** – Sequences of steps that reliably accomplish a goal (e.g., "deploy to staging" = run `npm run build`, git commit, git push, open the CI dashboard).
- **Contextual memory** – Facts about the user's environment (project structure, preferred tools, recurring URLs) that reduce the need for re-discovery.
- **Corrective memory** – Manual interventions applied by the user during a session, recording the user's preferred way to handle edge cases.

---

## Source Material: Golden RunGraph Traces

The K-DB is populated from **golden traces** (see [audit.md – Golden Traces](audit.md#golden-traces)). A golden trace is a complete, verified `RunGraph` execution path that has been promoted to permanent status.

A RunGraph path is a candidate for K-DB extraction when:

1. **Successful completion** – The session ended in `Completed` state.
2. **Verifier coverage** – High-risk nodes have at least one passing `Claim` (e.g., `verify.screen_changed`, `verify.exit_code_is`).
3. **Manual intervention recorded** – Any user correction (block_edge, replace_artifact, insert_verifier) is captured in the trace. These are especially valuable because they encode the user's domain knowledge.
4. **User promotion** – The user explicitly marks the trace as golden via the Audit UI, or the system auto-promotes when all of 1–3 are met and the overall confidence score exceeds the configured threshold (`kdb.auto_promote_threshold`, default `0.85`).

Example `config.toml` snippet:

```toml
[kdb]
auto_promote_threshold = 0.85   # 0.0–1.0; set to 1.0 to disable auto-promotion
blob_root = "kdb_blobs"         # relative to the app data directory
```

---

## Extraction Pipeline

When a session is promoted to golden, the following extraction steps run asynchronously:

```
Golden Session
    │
    ▼
1. Normalise RunGraph
   – Strip session-specific IDs; replace with stable content hashes.
   – Redact secrets from params (env vars, tokens).
    │
    ▼
2. Segment into ReusableSteps
   – Each contiguous sub-path with no failed nodes becomes a ReusableStep.
   – Manual interventions are annotated as "correction points".
    │
    ▼
3. Generate natural-language summary
   – LLM call: given the node labels + tool params, produce a short description
     of what this step sequence achieves and when it should be used.
    │
    ▼
4. Embed & store
   – Embedding vector stored alongside the summary and the raw ReusableStep graph.
   – Written to the k_db_entries table in SQLite (metadata) +
     k_db_blobs/<hash>.json (full graph).
```

---

## Schema

### `k_db_entries`

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | Content-hash UUID |
| `source_session_id` | TEXT | References the original `sessions.id` |
| `description` | TEXT | LLM-generated natural-language summary |
| `embedding` | BLOB | Float32 embedding vector (for similarity search) |
| `step_count` | INTEGER | Number of normalised steps |
| `has_intervention` | INTEGER | 1 if the trace includes a manual correction |
| `created_at` | TEXT | ISO-8601 |
| `blob_path` | TEXT | Path to `k_db_blobs/<hash>.json` |

---

## Usage: RAG (Retrieval-Augmented Generation)

At the start of each new task, the agent performs a **K-DB lookup**:

1. The user's request is embedded using the same model used during extraction.
2. The top-k most similar `k_db_entries` are retrieved by cosine similarity.
3. The matching `ReusableStep` graphs and their descriptions are injected into the LLM system prompt as **few-shot examples**.
4. The LLM produces a plan that is grounded in previously successful execution paths rather than reasoning from scratch.

This reduces hallucination, improves plan quality for recurring tasks, and allows the agent to reuse verified tool-call sequences directly.

---

## Usage: Auto-Approved Automated Scripts

ReusableSteps that meet a higher confidence bar can be promoted to **automated scripts**:

| Condition | Result |
|-----------|--------|
| `has_intervention = 0` (no manual corrections) AND confidence ≥ 0.95 | Eligible for auto-script promotion |
| User explicitly promotes a ReusableStep | Marked `auto_approve = true` regardless of score |

An auto-approved script is a pre-validated sequence of tool calls with known-good parameters. When the agent matches an incoming task to an auto-approved script, it can execute the full sequence **without individual approval dialogs** (the session permit cache is pre-populated).

The user can review, edit, or revoke auto-approved scripts at any time via a dedicated **Scripts** panel in the UI.

> **Safety note**: Auto-approval only applies to the exact parameter patterns captured in the script. Any deviation (different file path, different command argument) falls back to normal per-call approval.

---

## Growth Loop

```
New task
    │
    ▼
K-DB lookup → inject relevant ReusableSteps into LLM context
    │
    ▼
Agent executes task (with per-call approval as normal)
    │
    ▼
Session completes → verifiers run → golden trace candidate?
    │        yes
    ▼
Extract → embed → store in K-DB
    │
    ▼
Next similar task is handled faster, with higher confidence
```

Over time the digital twin builds a personalised library of verified, user-validated procedures. The agent becomes progressively more accurate on the tasks the user performs repeatedly, while retaining full auditability and user control at every step.

---

## Agent Auto-Retire & Memory Cleanup

K-DB entries have a configurable lifetime controlled by the `autoRetireAfterMinutes` setting in the agent's `memory.knowledgeDb` configuration. This section documents the full lifecycle from creation to permanent removal.

### `autoRetireAfterMinutes` Configuration

Set the `autoRetireAfterMinutes` property on an agent's `memory.knowledgeDb` to automatically expire entries after a given number of minutes:

```typescript
const agentSpec: AgentProfile = {
  id: "my-agent",
  name: "My Agent",
  memory: {
    knowledgeDb: {
      enabled: true,
      autoRetireAfterMinutes: 1440, // entries expire after 24 hours
    },
  },
};
```

When a new K-DB entry is created for this agent, its `expiresAt` field is set to `createdAt + autoRetireAfterMinutes`. Entries without `expiresAt` never expire.

---

### Lazy Cleanup (In-Memory Path)

When no `KnowledgeDbStore` (SQLite) is injected, `MemoryAdapter` uses an in-memory `Map`. Expired entries are lazily removed on every read or write operation:

| Method | Cleanup triggered |
|--------|------------------|
| `extractTrace()` | `purgeExpiredInMemory(agentId)` before inserting |
| `lookupSimilar()` | `purgeExpiredInMemory(agentId)` before searching |
| `getKnowledgeDb()` | `purgeExpiredInMemory(agentId)` before returning |

Entries where `expiresAt` is set and is in the past are removed from the Map. This ensures expired entries are invisible to queries without requiring a background process.

---

### Background Sweep (SQLite Path)

For the SQLite-backed path, two complementary sweepers run in the background:

#### 1. `MemoryAdapter` sweep (per-agent, agent-aware)

`McpServiceListManager.startAutoRetireSweep(intervalMs?)` starts a sweep via `MemoryAdapter` that iterates over registered agents and calls `store.deleteExpired(agentId)` for each agent that has `autoRetireAfterMinutes` configured. Default interval: **5 minutes**.

#### 2. `MemoryRetireSweeper` (global, automatic)

`MemoryRetireSweeper` is automatically started by `McpServiceListManager` on construction. It runs independently of agent registration:

- Calls `store.deleteExpired()` (no `agentId` — sweeps **all** agents) on each tick.
- Calls `store.purgeRetired(purgeRetiredOlderThanDays)` to permanently delete entries retired more than the configured threshold ago (default: **7 days**).
- Default interval: **60 seconds** (1 minute).
- Stopped automatically in `McpServiceListManager.close()`.

```typescript
// MemoryRetireSweeper is started automatically, but can also be used standalone:
import { MemoryRetireSweeper } from "./core/MemoryRetireSweeper";

const sweeper = new MemoryRetireSweeper(
  store,           // KnowledgeDbStore instance
  60_000,          // interval in ms (default: 60 000)
  7,               // purge entries retired > N days ago (default: 7)
);
sweeper.start();
// ...later:
sweeper.stop();
```

---

### Soft-Delete vs. Permanent Purge Lifecycle

K-DB cleanup uses a two-phase approach to balance resource efficiency with auditability:

```
Entry created  →  expiresAt reached
                       │
                       ▼
              Soft-delete (retiredAt set)
              Entry invisible to query()
              Entry visible to listRetired()
                       │
                  7 days later
                       │
                       ▼
              Permanent purge (purgeRetired)
              Row permanently deleted
```

| Phase | Method | Effect |
|-------|--------|--------|
| **Soft-delete** | `deleteExpired(agentId?)` | Sets `retiredAt` = now; entry hidden from `query()` |
| **Audit access** | `listRetired(agentId?)` | Returns all soft-deleted entries for review |
| **Permanent purge** | `purgeRetired(olderThanDays?)` | Permanently removes retired entries older than the threshold |

This means:
- Expired entries are **immediately invisible** to searches and `query()` results.
- Retired entries are **preserved for 7 days** (by default) to allow audit, debugging, or recovery.
- After the retention window, entries are **permanently deleted** to prevent unbounded database growth.

---

### Ensuring No Unbounded Memory Growth

The combination of lazy cleanup (in-memory path) and background sweep (SQLite path) ensures:

- **In-memory path**: Expired entries are removed on every access — no stale data accumulates.
- **SQLite path**: Expired entries are soft-deleted within 1 minute by `MemoryRetireSweeper` and permanently purged after 7 days.
- **Search results**: Both `query()` (SQLite) and `lookupSimilar()` (both paths) always exclude expired and retired entries.
