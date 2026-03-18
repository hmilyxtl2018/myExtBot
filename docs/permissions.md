# Permissions

myExtBot uses a layered permission system to ensure the agent cannot take actions beyond what the user has explicitly authorized.

## Layers

### 1. Static Allowlists (config.toml)

Defined at startup, these are hard gates before any tool call is even proposed:

- **`permissions.fs.read_allow`** – Glob patterns for paths the agent may read.
- **`permissions.fs.write_allow`** – Glob patterns for paths the agent may write/patch.
- **`permissions.cmd.allow`** – Executable names or paths that may be run.
- **`permissions.net.allow`** – URL patterns the agent may fetch.

If a tool call references a resource not in the allowlist, it is rejected immediately without presenting an approval dialog.

### 2. Per-Call Approval (UI Modal)

For every tool call that passes the allowlist check, the agent proposes the call and waits for explicit user approval. The `ApprovalModal` displays:

- Tool name and human-readable description
- Risk level (low / medium / high)
- Full parameter object (so the user can inspect exactly what will happen)

### 3. Session-Scoped Permit Cache

When approving a tool call, the user may check **"Allow for this session"**. This caches the approval in `PermissionManager::session_tool_permits` for the duration of the app session.

The cache is cleared on emergency stop.

## Approval Scopes

| Scope | Behavior |
|-------|----------|
| `once` | Each individual call requires approval |
| `session` | Approval is cached for the session for this tool |
| `never` | Tool is always blocked (use to disable tools) |

## Signatures

Tool call IDs are UUIDs. The audit log records whether each call was approved (`approved = true/false`), enabling post-hoc auditing of what the agent was permitted to do.

## Emergency Stop

`emergency_stop` (Tauri command / EmergencyStop button) immediately:
1. Cancels the in-flight operation via `CancelToken`.
2. Transitions the agent to `Stopped`.
3. Clears the session permit cache.
4. Emits `AgentEvent::EmergencyStop` to the UI.
