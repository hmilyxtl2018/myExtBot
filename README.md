# myExtBot

A **digital-twin desktop bot** built with [Tauri v2](https://tauri.app/) (Rust backend) + plain HTML/CSS/JS frontend.

Features:
- Chat interface with a personal AI agent
- Tool execution with human-in-the-loop approval (file I/O, shell, web, desktop OCR)
- Multi-agent team collaboration (delegate tasks, track status)
- Full audit log in SQLite (model calls, tool runs, permission decisions)
- Intelligence Watch — domain signal feed with bot analysis
- GitHub Pages live demo (mock backend, no install needed)

---

## 🌐 Live demo (no install)

The frontend demo is auto-deployed to GitHub Pages on every push to `main`:

```
https://<your-github-username>.github.io/myExtBot/
```

It uses a mock backend so you can click through all UI features without building anything.

---

## 🖥 Local installation (full desktop app)

### Prerequisites

| Tool | Minimum version | Install guide |
|------|----------------|---------------|
| [Rust](https://rustup.rs/) | 1.77 | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh` |
| [Node.js](https://nodejs.org/) | 18 LTS | <https://nodejs.org/en/download> |
| npm | 9 | bundled with Node.js |
| OS system libraries | — | see below |

#### Linux (Ubuntu / Debian)

```bash
sudo apt update && sudo apt install -y \
  libwebkit2gtk-4.1-dev \
  libgtk-3-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  patchelf
```

#### macOS

Xcode command-line tools are sufficient:

```bash
xcode-select --install
```

#### Windows

Install [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
and [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) (already included in
Windows 11 / recent Windows 10).

---

### 1  Clone the repository

```bash
git clone https://github.com/<your-github-username>/myExtBot.git
cd myExtBot
```

### 2  Configure environment variables

```bash
cp .env.example .env
```

Open `.env` and fill in at least one LLM provider:

```dotenv
LLM_PROVIDER=openai          # openai | anthropic | ollama
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o
```

> **Ollama (fully local, no API key):** set `LLM_PROVIDER=ollama` and ensure
> `ollama serve` is running with your chosen model pulled
> (`ollama pull llama3.2`).

### 3  Install Node.js dependencies

```bash
cd apps/desktop
npm install
```

This installs `@tauri-apps/cli` (the Tauri build tool).

### 4  Run in development mode

```bash
# From apps/desktop/
npm run dev
```

This command:
1. Starts a static file server for the frontend on port 1420 (`npm run serve`)
2. Launches the Tauri window pointing at that server
3. Enables hot-reload: edit any file in `src/` and reload the window

> **First run takes 5–10 minutes** while Cargo downloads and compiles ~200 Rust crates.
> Subsequent runs are a few seconds (incremental compile).

### 5  Build a distributable package

```bash
# From apps/desktop/
npm run build
```

Output installers/bundles are written to:

```
apps/desktop/src-tauri/target/release/bundle/
├── deb/          (Linux .deb)
├── rpm/          (Linux .rpm)
├── appimage/     (Linux .AppImage)
├── dmg/          (macOS .dmg)
└── msi/ / nsis/  (Windows installer)
```

---

## ⚙️ Project structure

```
myExtBot/
├── .env.example                  ← copy to .env; add your API keys
├── apps/
│   └── desktop/
│       ├── package.json          ← npm scripts + @tauri-apps/cli
│       ├── src/                  ← frontend: plain HTML + CSS + JS
│       │   ├── index.html
│       │   ├── app.js
│       │   └── style.css
│       └── src-tauri/            ← Rust/Tauri backend
│           ├── Cargo.toml
│           ├── tauri.conf.json
│           ├── capabilities/
│           │   └── default.json  ← Tauri v2 permission declarations
│           ├── icons/
│           │   └── icon.png
│           └── src/
│               ├── main.rs
│               ├── lib.rs
│               ├── agent.rs      ← agent state machine
│               ├── audit.rs      ← SQLite audit logging
│               ├── commands.rs   ← Tauri IPC commands
│               ├── db.rs         ← schema migrations
│               ├── events.rs     ← event types
│               ├── permissions.rs
│               ├── collab/       ← multi-agent collaboration layer
│               └── tools/        ← tool definitions (fs, cmd, net, desktop)
├── docs/                         ← GitHub Pages demo (auto-synced from src/)
└── README.md
```

---

## 🔧 Configuration reference

All configuration is via environment variables in `.env` (see `.env.example`):

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_PROVIDER` | `openai` | LLM provider: `openai`, `anthropic`, or `ollama` |
| `OPENAI_API_KEY` | — | Your OpenAI secret key |
| `OPENAI_MODEL` | `gpt-4o` | Model name |
| `ANTHROPIC_API_KEY` | — | Your Anthropic secret key |
| `ANTHROPIC_MODEL` | `claude-3-5-sonnet-20241022` | Model name |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama server URL |
| `OLLAMA_MODEL` | `llama3.2` | Locally-pulled Ollama model |
| `AGENT_ID` | auto-generated UUID | Stable identity for this bot instance |
| `AGENT_NAME` | `Alice-bot` | Display name |
| `AGENT_TEAM_ID` | `team-alpha` | Team the bot belongs to |
| `RUST_LOG` | `info` | Tracing level (`error`/`warn`/`info`/`debug`/`trace`) |

---

## 🧪 Running tests

Rust unit tests (no Tauri runtime required):

```bash
cd apps/desktop/src-tauri
cargo test
```

Tests cover: audit log CRUD, pagination, task lifecycle, collab message persistence, tool schema validation.

---

## 🚀 Deploying the GitHub Pages demo

The demo frontend is deployed automatically by `.github/workflows/pages.yml` on every push to `main`. To enable it:

1. Go to **Settings → Pages** in your GitHub repo
2. Set **Source** to `GitHub Actions`
3. Push to `main` — the workflow uploads `docs/` as the Pages artifact

The `docs/` directory is a mirror of `apps/desktop/src/` and is updated whenever you sync:

```bash
cp apps/desktop/src/app.js     docs/app.js
cp apps/desktop/src/style.css  docs/style.css
cp apps/desktop/src/index.html docs/index.html
```

---

## 🛠 Troubleshooting

| Problem | Solution |
|---------|----------|
| `error: linker 'cc' not found` | Install build-essentials: `sudo apt install build-essential` |
| `webkit2gtk not found` | Install the Linux system deps listed above |
| `cargo: command not found` | Run `source $HOME/.cargo/env` or open a new terminal after rustup install |
| Window opens but shows blank page | Make sure `npm run serve` is running on port 1420 before the window appears |
| `window.__TAURI__ is undefined` | Ensure `"withGlobalTauri": true` is set in `tauri.conf.json` (already done) |
| LLM responses are mock data | You are running the browser demo; in Tauri mode, set a real API key in `.env` |

---

## 📄 License

MIT
