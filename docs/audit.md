# Audit Logging

myExtBot maintains a comprehensive audit trail of all agent activity, stored in a SQLite database.

## Why Audit?

- **Accountability**: Every tool call records whether it was user-approved.
- **Replay**: The full sequence of events can be replayed to reconstruct what happened in a session.
- **Debugging**: Errors include full parameter and result payloads.
- **Compliance**: Organizations can require sign-off on high-risk operations.
- **LLM cost tracking**: Every LLM call records model, token usage, and latency.

---

## Storage Tiering

The audit system uses a **two-tier storage model** to balance queryability with storage efficiency.

### Tier 1 – SQLite (Structured / Queryable Data)

Structured, low-to-medium size records live in SQLite where they can be queried, joined, and indexed. The following tables form the core schema:

| Table | Contents |
|-------|----------|
| `sessions` | Session lifecycle (start/end timestamps, metadata) |
| `messages` | Chat messages (user, assistant, system roles) |
| `tool_calls` | Every proposed and executed tool call, with approval status |
| `run_nodes` | Nodes in the RunGraph (tool calls, verifications, interventions) |
| `run_edges` | Directed edges between RunGraph nodes (control-flow and data-flow) |
| `claims` | Verifier assertions attached to a run node |
| `artifacts` | Metadata record for each artifact, with a `blob_path` or `blob_hash` reference into Tier 2 |

Large binary columns (e.g., screenshots stored as Base64) must **not** be placed directly in SQLite. Instead, a row in `artifacts` stores the metadata and a pointer to the Tier 2 blob.

### Tier 2 – File System / Blob Storage (Large Artifacts)

Binary and large-text artifacts are written to disk under a structured path and referenced by **content-addressable hash** or **session-scoped path** in the `artifacts.blob_path` column.

| Artifact type | Stored as | Example path |
|---------------|-----------|--------------|
| Screenshot (PNG) | Binary file | `blobs/<session_id>/screenshots/<hash>.png` |
| HTML DOM snapshot | Compressed text | `blobs/<session_id>/doms/<hash>.html.gz` |
| Downloaded file | Binary file | `blobs/<session_id>/downloads/<filename>` |
| Command stdout/stderr | Text file | `blobs/<session_id>/cmd/<tool_call_id>.txt` |

The `blob_path` column in `artifacts` stores the path relative to the configured `audit.blob_root` directory. The `blob_hash` column stores the SHA-256 content hash for integrity verification.

---

## Schema

### `sessions`

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | UUID session identifier |
| `started_at` | TEXT | ISO-8601 timestamp |
| `ended_at` | TEXT | ISO-8601 timestamp (nullable) |
| `metadata` | TEXT | JSON blob for extra context |

### `messages`

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | UUID |
| `session_id` | TEXT FK | References `sessions.id` |
| `role` | TEXT | `user` / `assistant` / `system` |
| `content` | TEXT | Message body |
| `timestamp` | TEXT | ISO-8601 |

### `tool_calls`

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | UUID (same as `ToolCallRequest.id`) |
| `session_id` | TEXT FK | References `sessions.id` |
| `tool` | TEXT | Tool name (e.g. `fs.readFile`) |
| `params` | TEXT | JSON-serialized parameters |
| `result` | TEXT | JSON-serialized result (nullable until complete) |
| `approved` | INTEGER | 1 = user approved, 0 = denied |
| `timestamp` | TEXT | ISO-8601 |
| `duration_ms` | INTEGER | Execution duration in milliseconds |

### `run_nodes`

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | UUID |
| `session_id` | TEXT FK | References `sessions.id` |
| `kind` | TEXT | `tool_call`, `verifier`, `intervention`, `llm_turn` |
| `label` | TEXT | Human-readable node label |
| `status` | TEXT | `pending` / `running` / `success` / `failed` / `blocked` |
| `confidence` | REAL | Confidence score after verifier results (0.0–1.0) |
| `created_at` | TEXT | ISO-8601 |

