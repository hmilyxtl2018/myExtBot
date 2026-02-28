# RunGraph Data Model & Event Types

RunGraph is myExtBot's observability layer. It represents the agent's execution
as a directed graph of **nodes** and **edges**, persisted to SQLite and streamed
to the UI in real-time over the Tauri event bus.

---

## Tables

### `run_nodes`

| Column        | Type    | Description                                    |
|---------------|---------|------------------------------------------------|
| `id`          | TEXT PK | UUID                                           |
| `session_id`  | TEXT FK | References `sessions(id)`                     |
| `kind`        | TEXT    | `tool_call \| screenshot \| verifier \| user_message \| agent_message` |
| `tool`        | TEXT?   | Tool name (e.g. `desktop.clickRectCenter`)    |
| `status`      | TEXT    | `pending \| running \| completed \| failed \| blocked` |
| `confidence`  | REAL?   | 0–1 confidence score (updated by verifiers)   |
| `inputs_json` | TEXT?   | JSON-serialised input parameters              |
| `outputs_json`| TEXT?   | JSON-serialised output                        |
| `timestamp`   | TEXT    | RFC-3339 creation time                        |

### `run_edges`

| Column        | Type    | Description                                    |
|---------------|---------|------------------------------------------------|
| `id`          | TEXT PK | UUID                                           |
| `session_id`  | TEXT FK | References `sessions(id)`                     |
| `src_node_id` | TEXT FK | Source node                                   |
| `dst_node_id` | TEXT FK | Destination node                              |
| `edge_kind`   | TEXT    | `control \| data \| verification`             |
| `blocked`     | INTEGER | 0/1 — blocked by intervention                 |
| `timestamp`   | TEXT    | RFC-3339 creation time                        |

### `claims`

Verifier results. Each row is one verifier assertion against a node.

| Column        | Type    | Description                          |
|---------------|---------|--------------------------------------|
| `id`          | TEXT PK | UUID                                 |
| `session_id`  | TEXT FK |                                      |
| `run_node_id` | TEXT FK | The node being verified              |
| `verifier`    | TEXT    | e.g. `verify.screen_changed`         |
| `result`      | TEXT    | `pass \| fail \| skip`              |
| `score`       | REAL?   | Raw score (0–1)                      |
| `detail`      | TEXT?   | Human-readable explanation           |
| `timestamp`   | TEXT    |                                      |

### `interventions`

User-initiated graph modifications.

| Column        | Type    | Description                                    |
|---------------|---------|------------------------------------------------|
| `id`          | TEXT PK |                                                |
| `session_id`  | TEXT FK |                                                |
| `kind`        | TEXT    | `block_edge \| replace_artifact \| insert_verifier` |
| `payload_json`| TEXT    | Kind-specific JSON payload                    |
| `timestamp`   | TEXT    |                                                |

### `verifier_rules`

User-defined verifier rules (see [verifiers.md](verifiers.md)).

| Column       | Type  | Description                          |
|--------------|-------|--------------------------------------|
| `id`         | TEXT  |                                      |
| `session_id` | TEXT? | NULL means global                    |
| `scope`      | TEXT  | `task` (default) \| `session` \| `global` |
| `name`       | TEXT  |                                      |
| `rule_json`  | TEXT  | Full DSL JSON                        |
| `timestamp`  | TEXT  |                                      |

---

## Event Types

All events are emitted over the `agent-event` Tauri event channel as JSON with a
`"type"` discriminant field.

### `GraphNodeAdded`

```json
{
  "type": "GraphNodeAdded",
  "node": { "id": "...", "kind": "tool_call", "tool": "desktop.clickRectCenter",
            "status": "pending", "session_id": "...", "timestamp": "..." }
}
```

Emitted when a new node is created (e.g. before a tool call is dispatched).

### `GraphNodeUpdated`

```json
{
  "type": "GraphNodeUpdated",
  "node": { "id": "...", "status": "completed", "confidence": 0.9,
            "outputs": { ... }, ... }
}
```

Emitted when a node's status, outputs, or confidence changes.

### `GraphEdgeAdded`

```json
{
  "type": "GraphEdgeAdded",
  "edge": { "id": "...", "src": "nodeA", "dst": "nodeB",
            "kind": "control", "blocked": false, "timestamp": "..." }
}
```

### `ArtifactCreated`

```json
{
  "type": "ArtifactCreated",
  "artifact_id": "...",
  "run_node_id": "...",
  "kind": "screenshot"
}
```

Links a new artifact (screenshot, file, etc.) to the node that produced it.

### `VerifierResult`

```json
{
  "type": "VerifierResult",
  "claim": {
    "id": "...", "run_node_id": "...", "verifier": "verify.screen_changed",
    "result": "pass", "score": 0.87, "detail": "diff=0.87 threshold=0.05"
  }
}
```

### `InterventionApplied`

```json
{
  "type": "InterventionApplied",
  "intervention": {
    "id": "...", "kind": "block_edge",
    "payload": { "edge_id": "..." }, "timestamp": "..."
  }
}
```

---

## Graph Views

The UI renders two views from the same graph data:

### Execution Trace (time/control-flow oriented)

Shows all nodes in execution order connected by **control** edges. Useful for
understanding the sequence of actions and identifying where failures occurred.

### Data Lineage (artifact/claim oriented)

Shows only `tool_call`, `screenshot`, `verifier`, and `agent_message` nodes
connected by **data** and **verification** edges. Useful for tracing where data
originated and how it was verified before reaching the final response.
