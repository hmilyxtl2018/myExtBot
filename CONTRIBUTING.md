# Contributing to myExtBot

Thank you for your interest in contributing! This guide explains how to set up your development environment and what checks are required before a pull request can be merged.

---

## Prerequisites

- **Node.js 18+** — [nodejs.org](https://nodejs.org/)
- **npm 9+** — bundled with Node 18
- **Rust (stable)** — [rustup.rs](https://rustup.rs/) — required only for Tauri desktop builds
- **Git**

---

## Setup

```bash
git clone https://github.com/hmilyxtl2018/myExtBot.git
cd myExtBot
npm ci
```

---

## Running Checks Locally

All of the checks below are run automatically in CI on every push to `main` and on every pull request targeting `main`. Run them locally before opening a PR to catch issues early.

### 1. Lint (ESLint)

```bash
npm run lint
```

Runs ESLint against all TypeScript source files in `src/`. The configuration is defined in `.eslintrc.json` and uses `@typescript-eslint/recommended` rules.

### 2. Type-check (TypeScript)

```bash
npx tsc --noEmit
```

Checks the entire project for TypeScript type errors without emitting any output files. Uses the settings in `tsconfig.json`.

### 3. Unit Tests (Jest)

```bash
npm test
```

Runs all unit tests located in `src/**/__tests__/**/*.test.ts` using Jest + `ts-jest`. Test configuration is in `jest.config.ts`.

### 4. Build (Vite + TypeScript)

```bash
npm run build
```

Compiles TypeScript and bundles the frontend via Vite. Artifacts are written to `dist/`.

### 5. Tauri Desktop Build (Windows only)

```bash
npm run tauri build
```

Builds the native Tauri desktop app. This step requires a Rust toolchain and is handled automatically by the `build-tauri` CI job on Windows runners. You only need to run this locally if you are changing Rust/Tauri code.

---

## CI Pipeline

The CI pipeline is defined in [`.github/workflows/ci.yml`](.github/workflows/ci.yml) and consists of two jobs:

### Job 1 — `ci` (Ubuntu)

Runs the following steps in order on every push to `main` and every PR targeting `main`:

| Step | Command | Purpose |
|------|---------|---------|
| Install dependencies | `npm ci` | Reproducible install from `package-lock.json` |
| Lint | `npm run lint` | ESLint with TypeScript rules |
| Type-check | `tsc --noEmit` | Full TypeScript type validation |
| Unit tests | `npm test` | Jest unit test suite |
| Build | `npm run build` | Vite production build |

### Job 2 — `build-tauri` (Windows)

Runs after the `ci` job succeeds. Installs Rust, builds the Tauri desktop app, and uploads the installer artifacts (`.msi` / `.exe`) via `actions/upload-artifact@v4`.

### Branch Protection

The repository is configured (or should be configured) to require the CI workflow to pass before any PR can be merged into `main`. To enable this:

1. Go to **Settings → Branches → Add branch protection rule**
2. Set the branch name pattern to `main`
3. Enable **"Require status checks to pass before merging"**
4. Search for and select the status checks: `lint`, `type-check`, `test`, `build`
5. Enable **"Require branches to be up to date before merging"**

---

## Code Style

- **TypeScript** — strict mode is enabled (`tsconfig.json`). All code must pass `tsc --noEmit`.
- **ESLint** — follow the `@typescript-eslint/recommended` rule set.
- **Formatting** — currently no automated formatter is enforced; follow the existing style in each file.

---

## Opening a Pull Request

1. Create a feature branch: `git checkout -b feat/my-feature`
2. Make your changes and commit with a descriptive message
3. Run all checks locally (`npm run lint && npx tsc --noEmit && npm test && npm run build`)
4. Push and open a PR against `main`
5. CI will run automatically; all checks must be green before the PR can be merged
