# myExtBot

A Windows-first "digital twin" desktop bot inspired by Cline. Built with:

- **Tauri 2** (Rust backend) + **React** (Vite frontend)
- **Node.js Playwright sidecar** for browser automation
- **SQLite** audit log (all events, tool calls, and artifacts)
- **Permissioned tool execution**: every tool call requires user approval

---

## Architecture

```
apps/desktop/          ← Tauri app (Rust + React)
  src-tauri/           ← Rust: event bus, agent state machine, tools, audit
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
$env:MYEXTBOT_OCR_API_KEY = "sk-..."
```

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
    src/                     # React UI
      components/
        ChatPanel.tsx
        PlanPanel.tsx
        ApprovalModal.tsx
        AuditTimeline.tsx
        EmergencyStop.tsx
      hooks/
        useEventStream.ts
      models/
        events.ts
    src-tauri/
      src/
        main.rs
        lib.rs
        events.rs            # Typed event model
        agent.rs             # State machine
        commands.rs          # Tauri IPC commands
        permissions.rs       # Allowlist + session cache
        audit.rs             # SQLite audit logging
        tools/
          mod.rs             # Registry + schema validation
          fs.rs
          cmd.rs
          net.rs
          desktop.rs
      Cargo.toml
      tauri.conf.json
services/
  playwright-sidecar/
    src/
      index.ts               # WebSocket JSON-RPC server
    package.json
    tsconfig.json
docs/
  architecture.md
  permissions.md
  tools.md
  audit.md
config.example.toml
```

---

## Docs

- [Architecture](docs/architecture.md)
- [Permissions](docs/permissions.md)
- [Tools](docs/tools.md)
- [Audit Logging](docs/audit.md)

---

## Security

- **No secrets in source**: use `config.toml` (gitignored) and environment variables.
- **Tool allowlists**: tools are gated by allowlist before the approval dialog.
- **Structured commands**: `cmd.run` uses program+args, never shell expansion.
- **Audit trail**: every tool call is logged with approval status.

---

## License

MIT – see [LICENSE](LICENSE).
