# myExtBot

A Windows-first "digital twin" desktop bot inspired by Cline. Built with:

- **Tauri 2** (Rust backend) + **React** (Vite frontend)
- **Node.js Playwright sidecar** for browser automation
- **SQLite** audit log (all events, tool calls, LLM calls, and artifacts)
- **Planner + Executor** dual-layer LLM architecture
- **Permissioned tool execution**: every tool call requires user approval

---

## Current Status

> See [PROGRESS.md](PROGRESS.md) for a full breakdown of what is complete, what is a placeholder, and what comes next.

| Layer | Status |
|-------|--------|
| Agent FSM (9 states) | ✅ Complete |
| LLM client (OpenAI-compatible) | ✅ Complete |
| Planner (prompt → AgentPlan) | ✅ Complete |
| Executor (plan → tool calls) | ✅ Complete |
| Plan approval UI (`PlanApprovalModal`) | ✅ Complete |
| Tool call approval UI (`ApprovalModal`) | ✅ Complete |
| Audit DB (5 tables + LLM call log) | ✅ Complete |
| `fs.readFile` | ✅ Implemented |
| `cmd.run` | ✅ Implemented |
| `fs.applyPatch` | 🔶 Placeholder |
| `net.fetch` | 🔶 Placeholder |
| `desktop.*` (screenshot, OCR, click) | 🔶 Placeholder |
| Config allowlists from `config.toml` | ⬜ Not wired |
| Playwright browser sidecar | 🔶 Scaffold only |
| Credential Vault | ⬜ Not started |
| Streaming LLM output | ⬜ Not started |
| Persistent audit DB (on-disk) | ⬜ In-memory only |

---

## Architecture

```
apps/desktop/          ← Tauri app (Rust + React)
  src-tauri/           ← Rust: LLM client, Planner, Executor, FSM, tools, audit
  src/                 ← React UI: Chat, Plan, Approval, Audit, EmergencyStop
services/
  playwright-sidecar/  ← Node.js WebSocket JSON-RPC browser automation server
docs/                  ← Architecture, permissions, tools, audit documentation
config.example.toml    ← Config template (copy → config.toml, never commit)
```

See [docs/architecture.md](docs/architecture.md) for the full system design.

---

## Prerequisites (Windows)

| Tool | Version | Install |
|------|---------|---------|
| Node.js | ≥ 20 | https://nodejs.org |
| Rust + Cargo | stable | https://rustup.rs |
| Tauri CLI | 2.x | `cargo install tauri-cli` |
| Visual Studio Build Tools | 2022 | https://aka.ms/vs/17/release/vs_BuildTools.exe |
| WebView2 Runtime | latest | Included in Windows 11; https://developer.microsoft.com/en-us/microsoft-edge/webview2/ |

---

## Local Dev Setup (Windows)

### 1. Clone & install dependencies

```powershell
git clone https://github.com/hmilyxtl2018/myExtBot.git
cd myExtBot
npm install          # installs all workspace dependencies
```

### 2. Configure

```powershell
copy config.example.toml config.toml
# Edit config.toml and set your LLM/OCR API keys
# Set environment variables:
$env:MYEXTBOT_LLM_API_KEY = "sk-..."
$env:MYEXTBOT_LLM_BASE_URL = "https://api.openai.com/v1"   # optional; default shown
$env:MYEXTBOT_LLM_MODEL    = "gpt-4o"                      # optional; default shown
```

> **No API key?** `send_message` degrades gracefully: the agent transitions to
> `Failed` and shows an error in the chat panel — no panic.

### 3. Start the Playwright sidecar

```powershell
npm run dev:sidecar
# Starts WebSocket JSON-RPC server on ws://127.0.0.1:9001
```

### 4. Start the Tauri desktop app (in a new terminal)

```powershell
npm run dev:desktop
# Builds Rust backend + Vite dev server, opens app window
```

---

## Project Structure

```
apps/
  desktop/
    src/                        # React UI
      components/
        ChatPanel.tsx
        PlanPanel.tsx
        ApprovalModal.tsx       # Tool-call approval modal
        PlanApprovalModal.tsx   # Plan approval modal (new)
        AuditTimeline.tsx
        AgentLogPanel.tsx
        EmergencyStop.tsx
      hooks/
        useEventStream.ts
      models/
        events.ts               # Shared TypeScript types
    src-tauri/
      src/
        main.rs
        lib.rs
        events.rs               # Typed event model (AgentEvent enum)
        agent.rs                # 9-state FSM + oneshot approval channels
        commands.rs             # Tauri IPC commands
        llm.rs                  # OpenAI-compatible LLM client (new)
        planner.rs              # Planner: prompt → AgentPlan (new)
        executor.rs             # Executor: plan → tool dispatch (new)
        permissions.rs          # Allowlist + session cache
        audit.rs                # SQLite audit logging (5 tables)
        tools/
          mod.rs                # Registry + JSON schema validation
          fs.rs
          cmd.rs
          net.rs
          desktop.rs
      Cargo.toml
      tauri.conf.json
services/
  playwright-sidecar/
    src/
      index.ts                  # WebSocket JSON-RPC server (scaffold)
    package.json
    tsconfig.json
docs/
  architecture.md
  permissions.md
  tools.md
  audit.md
PROGRESS.md                     # Detailed completion status
config.example.toml
```

---

## Docs

- [Architecture](docs/architecture.md)
- [Permissions](docs/permissions.md)
- [Tools](docs/tools.md)
- [Audit Logging](docs/audit.md)
- [Progress / Roadmap](PROGRESS.md)

---

## Security

- **No secrets in source**: use `config.toml` (gitignored) and environment variables.
- **API key zeroized**: `ApiKey` wrapper clears memory on drop (`zeroize` crate).
- **Tool allowlists**: tools are gated by allowlist before the approval dialog.
- **Structured commands**: `cmd.run` uses program+args, never shell expansion.
- **Audit trail**: every tool call and LLM call is logged with approval status.

---

## License

MIT – see [LICENSE](LICENSE).
