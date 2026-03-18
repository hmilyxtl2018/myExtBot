# Tools

All tools are registered in the `ToolRegistry` and validated against JSON Schemas before execution. Every tool call requires user approval (unless cached for the session).

## Tool List

### `fs.readFile`

Read the contents of a file.

```json
{
  "path": "/absolute/or/relative/path/to/file.txt"
}
```

**Risk**: medium  
**Status**: ✅ Implemented — calls `tokio::fs::read_to_string`

---

### `fs.applyPatch`

Apply a unified diff patch to a file.

```json
{
  "path": "/path/to/file.txt",
  "patch": "--- a/file.txt\n+++ b/file.txt\n@@ -1,3 +1,3 @@\n ..."
}
```

**Risk**: high  
**Status**: 🔶 Placeholder — returns `Err("not yet implemented")`

---

### `cmd.run`

Run a system command. Uses structured program + args (no shell expansion) to prevent injection.

```json
{
  "program": "git",
  "args": ["status"],
  "cwd": "/workspace"
}
```

**Risk**: high  
**Status**: ✅ Implemented — calls `tokio::process::Command`  
**Note**: Allowlist enforcement from `config.toml` is not yet wired; any program can run if the user approves.

---

### `net.fetch`

Perform an HTTP request.

```json
{
  "url": "https://api.example.com/data",
  "method": "GET",
  "headers": { "Authorization": "Bearer $TOKEN" }
}
```

**Risk**: high  
**Status**: 🔶 Placeholder — returns `Err("not yet implemented")`  
**Planned**: Implement using `reqwest` (already in `Cargo.toml`) with URL allowlist from `config.toml`.

---

### `desktop.screenshot`

Capture the primary display as a base64 PNG.

```json
{ "display": 0 }
```

**Risk**: medium  
**Status**: 🔶 Placeholder (Windows DXGI/GDI capture planned)

---

### `desktop.getActiveWindowInfo`

Get the title and bounding rect of the currently focused window.

```json
{}
```

**Risk**: low  
**Status**: 🔶 Placeholder (Windows `GetForegroundWindow` planned)

---

### `desktop.clickRectCenter`

Click the center of a screen rectangle.

```json
{ "x": 100, "y": 200, "width": 300, "height": 50 }
```

**Risk**: high  
**Status**: 🔶 Placeholder (Windows `SendInput` planned)

---

### `desktop.ocrCloud`

Send an image to an OpenAI-compatible Vision API and extract text.

```json
{
  "image_b64": "<base64-encoded-png>",
  "prompt": "Extract all visible text"
}
```

**Risk**: medium  
**Status**: 🔶 Placeholder — Vision API call planned

---

## Schema Validation

All parameters are validated against the tool's JSON Schema (Draft-07) by `ToolRegistry::validate_params` before the approval modal is shown. Invalid calls are rejected immediately.

## Executor Dispatch

`executor.rs` contains a hardcoded `match` that routes each tool name to its Rust implementation. Placeholder tools return an `Err` that the Executor records as a step failure and continues to the next step (unless downstream steps depend on the failed one).

## Known Gaps

| Gap | Detail |
|-----|--------|
| Allowlist not enforced | `permissions.rs` has the data structures, but `commands.rs` / `executor.rs` do not yet call `PermissionManager::is_permitted_session` before dispatching |
| `net.fetch` not implemented | reqwest is available; just needs wiring |
| All `desktop.*` tools placeholder | Require Windows-specific APIs not yet implemented |
| Artifact storage | Screenshots and file snapshots are not yet saved to the `artifacts` table |

