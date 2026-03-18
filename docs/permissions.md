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

---

## Security & Sandboxing

### Directory Jail (`fs.*`)

All `fs.*` operations are restricted to a **workspace root** configured at startup. The agent may not read or write files outside of this directory tree.

**Enforcement rules:**

1. **Workspace root** – Set via `permissions.fs.workspace` in `config.toml` (e.g., `C:\Users\alice\projects\myWorkspace`). All resolved file paths must be prefixed with this root after canonicalization; paths that escape via `..` traversal are rejected.
2. **Read allowlist** – `permissions.fs.read_allow` accepts glob patterns relative to the workspace root (e.g., `**/*.ts`, `src/**`). A read attempt on a path that matches no pattern is denied even if the path is inside the workspace.
3. **Write allowlist** – `permissions.fs.write_allow` similarly limits where the agent may create or modify files. Sensitive paths such as `.git/config`, `*.env`, and system directories should never appear here.
4. **Symlink resolution** – All paths are fully resolved (following symlinks) before allowlist comparison. Symlinks pointing outside the workspace are rejected.

Example `config.toml` snippet:

```toml
[permissions.fs]
workspace    = "C:\\Users\\alice\\projects\\myWorkspace"
read_allow   = ["**"]
write_allow  = ["src/**", "tests/**"]
```

### Cmd Guardrails (`cmd.run`)

The `cmd.run` tool is restricted to an explicit **allowlist of executables**, and each executable optionally has an **argument validation schema**.

**Enforcement rules:**

1. **Executable allowlist** – Only programs listed in `permissions.cmd.allow` may be invoked. The list contains the bare program name (e.g., `git`, `npm`); the Rust core resolves the full path via `PATH` and verifies it matches.
2. **Argument validation** – Each allowlisted command may optionally specify a JSON Schema for its `args` array. Arguments are validated against the schema before execution. Unrecognised argument patterns (e.g., shell metacharacters, piping tokens `|`, `>`, `;`) are rejected.
3. **No shell expansion** – Commands are executed via `Command::new` with explicit `args`; they are **never** passed to a shell interpreter (`cmd.exe /c` or `bash -c`). This prevents shell injection.
4. **Working directory** – The working directory for `cmd.run` is always the workspace root; it cannot be overridden by the agent.

Example `config.toml` snippet:

```toml
[permissions.cmd]
allow = ["git", "npm", "node"]

[permissions.cmd.arg_schemas.git]
# Only allow safe read-only and common write operations
allowed_subcommands = ["status", "diff", "log", "add", "commit", "push", "pull", "checkout"]

[permissions.cmd.arg_schemas.npm]
allowed_subcommands = ["install", "run", "test", "build"]
```

### Network Guardrails (`net.fetch`)

URL patterns in `permissions.net.allow` are matched against the full URL (scheme + host + path) using glob syntax. Requests to unlisted URLs are blocked before the HTTP connection is opened. Private/loopback addresses (e.g., `127.0.0.1`, `192.168.*`) require an explicit entry and are not permitted by default.

Example `config.toml` snippet:

```toml
[permissions.net]
allow = [
  "https://api.openai.com/**",
  "https://*.githubusercontent.com/**",
]
```