### `run_edges`

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | UUID |
| `session_id` | TEXT FK | References `sessions.id` |
| `source_node_id` | TEXT FK | References `run_nodes.id` |
| `target_node_id` | TEXT FK | References `run_nodes.id` |
| `edge_type` | TEXT | `control_flow` / `data_flow` |
| `blocked` | INTEGER | 1 = edge blocked by intervention |

### `claims`

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | UUID |
| `run_node_id` | TEXT FK | References `run_nodes.id` |
| `verifier` | TEXT | Verifier name (e.g. `verify.screen_changed`) |
| `passed` | INTEGER | 1 = assertion passed |
| `detail` | TEXT | JSON evidence payload |
| `timestamp` | TEXT | ISO-8601 |

### `artifacts`

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | UUID |
| `session_id` | TEXT FK | References `sessions.id` |
| `tool_call_id` | TEXT FK | References `tool_calls.id` (nullable) |
| `run_node_id` | TEXT FK | References `run_nodes.id` (nullable) |
| `kind` | TEXT | `screenshot`, `html_dom`, `download`, `cmd_output`, etc. |
| `blob_path` | TEXT | Relative path under `audit.blob_root` |
| `blob_hash` | TEXT | SHA-256 hex digest of the blob content |
| `timestamp` | TEXT | ISO-8601 |

### `llm_calls`

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | UUID |
| `session_id` | TEXT FK | References `sessions.id` |
| `phase` | TEXT | `"planning"` or `"executing"` |
| `model` | TEXT | Model name (e.g. `gpt-4o`) |
| `prompt_tokens` | INTEGER | Tokens in the prompt |
| `completion_tokens` | INTEGER | Tokens in the completion |
| `duration_ms` | INTEGER | Round-trip latency in milliseconds |
| `timestamp` | TEXT | ISO-8601 |

> **Note**: The `planning` phase currently logs zero token counts because the
> Planner does not yet thread usage data back up to `commands.rs`. The
> `executing` phase logs accurate counts per step.

## What Is Logged

| Event | Table |
|-------|-------|
| Session start/end | `sessions` |
| User and agent messages | `messages` |
| Every proposed tool call (approved or denied) | `tool_calls` |
| Tool execution results + duration | `tool_calls.result` + `tool_calls.duration_ms` |
| RunGraph node/edge lifecycle | `run_nodes`, `run_edges` |
| Verifier assertions | `claims` |
| Screenshot and file artifact metadata | `artifacts` (blob in Tier 2) |
| Every LLM call (model, tokens, latency, phase) | `llm_calls` |

---

## Data Retention & Pruning

The following policy governs how long data is kept. It is enforced by a background pruning job that runs at app startup and then at **midnight local time** (00:00) every day.

| Data category | Retention rule |
|---------------|---------------|
| **Ephemeral logs** (sessions with no successful tool calls, debug/trace events) | Purged after **7 days** |
| **Normal sessions** (completed with at least one approved tool call) | Kept for **90 days**, then SQLite rows deleted and blobs removed |
| **Golden traces** (sessions marked `golden = true`; see below) | **Kept permanently** |
| **Blob files** for deleted sessions | Removed together with the session rows |

### Golden Traces

A session is marked as a **golden trace** when all of the following are true:
1. The session completed successfully (state = `Completed`).
2. At least one verifier claim passed for each high-risk tool call.
3. Any manual interventions applied during the session are recorded in `interventions`.

A user may also manually promote any session to golden via the Audit UI. Golden traces feed the [Knowledge Database](memory.md) for long-term learning.

---

## Current Limitations

- The database is **in-memory** (`Connection::open_in_memory()`). All data is lost when the app closes. Persistence to `$APPDATA/myExtBot/audit.db` is planned for a future PR.
- `recent_entries()` currently only queries `tool_calls`; a unified cross-table view is planned.

## Replay

Entries are ordered by `timestamp`. To replay a session, read all rows for a given `session_id` in chronological order and re-emit them as `AgentEvent`s to the UI.
