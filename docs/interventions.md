# Interventions

Interventions are user-initiated graph modifications that let you correct or
constrain the agent's execution mid-stream. All interventions are persisted to
the `interventions` table and emit an `InterventionApplied` event.

---

## Available Interventions

### `block_edge`

Marks a data edge as **blocked**, preventing downstream nodes from consuming the
data that flows through it. The edge is rendered as a dashed orange line in the
graph view.

**Effect on graphs:**
- The edge's `blocked` flag is set to `1` in `run_edges`.
- The UI renders the edge as dashed/orange.
- Downstream nodes that depend on this edge's data should treat their inputs as
  unavailable (confidence drops to 0 for affected data edges).

**Tauri command:**
```typescript
await invoke("block_edge", { edgeId: "edge-uuid" });
```

**Event emitted:**
```json
{
  "type": "InterventionApplied",
  "intervention": { "kind": "block_edge", "payload": { "edge_id": "..." } }
}
```

---

### `replace_artifact`

Creates a new artifact and rewires selected data edges to point to the new
artifact instead of the old one. The old artifact is kept for audit purposes.

**Effect on graphs:**
- A new artifact node is created.
- The specified edges' `dst_node_id` conceptually points to the new artifact
  (tracked in the intervention payload).
- An `ArtifactCreated` event is emitted for the new artifact.
- The old artifact remains in the DB as an audit trail.

**Tauri command:**
```typescript
await invoke("replace_artifact", {
  oldArtifactId: "old-uuid",
  newData: { /* new artifact content */ },
  rewireEdgeIds: ["edge1-uuid", "edge2-uuid"]
});
```

**Event emitted:**
```json
{
  "type": "InterventionApplied",
  "intervention": {
    "kind": "replace_artifact",
    "payload": {
      "old_artifact_id": "...",
      "new_artifact_id": "...",
      "rewire_edge_ids": ["..."]
    }
  }
}
```

---

### `insert_verifier`

Inserts a verifier node between two existing control-flow nodes. The verifier is
run immediately; its result creates a Claim and updates the verifier node's
confidence.

**Effect on graphs:**
- A new `verifier` kind `run_node` is created.
- Two edges are added:
  - `src → verifier_node` (kind: `verification`)
  - `verifier_node → dst` (kind: `control`)
- A `VerifierResult` event is emitted with the claim.

**Tauri command:**
```typescript
await invoke("insert_verifier", {
  srcNodeId: "node-uuid",
  dstNodeId: "node-uuid",
  verifier: "verify.screen_changed",
  params: { threshold: 0.05 }
});
```

**Events emitted:**
1. `GraphNodeAdded` — the new verifier node
2. `GraphEdgeAdded` × 2 — the two new edges
3. `VerifierResult` — the claim from running the verifier
4. `InterventionApplied`

---

## How Interventions Affect Confidence

| Intervention      | Confidence Impact                                   |
|-------------------|-----------------------------------------------------|
| `block_edge`      | Downstream data-consuming nodes lose their input confidence signal |
| `replace_artifact`| New artifact starts with no confidence; verifiers on edges to it establish initial confidence |
| `insert_verifier` | Verifier result directly updates the new verifier node's confidence using the standard claim rule |

---

## Audit Trail

All interventions are stored in the `interventions` table with their full
`payload_json`. They can be queried alongside the RunGraph to reconstruct the
complete history of human corrections.
