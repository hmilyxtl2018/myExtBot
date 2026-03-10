# Audit Logging

myExtBot maintains a comprehensive audit trail of all agent activity, stored in a SQLite database.

## Why Audit?

- **Accountability**: Every tool call records whether it was user-approved.
- **Replay**: The full sequence of events can be replayed to reconstruct what happened in a session.
- **Debugging**: Errors include full parameter and result payloads.
- **Compliance**: Organizations can require sign-off on high-risk operations.
- **LLM cost tracking**: Every LLM call records model, token usage, and latency.

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

### `artifacts`

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | UUID |
| `session_id` | TEXT FK | References `sessions.id` |
| `tool_call_id` | TEXT FK | References `tool_calls.id` (nullable) |
| `kind` | TEXT | `screenshot`, `file_content`, `command_output`, etc. |
| `data` | TEXT | Base64 or JSON payload |
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
| Screenshots and file snapshots | `artifacts` |
| Every LLM call (model, tokens, latency, phase) | `llm_calls` |

## Current Limitations

- The database is **in-memory** (`Connection::open_in_memory()`). All data is lost when the app closes. Persistence to `$APPDATA/myExtBot/audit.db` is planned for a future PR.
- `recent_entries()` currently only queries `tool_calls`; a unified cross-table view is planned.

## Replay

Entries are ordered by `timestamp`. To replay a session, read all rows for a given `session_id` in chronological order and re-emit them as `AgentEvent`s to the UI.
