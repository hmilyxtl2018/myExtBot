/**
 * Management HTTP server for the MCP Services List Manager.
 *
 * Exposes:
 *   GET  /            — single-page management UI
 *   GET  /api/services                    — list all registered services
 *   POST /api/services/:name/enable       — enable a service
 *   POST /api/services/:name/disable      — disable a service
 *   GET  /api/tools                       — get all tool definitions (enabled services only)
 *   POST /api/dispatch                    — dispatch a tool call  { toolName, arguments }
 *
 *   GET  /api/scenes                      — list all scenes
 *   POST /api/scenes                      — create a scene  { id, name, description?, serviceNames }
 *   DELETE /api/scenes/:id                — remove a scene
 *
 *   GET  /api/agents                      — list all agent profiles
 *   POST /api/agents                      — create an agent  { id, name, description?, sceneId?, allowedServices? }
 *   DELETE /api/agents/:id                — remove an agent
 *   POST /api/dispatch-as/:agentId        — dispatch a tool call as a specific agent
 *
 *   GET  /api/plugins                     — list all plugins in the registry (with install status)
 *   GET  /api/plugins/installed           — list installed plugins only
 *   POST /api/plugins/install             — install a plugin  { pluginId }
 *   DELETE /api/plugins/:pluginId         — uninstall a plugin
 *
 * Run:  npm run server
 */

import express, { Request, Response } from "express";
import { McpServiceListManager } from "./core/McpServiceListManager";
import { PluginManager } from "./core/PluginManager";
import { SearchService } from "./services/SearchService";
import { CalendarService } from "./services/CalendarService";
import { CodeRunnerService } from "./services/CodeRunnerService";
import { AgentProfile, Scene, ToolCall } from "./core/types";

// ── Bootstrap ────────────────────────────────────────────────────────────────

const manager = new McpServiceListManager();
manager.register(new SearchService());
manager.register(new CalendarService());
manager.register(new CodeRunnerService());

// Seed default scenes
manager.registerScene({
  id: "research",
  name: "Research",
  description: "Web research and information gathering tasks.",
  serviceNames: ["SearchService"],
});
manager.registerScene({
  id: "productivity",
  name: "Productivity",
  description: "Calendar and scheduling tasks.",
  serviceNames: ["CalendarService"],
});
manager.registerScene({
  id: "dev",
  name: "Development",
  description: "Coding, scripting, and automation tasks.",
  serviceNames: ["CodeRunnerService"],
});
manager.registerScene({
  id: "full",
  name: "Full Access",
  description: "All services — for power users.",
  serviceNames: ["SearchService", "CalendarService", "CodeRunnerService"],
});

// Seed default agents
manager.registerAgent({
  id: "research-bot",
  name: "Research Bot",
  description: "Specialized in web search and information retrieval.",
  sceneId: "research",
});
manager.registerAgent({
  id: "scheduling-assistant",
  name: "Scheduling Assistant",
  description: "Manages calendar events and scheduling.",
  sceneId: "productivity",
});
manager.registerAgent({
  id: "dev-bot",
  name: "Dev Bot",
  description: "Runs code snippets and searches for documentation.",
  allowedServices: ["CodeRunnerService", "SearchService"],
});
manager.registerAgent({
  id: "full-agent",
  name: "Full Agent",
  description: "Unrestricted access to all registered services.",
  sceneId: "full",
});

const app = express();
app.use(express.json());

// Initialise PluginManager after manager is set up
const pluginManager = new PluginManager(manager);

// ── REST API ─────────────────────────────────────────────────────────────────

app.get("/api/services", (_req: Request, res: Response) => {
  res.json(manager.listServices());
});

app.post("/api/services/:name/enable", (req: Request, res: Response) => {
  try {
    manager.enableService(String(req.params.name));
    res.json({ ok: true });
  } catch (e) {
    res.status(404).json({ ok: false, error: (e as Error).message });
  }
});

app.post("/api/services/:name/disable", (req: Request, res: Response) => {
  try {
    manager.disableService(String(req.params.name));
    res.json({ ok: true });
  } catch (e) {
    res.status(404).json({ ok: false, error: (e as Error).message });
  }
});

app.get("/api/tools", (_req: Request, res: Response) => {
  res.json(manager.getToolDefinitions());
});

app.post("/api/dispatch", async (req: Request, res: Response) => {
  const { toolName, arguments: args } = req.body as {
    toolName?: string;
    arguments?: Record<string, unknown>;
  };
  if (!toolName) {
    res.status(400).json({ ok: false, error: "toolName is required" });
    return;
  }
  try {
    const call: ToolCall = { toolName, arguments: args ?? {} };
    const result = await manager.dispatch(call);
    res.json({ ok: true, result });
  } catch (e) {
    res.status(400).json({ ok: false, error: (e as Error).message });
  }
});

// ── Scenes API ───────────────────────────────────────────────────────────────

app.get("/api/scenes", (_req: Request, res: Response) => {
  res.json(manager.listScenes());
});

app.post("/api/scenes", (req: Request, res: Response) => {
  const { id, name, description, serviceNames } = req.body as Partial<Scene>;
  if (!id || !name || !Array.isArray(serviceNames)) {
    res.status(400).json({ ok: false, error: "id, name and serviceNames are required" });
    return;
  }
  try {
    manager.registerScene({ id, name, description, serviceNames });
    res.json({ ok: true, scene: manager.listScenes().find((s) => s.id === id) });
  } catch (e) {
    res.status(400).json({ ok: false, error: (e as Error).message });
  }
});

app.delete("/api/scenes/:id", (req: Request, res: Response) => {
  manager.removeScene(String(req.params.id));
  res.json({ ok: true });
});

// ── Agents API ───────────────────────────────────────────────────────────────

app.get("/api/agents/:id/tools", (req: Request, res: Response) => {
  try {
    res.json(manager.getToolDefinitionsForAgent(String(req.params.id)));
  } catch (e) {
    res.status(404).json({ ok: false, error: (e as Error).message });
  }
});

app.get("/api/agents", (_req: Request, res: Response) => {
  res.json(manager.listAgents());
});

app.post("/api/agents", (req: Request, res: Response) => {
  const { id, name, description, sceneId, allowedServices } =
    req.body as Partial<AgentProfile>;
  if (!id || !name) {
    res.status(400).json({ ok: false, error: "id and name are required" });
    return;
  }
  try {
    manager.registerAgent({ id, name, description, sceneId, allowedServices });
    res.json({ ok: true, agent: manager.listAgents().find((a) => a.id === id) });
  } catch (e) {
    res.status(400).json({ ok: false, error: (e as Error).message });
  }
});

app.delete("/api/agents/:id", (req: Request, res: Response) => {
  manager.removeAgent(String(req.params.id));
  res.json({ ok: true });
});

app.post("/api/dispatch-as/:agentId", async (req: Request, res: Response) => {
  const agentId = String(req.params.agentId);
  const { toolName, arguments: args } = req.body as {
    toolName?: string;
    arguments?: Record<string, unknown>;
  };
  if (!toolName) {
    res.status(400).json({ ok: false, error: "toolName is required" });
    return;
  }
  try {
    const call: ToolCall = { toolName, arguments: args ?? {} };
    const result = await manager.dispatchAs(agentId, call);
    res.json({ ok: true, agentId, result });
  } catch (e) {
    res.status(400).json({ ok: false, error: (e as Error).message });
  }
});

// ── Plugins API ───────────────────────────────────────────────────────────────

app.get("/api/plugins", (_req: Request, res: Response) => {
  res.json(pluginManager.listAll());
});

app.get("/api/plugins/installed", (_req: Request, res: Response) => {
  res.json(pluginManager.listInstalled());
});

app.post("/api/plugins/install", (req: Request, res: Response) => {
  const { pluginId } = req.body as { pluginId?: string };
  if (!pluginId) {
    res.status(400).json({ ok: false, error: "pluginId is required" });
    return;
  }
  try {
    const summary = pluginManager.install(pluginId);
    res.json({ ok: true, plugin: summary });
  } catch (e) {
    res.status(400).json({ ok: false, error: (e as Error).message });
  }
});

app.delete("/api/plugins/:pluginId", (req: Request, res: Response) => {
  try {
    pluginManager.uninstall(String(req.params.pluginId));
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: (e as Error).message });
  }
});

// ── Management UI ─────────────────────────────────────────────────────────────

app.get("/", (_req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(HTML);
});

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
app.listen(PORT, () => {
  console.log(`MCP Services Manager UI → http://localhost:${PORT}`);
});

// ── Embedded Management Page ──────────────────────────────────────────────────

const HTML = /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>MCP Services Manager</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg: #f5f7fa;
      --surface: #ffffff;
      --card: #ffffff;
      --border: #e2e6ef;
      --accent: #4f46e5;
      --accent-hover: #4338ca;
      --green: #16a34a;
      --red: #dc2626;
      --orange: #d97706;
      --text: #111827;
      --text-dim: #6b7280;
      --tag-bg: #f1f5f9;
      --radius: 10px;
      --shadow: 0 4px 24px rgba(0,0,0,0.08);
    }

    body {
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
    }

    /* ── Layout ── */
    header {
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      padding: 18px 32px;
      display: flex;
      align-items: center;
      gap: 14px;
      position: sticky;
      top: 0;
      z-index: 100;
    }
    header .logo {
      width: 36px; height: 36px;
      background: var(--accent);
      border-radius: 8px;
      display: flex; align-items: center; justify-content: center;
      font-size: 18px;
    }
    header h1 { font-size: 1.1rem; font-weight: 600; letter-spacing: 0.02em; }
    header .subtitle { font-size: 0.75rem; color: var(--text-dim); margin-top: 2px; }

    .status-dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: var(--green);
      margin-left: auto;
      box-shadow: 0 0 6px var(--green);
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; } 50% { opacity: 0.5; }
    }

    main { max-width: 1100px; margin: 0 auto; padding: 32px 20px; }

    /* ── Section titles ── */
    .section-title {
      font-size: 0.7rem;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--text-dim);
      margin-bottom: 14px;
    }

    /* ── Services grid ── */
    .services-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 16px;
      margin-bottom: 36px;
    }

    .service-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      overflow: hidden;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .service-card:hover { border-color: var(--accent); box-shadow: var(--shadow); }
    .service-card.disabled { opacity: 0.65; }

    .card-header {
      padding: 16px 18px;
      display: flex;
      align-items: flex-start;
      gap: 12px;
    }
    .card-icon {
      width: 38px; height: 38px; flex-shrink: 0;
      background: var(--tag-bg);
      border-radius: 8px;
      display: flex; align-items: center; justify-content: center;
      font-size: 18px;
    }
    .card-info { flex: 1; min-width: 0; }
    .card-name { font-weight: 600; font-size: 0.95rem; }
    .card-meta { font-size: 0.75rem; color: var(--text-dim); margin-top: 3px; }

    .badge {
      display: inline-flex; align-items: center; gap: 5px;
      font-size: 0.68rem; font-weight: 700; letter-spacing: 0.05em;
      padding: 3px 9px; border-radius: 100px;
      text-transform: uppercase;
      flex-shrink: 0;
    }
    .badge.enabled  { background: rgba(22,163,74,0.12);  color: var(--green); }
    .badge.disabled { background: rgba(220,38,38,0.12);  color: var(--red); }
    .badge::before { content: ''; width: 5px; height: 5px; border-radius: 50%; background: currentColor; }

    .card-footer {
      border-top: 1px solid var(--border);
      padding: 10px 18px;
      display: flex; align-items: center; gap: 8px;
    }

    .btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 6px;
      border: none; cursor: pointer;
      border-radius: 6px; font-size: 0.78rem; font-weight: 600;
      padding: 7px 14px; transition: all 0.15s;
      font-family: inherit; letter-spacing: 0.02em;
    }
    .btn:active { transform: scale(0.97); }

    .btn-primary  { background: var(--accent); color: #fff; }
    .btn-primary:hover { background: var(--accent-hover); }
    .btn-success  { background: rgba(22,163,74,0.10); color: var(--green); border: 1px solid rgba(22,163,74,0.3); }
    .btn-success:hover { background: rgba(22,163,74,0.2); }
    .btn-danger   { background: rgba(220,38,38,0.10); color: var(--red); border: 1px solid rgba(220,38,38,0.3); }
    .btn-danger:hover { background: rgba(220,38,38,0.2); }
    .btn-ghost    { background: transparent; color: var(--text-dim); border: 1px solid var(--border); }
    .btn-ghost:hover { background: var(--surface); color: var(--text); }
    .btn-sm { padding: 5px 10px; font-size: 0.73rem; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }

    /* ── Tools panel ── */
    .tools-panel {
      display: none;
      background: var(--bg);
      border-top: 1px solid var(--border);
      padding: 14px 18px;
    }
    .tools-panel.open { display: block; }
    .tool-item {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px 14px;
      margin-bottom: 8px;
      font-size: 0.8rem;
    }
    .tool-item:last-child { margin-bottom: 0; }
    .tool-name {
      font-family: 'Courier New', monospace;
      font-weight: 700;
      font-size: 0.82rem;
      color: var(--accent);
      margin-bottom: 4px;
    }
    .tool-desc { color: var(--text-dim); margin-bottom: 8px; line-height: 1.4; }
    .tool-params { display: flex; flex-wrap: wrap; gap: 5px; }
    .param-tag {
      background: var(--tag-bg);
      border-radius: 5px;
      padding: 2px 8px;
      font-family: 'Courier New', monospace;
      font-size: 0.72rem;
      color: #0369a1;
    }
    .param-tag.required { color: #b45309; }

    /* ── Dispatch section ── */
    .dispatch-section {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 22px 24px;
      margin-bottom: 36px;
    }

    .form-row {
      display: grid;
      grid-template-columns: 1fr 2fr auto;
      gap: 10px;
      align-items: flex-end;
      margin-bottom: 12px;
    }

    label { display: block; font-size: 0.75rem; color: var(--text-dim); margin-bottom: 5px; font-weight: 600; letter-spacing: 0.04em; }

    select, input, textarea {
      width: 100%; background: var(--bg); border: 1px solid var(--border);
      border-radius: 6px; color: var(--text); font-family: inherit; font-size: 0.83rem;
      padding: 8px 12px; outline: none; transition: border-color 0.15s;
    }
    select:focus, input:focus, textarea:focus { border-color: var(--accent); }
    textarea { resize: vertical; min-height: 80px; font-family: 'Courier New', monospace; font-size: 0.78rem; }
    option { background: var(--surface); }

    .dispatch-result {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 14px;
      font-family: 'Courier New', monospace;
      font-size: 0.78rem;
      white-space: pre-wrap;
      word-break: break-all;
      display: none;
      max-height: 300px;
      overflow-y: auto;
      line-height: 1.5;
    }
    .dispatch-result.show { display: block; }
    .dispatch-result.success { border-color: rgba(22,163,74,0.4);  color: #15803d; }
    .dispatch-result.error   { border-color: rgba(220,38,38,0.4);  color: #b91c1c; }

    /* ── Stats bar ── */
    .stats-bar {
      display: flex; gap: 16px; flex-wrap: wrap;
      margin-bottom: 28px;
    }
    .stat-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 14px 20px;
      flex: 1; min-width: 120px;
    }
    .stat-value { font-size: 2rem; font-weight: 700; line-height: 1; }
    .stat-label { font-size: 0.72rem; color: var(--text-dim); margin-top: 5px; text-transform: uppercase; letter-spacing: 0.08em; }
    .stat-value.green { color: var(--green); }
    .stat-value.red   { color: var(--red); }
    .stat-value.purple{ color: var(--accent); }

    /* ── Misc ── */
    .toast {
      position: fixed; bottom: 24px; right: 24px;
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 8px; padding: 12px 18px;
      font-size: 0.83rem; box-shadow: var(--shadow);
      animation: slide-up 0.25s ease;
      z-index: 999;
      display: none;
    }
    .toast.show { display: block; }
    .toast.ok  { border-left: 3px solid var(--green); }
    .toast.err { border-left: 3px solid var(--red); }
    @keyframes slide-up {
      from { transform: translateY(20px); opacity: 0; }
      to   { transform: translateY(0);    opacity: 1; }
    }

    .spinner {
      display: inline-block; width: 14px; height: 14px;
      border: 2px solid rgba(0,0,0,0.15);
      border-top-color: currentColor;
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    .flex-gap { display: flex; gap: 8px; align-items: center; }
    .ml-auto { margin-left: auto; }
    .mb-8 { margin-bottom: 8px; }

    /* ── Tabs ── */
    .tab-bar {
      display: flex; gap: 4px;
      border-bottom: 2px solid var(--border);
      margin-bottom: 28px;
    }
    .tab-btn {
      border: none; background: none; cursor: pointer;
      font-family: inherit; font-size: 0.83rem; font-weight: 600;
      padding: 10px 18px; border-radius: 8px 8px 0 0;
      color: var(--text-dim); transition: color 0.15s, background 0.15s;
      border-bottom: 2px solid transparent; margin-bottom: -2px;
    }
    .tab-btn:hover { color: var(--text); background: var(--bg); }
    .tab-btn.active { color: var(--accent); border-bottom-color: var(--accent); background: var(--bg); }
    .tab-pane { display: none; }
    .tab-pane.active { display: block; }

    /* ── Scene / Agent cards ── */
    .group-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 14px;
      margin-bottom: 28px;
    }
    .group-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 16px 18px;
      display: flex; flex-direction: column; gap: 8px;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .group-card:hover { border-color: var(--accent); box-shadow: var(--shadow); }
    .group-card-title { font-weight: 700; font-size: 0.95rem; display: flex; align-items: center; gap: 8px; }
    .group-card-desc  { font-size: 0.78rem; color: var(--text-dim); line-height: 1.45; }
    .group-card-meta  { font-size: 0.72rem; color: var(--text-dim); }
    .group-card-services { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 2px; }
    .svc-chip {
      font-size: 0.7rem; font-weight: 600; padding: 2px 8px;
      border-radius: 100px; background: var(--tag-bg);
      color: var(--accent); border: 1px solid rgba(79,70,229,0.2);
    }
    .group-card-footer { border-top: 1px solid var(--border); padding-top: 10px; margin-top: 4px; display: flex; gap: 8px; align-items: center; }

    /* ── Plugin cards ── */
    .plugin-card { position: relative; }
    .plugin-card.installed { border-color: rgba(22,163,74,0.45); }
    .plugin-badge-installed {
      font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em;
      padding: 2px 7px; border-radius: 100px;
      background: rgba(22,163,74,0.15); color: var(--green); border: 1px solid rgba(22,163,74,0.3);
    }
    .plugin-category {
      font-size: 0.68rem; padding: 2px 7px; border-radius: 100px;
      background: var(--tag-bg); color: var(--accent); border: 1px solid rgba(79,70,229,0.2);
    }
    .plugin-meta { font-size: 0.72rem; color: var(--text-dim); display: flex; gap: 10px; flex-wrap: wrap; margin-top: 2px; }
    .plugin-tools-list { margin-top: 6px; display: flex; flex-wrap: wrap; gap: 4px; }
    .plugin-tool-chip {
      font-size: 0.68rem; padding: 2px 6px; border-radius: 4px;
      background: var(--bg); border: 1px solid var(--border); color: var(--text-dim);
      font-family: 'Courier New', monospace;
    }

    /* ── Create form (collapsible) ── */
    .create-form {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 18px 20px;
      margin-bottom: 24px;
      display: none;
    }
    .create-form.open { display: block; }
    .form-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px; }
    .form-grid-1 { display: grid; grid-template-columns: 1fr; gap: 10px; margin-bottom: 12px; }

    @media (max-width: 600px) {
      .form-row { grid-template-columns: 1fr; }
      .stats-bar { gap: 10px; }
      .form-grid-2 { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>

<header>
  <div class="logo">🤖</div>
  <div>
    <h1>MCP Services Manager</h1>
    <div class="subtitle">Manage and monitor LLM tool services — with Scenes, Agents &amp; Plugin Marketplace</div>
  </div>
  <div class="status-dot" title="Server running"></div>
</header>

<main>
  <!-- Stats -->
  <div class="stats-bar" id="stats">
    <div class="stat-card"><div class="stat-value purple" id="stat-total">—</div><div class="stat-label">Total Services</div></div>
    <div class="stat-card"><div class="stat-value green"  id="stat-enabled">—</div><div class="stat-label">Enabled</div></div>
    <div class="stat-card"><div class="stat-value red"    id="stat-disabled">—</div><div class="stat-label">Disabled</div></div>
    <div class="stat-card"><div class="stat-value purple" id="stat-tools">—</div><div class="stat-label">Active Tools</div></div>
    <div class="stat-card"><div class="stat-value purple" id="stat-scenes">—</div><div class="stat-label">Scenes</div></div>
    <div class="stat-card"><div class="stat-value purple" id="stat-agents">—</div><div class="stat-label">Agents</div></div>
    <div class="stat-card"><div class="stat-value green"  id="stat-plugins-installed">—</div><div class="stat-label">Plugins Installed</div></div>
    <div class="stat-card"><div class="stat-value purple" id="stat-plugins-total">—</div><div class="stat-label">In Marketplace</div></div>
  </div>

  <!-- Tab bar -->
  <nav class="tab-bar">
    <button class="tab-btn active" data-tab="services" onclick="switchTab('services', this)">⚙️ Services</button>
    <button class="tab-btn"        data-tab="scenes"   onclick="switchTab('scenes',   this)">🗂 Scenes</button>
    <button class="tab-btn"        data-tab="agents"   onclick="switchTab('agents',   this)">🤖 Agents</button>
    <button class="tab-btn"        data-tab="plugins"  onclick="switchTab('plugins',  this)">🔌 Plugins</button>
    <button class="tab-btn"        data-tab="dispatch" onclick="switchTab('dispatch', this)">▶ Tool Call</button>
  </nav>

  <!-- ── TAB: Services ── -->
  <div class="tab-pane active" id="tab-services">
    <div class="flex-gap mb-8">
      <div class="section-title" style="margin:0">Registered Services</div>
      <button class="btn btn-ghost btn-sm ml-auto" onclick="loadAll()">↻ Refresh</button>
    </div>
    <div class="services-grid" id="services-grid">
      <div style="color:var(--text-dim); font-size:0.85rem; grid-column:1/-1;">Loading services…</div>
    </div>
  </div>

  <!-- ── TAB: Scenes ── -->
  <div class="tab-pane" id="tab-scenes">
    <div class="flex-gap mb-8">
      <div class="section-title" style="margin:0">Scenes</div>
      <button class="btn btn-primary btn-sm ml-auto" onclick="toggleCreateForm('scene')">＋ New Scene</button>
    </div>

    <!-- Create scene form -->
    <div class="create-form" id="create-scene-form">
      <div class="form-grid-2">
        <div><label>Scene ID (slug)</label><input id="new-scene-id" type="text" placeholder="research" /></div>
        <div><label>Display Name</label><input id="new-scene-name" type="text" placeholder="Research" /></div>
      </div>
      <div class="form-grid-1">
        <div><label>Description</label><input id="new-scene-desc" type="text" placeholder="Optional description" /></div>
        <div><label>Service names (comma-separated)</label><input id="new-scene-svcs" type="text" placeholder="SearchService, CalendarService" /></div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-primary btn-sm" onclick="createScene()">Create Scene</button>
        <button class="btn btn-ghost btn-sm"  onclick="toggleCreateForm('scene')">Cancel</button>
      </div>
    </div>

    <div class="group-grid" id="scenes-grid">
      <div style="color:var(--text-dim)">Loading scenes…</div>
    </div>
  </div>

  <!-- ── TAB: Agents ── -->
  <div class="tab-pane" id="tab-agents">
    <div class="flex-gap mb-8">
      <div class="section-title" style="margin:0">Agent Profiles</div>
      <button class="btn btn-primary btn-sm ml-auto" onclick="toggleCreateForm('agent')">＋ New Agent</button>
    </div>

    <!-- Create agent form -->
    <div class="create-form" id="create-agent-form">
      <div class="form-grid-2">
        <div><label>Agent ID (slug)</label><input id="new-agent-id" type="text" placeholder="my-bot" /></div>
        <div><label>Display Name</label><input id="new-agent-name" type="text" placeholder="My Bot" /></div>
      </div>
      <div class="form-grid-2">
        <div><label>Scene ID (optional)</label><input id="new-agent-scene" type="text" placeholder="research" /></div>
        <div><label>Allowed services (comma-separated, overrides scene)</label><input id="new-agent-svcs" type="text" placeholder="SearchService" /></div>
      </div>
      <div class="form-grid-1">
        <div><label>Description</label><input id="new-agent-desc" type="text" placeholder="Optional description" /></div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-primary btn-sm" onclick="createAgent()">Create Agent</button>
        <button class="btn btn-ghost btn-sm"  onclick="toggleCreateForm('agent')">Cancel</button>
      </div>
    </div>

    <div class="group-grid" id="agents-grid">
      <div style="color:var(--text-dim)">Loading agents…</div>
    </div>
  </div>

  <!-- ── TAB: Plugins ── -->
  <div class="tab-pane" id="tab-plugins">
    <div class="flex-gap mb-8">
      <div class="section-title" style="margin:0">🔌 Plugin Marketplace</div>
      <div style="margin-left:auto;display:flex;gap:8px;align-items:center">
        <select id="plugin-filter" onchange="renderPluginGrid()" style="font-size:0.78rem;padding:4px 8px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text)">
          <option value="all">All plugins</option>
          <option value="available">Available</option>
          <option value="installed">Installed</option>
        </select>
        <select id="plugin-category-filter" onchange="renderPluginGrid()" style="font-size:0.78rem;padding:4px 8px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text)">
          <option value="">All categories</option>
        </select>
        <button class="btn btn-ghost btn-sm" onclick="loadAll()">↻ Refresh</button>
      </div>
    </div>
    <div class="group-grid" id="plugins-grid" style="grid-template-columns:repeat(auto-fill,minmax(300px,1fr))">
      <div style="color:var(--text-dim)">Loading plugins…</div>
    </div>
  </div>

  <!-- ── TAB: Dispatch ── -->
  <div class="tab-pane" id="tab-dispatch">
    <div class="section-title">Try a Tool Call</div>
    <div class="dispatch-section">
      <div class="form-row" style="grid-template-columns:1fr 1fr auto;margin-bottom:10px">
        <div>
          <label for="dispatch-agent">Act as Agent (optional)</label>
          <select id="dispatch-agent">
            <option value="">— all tools (no agent) —</option>
          </select>
        </div>
        <div>
          <label for="tool-select">Tool</label>
          <select id="tool-select" onchange="onToolSelect()">
            <option value="">— select a tool —</option>
          </select>
        </div>
        <div>
          <label>&nbsp;</label>
          <button class="btn btn-ghost btn-sm" onclick="refreshToolSelect()">↻</button>
        </div>
      </div>
      <div class="form-row">
        <div style="grid-column:1/-1">
          <label for="tool-args">Arguments (JSON)</label>
          <input id="tool-args" type="text" placeholder='{"query": "hello world"}' />
        </div>
        <div>
          <label>&nbsp;</label>
          <button class="btn btn-primary" onclick="dispatchTool()" id="dispatch-btn">▶ Run</button>
        </div>
      </div>
      <div id="dispatch-result" class="dispatch-result"></div>
    </div>
  </div>
</main>

<div class="toast" id="toast"></div>

<script>
  // ── Service icons ─────────────────────────────────────────────────────────
  const ICONS = {
    SearchService:      '🔍',
    CalendarService:    '📅',
    CodeRunnerService:  '⚡',
  };
  function icon(name) { return ICONS[name] || '🧩'; }

  // ── Tab navigation ────────────────────────────────────────────────────────
  function switchTab(id, btn) {
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('tab-' + id).classList.add('active');
    btn.classList.add('active');
  }

  // ── Toast helper ──────────────────────────────────────────────────────────
  let toastTimer;
  function toast(msg, ok = true) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast show ' + (ok ? 'ok' : 'err');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = 'toast'; }, 2800);
  }

  // ── Load everything ───────────────────────────────────────────────────────
  let allServices = [], allScenes = [], allAgents = [], allPlugins = [];

  async function loadAll() {
    try {
      const [svcs, tools, scenes, agents, plugins] = await Promise.all([
        fetch('/api/services').then(r => r.json()),
        fetch('/api/tools').then(r => r.json()),
        fetch('/api/scenes').then(r => r.json()),
        fetch('/api/agents').then(r => r.json()),
        fetch('/api/plugins').then(r => r.json()),
      ]);
      allServices = svcs;
      allScenes   = scenes;
      allAgents   = agents;
      allPlugins  = plugins;
      renderStats(svcs, tools, scenes, agents, plugins);
      renderServices(svcs);
      renderScenes(scenes);
      renderAgents(agents);
      renderPluginGrid();
      populateCategoryFilter(plugins);
      populateToolSelect(tools);
      populateAgentSelect(agents);
    } catch (e) {
      toast('Failed to load data: ' + e.message, false);
    }
  }

  function renderStats(svcs, tools, scenes, agents, plugins) {
    const enabled = svcs.filter(s => s.enabled).length;
    document.getElementById('stat-total').textContent    = svcs.length;
    document.getElementById('stat-enabled').textContent  = enabled;
    document.getElementById('stat-disabled').textContent = svcs.length - enabled;
    document.getElementById('stat-tools').textContent    = tools.length;
    document.getElementById('stat-scenes').textContent   = scenes.length;
    document.getElementById('stat-agents').textContent   = agents.length;
    document.getElementById('stat-plugins-installed').textContent = plugins.filter(p => p.status === 'installed').length;
    document.getElementById('stat-plugins-total').textContent = plugins.length;
  }

  // ── Services tab ──────────────────────────────────────────────────────────
  function renderServices(svcs) {
    const grid = document.getElementById('services-grid');
    if (!svcs.length) {
      grid.innerHTML = '<div style="color:var(--text-dim)">No services registered.</div>';
      return;
    }
    grid.innerHTML = svcs.map(s => cardHTML(s)).join('');
  }

  function cardHTML(s) {
    const badgeClass = s.enabled ? 'enabled' : 'disabled';
    const badgeText  = s.enabled ? 'Enabled'  : 'Disabled';
    const toggleBtn  = s.enabled
      ? '<button class="btn btn-danger btn-sm" onclick="toggleService(\\''+s.name+'\\', false)">⏸ Disable</button>'
      : '<button class="btn btn-success btn-sm" onclick="toggleService(\\''+s.name+'\\', true)">▶ Enable</button>';
    const toolWord = s.toolCount === 1 ? 'tool' : 'tools';
    return \`
      <div class="service-card \${s.enabled ? '' : 'disabled'}" id="card-\${s.name}">
        <div class="card-header">
          <div class="card-icon">\${icon(s.name)}</div>
          <div class="card-info">
            <div class="card-name">\${s.name}</div>
            <div class="card-meta">\${s.toolCount} \${toolWord}</div>
          </div>
          <span class="badge \${badgeClass}">\${badgeText}</span>
        </div>
        <div class="card-footer">
          \${toggleBtn}
          <button class="btn btn-ghost btn-sm ml-auto" onclick="toggleTools('\${s.name}')">🔧 Tools</button>
        </div>
        <div class="tools-panel" id="tools-\${s.name}">Loading…</div>
      </div>
    \`;
  }

  async function toggleTools(name) {
    const panel = document.getElementById('tools-' + name);
    if (panel.classList.contains('open')) { panel.classList.remove('open'); return; }
    panel.classList.add('open');
    if (panel.dataset.loaded) return;
    try {
      const svc = allServices.find(s => s.name === name);
      if (!svc || !svc.enabled) {
        panel.innerHTML = '<div style="color:var(--text-dim);font-size:0.78rem;padding:4px 0">Enable this service to inspect its tools.</div>';
        panel.dataset.loaded = '1'; return;
      }
      const tools = await fetch('/api/tools').then(r => r.json());
      panel.innerHTML = tools.length ? tools.map(t => toolItemHTML(t)).join('') : '<div style="color:var(--text-dim);font-size:0.78rem">No active tools.</div>';
      panel.dataset.loaded = '1';
    } catch (e) {
      panel.innerHTML = '<div style="color:var(--red);font-size:0.8rem">Error: ' + e.message + '</div>';
    }
  }

  function toolItemHTML(t) {
    return \`<div class="tool-item">
      <div class="tool-name">\${t.name}</div>
      <div class="tool-desc">\${t.description}</div>
      <div class="tool-params">
        \${Object.entries(t.parameters.properties || {}).map(([k, v]) => {
          const req = (t.parameters.required || []).includes(k);
          return '<span class="param-tag' + (req ? ' required' : '') + '">' + k + ': ' + v.type + (req ? ' *' : '') + '</span>';
        }).join('')}
      </div>
    </div>\`;
  }

  async function toggleService(name, enable) {
    const action = enable ? 'enable' : 'disable';
    const card = document.getElementById('card-' + name);
    card.querySelectorAll('.btn').forEach(b => b.disabled = true);
    try {
      const res = await fetch('/api/services/' + name + '/' + action, { method: 'POST' });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      toast(name + (enable ? ' enabled ✓' : ' disabled'), enable);
      await loadAll();
    } catch (e) {
      toast('Error: ' + e.message, false);
      card.querySelectorAll('.btn').forEach(b => b.disabled = false);
    }
  }

  // ── Scenes tab ────────────────────────────────────────────────────────────
  function renderScenes(scenes) {
    const grid = document.getElementById('scenes-grid');
    if (!scenes.length) {
      grid.innerHTML = '<div style="color:var(--text-dim)">No scenes registered.</div>';
      return;
    }
    grid.innerHTML = scenes.map(sc => sceneCardHTML(sc)).join('');
  }

  function sceneCardHTML(sc) {
    const chips = sc.serviceNames.map(n =>
      '<span class="svc-chip">' + icon(n) + ' ' + n + '</span>'
    ).join('');
    const toolWord = sc.toolCount === 1 ? 'tool' : 'tools';
    return \`<div class="group-card">
      <div class="group-card-title">🗂 \${sc.name} <span style="font-size:0.7rem;color:var(--text-dim);font-weight:400">#\${sc.id}</span></div>
      \${sc.description ? '<div class="group-card-desc">' + sc.description + '</div>' : ''}
      <div class="group-card-services">\${chips}</div>
      <div class="group-card-footer">
        <span class="group-card-meta">\${sc.toolCount} \${toolWord}</span>
        <button class="btn btn-danger btn-sm ml-auto" onclick="deleteScene('\${sc.id}')">🗑 Remove</button>
      </div>
    </div>\`;
  }

  async function deleteScene(id) {
    if (!confirm('Remove scene "' + id + '"?')) return;
    const res = await fetch('/api/scenes/' + id, { method: 'DELETE' });
    const data = await res.json();
    if (data.ok) { toast('Scene removed'); await loadAll(); }
    else toast('Error: ' + data.error, false);
  }

  async function createScene() {
    const id   = document.getElementById('new-scene-id').value.trim();
    const name = document.getElementById('new-scene-name').value.trim();
    const desc = document.getElementById('new-scene-desc').value.trim();
    const svcs = document.getElementById('new-scene-svcs').value.split(',').map(s => s.trim()).filter(Boolean);
    if (!id || !name || !svcs.length) { toast('ID, Name and at least one Service are required', false); return; }
    const res = await fetch('/api/scenes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name, description: desc || undefined, serviceNames: svcs }),
    });
    const data = await res.json();
    if (data.ok) { toast('Scene "' + name + '" created ✓'); toggleCreateForm('scene'); await loadAll(); }
    else toast('Error: ' + data.error, false);
  }

  // ── Agents tab ────────────────────────────────────────────────────────────
  function renderAgents(agents) {
    const grid = document.getElementById('agents-grid');
    if (!agents.length) {
      grid.innerHTML = '<div style="color:var(--text-dim)">No agents registered.</div>';
      return;
    }
    grid.innerHTML = agents.map(ag => agentCardHTML(ag)).join('');
  }

  function agentCardHTML(ag) {
    const toolWord = ag.toolCount === 1 ? 'tool' : 'tools';
    const scopeLabel = ag.allowedServices
      ? '<span class="svc-chip">explicit services</span>'
      : ag.sceneId
        ? '<span class="svc-chip">scene: ' + ag.sceneId + '</span>'
        : '<span class="svc-chip">all services</span>';
    const svcChips = (ag.allowedServices || []).map(n =>
      '<span class="svc-chip">' + icon(n) + ' ' + n + '</span>'
    ).join('');
    return \`<div class="group-card">
      <div class="group-card-title">🤖 \${ag.name} <span style="font-size:0.7rem;color:var(--text-dim);font-weight:400">#\${ag.id}</span></div>
      \${ag.description ? '<div class="group-card-desc">' + ag.description + '</div>' : ''}
      <div class="group-card-services">\${scopeLabel}\${svcChips}</div>
      <div class="group-card-footer">
        <span class="group-card-meta">\${ag.toolCount} \${toolWord}</span>
        <button class="btn btn-ghost btn-sm ml-auto" onclick="switchToDispatchAs('\${ag.id}')">▶ Try</button>
        <button class="btn btn-danger btn-sm" onclick="deleteAgent('\${ag.id}')">🗑</button>
      </div>
    </div>\`;
  }

  async function deleteAgent(id) {
    if (!confirm('Remove agent "' + id + '"?')) return;
    const res = await fetch('/api/agents/' + id, { method: 'DELETE' });
    const data = await res.json();
    if (data.ok) { toast('Agent removed'); await loadAll(); }
    else toast('Error: ' + data.error, false);
  }

  async function createAgent() {
    const id    = document.getElementById('new-agent-id').value.trim();
    const name  = document.getElementById('new-agent-name').value.trim();
    const scene = document.getElementById('new-agent-scene').value.trim();
    const svcs  = document.getElementById('new-agent-svcs').value.split(',').map(s => s.trim()).filter(Boolean);
    const desc  = document.getElementById('new-agent-desc').value.trim();
    if (!id || !name) { toast('ID and Name are required', false); return; }
    const body = { id, name, description: desc || undefined, sceneId: scene || undefined, allowedServices: svcs.length ? svcs : undefined };
    const res = await fetch('/api/agents', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.ok) { toast('Agent "' + name + '" created ✓'); toggleCreateForm('agent'); await loadAll(); }
    else toast('Error: ' + data.error, false);
  }

  // ── Plugins tab ───────────────────────────────────────────────────────────
  const CATEGORY_ICONS = {
    'Data & Analytics':     '📊',
    'Developer Tools':      '🛠',
    'Productivity':         '📋',
    'Document Processing':  '📄',
    'Communication':        '💬',
    'default':              '🔌',
  };
  function categoryIcon(cat) { return CATEGORY_ICONS[cat] || CATEGORY_ICONS['default']; }

  function populateCategoryFilter(plugins) {
    const cats = [...new Set(plugins.map(p => p.category))].sort();
    const sel = document.getElementById('plugin-category-filter');
    const prev = sel.value;
    sel.innerHTML = '<option value="">All categories</option>'
      + cats.map(c => '<option value="' + c + '">' + c + '</option>').join('');
    if (prev) sel.value = prev;
  }

  function renderPluginGrid() {
    const statusFilter   = document.getElementById('plugin-filter').value;
    const categoryFilter = document.getElementById('plugin-category-filter').value;
    let plugins = allPlugins;
    if (statusFilter === 'installed') plugins = plugins.filter(p => p.status === 'installed');
    else if (statusFilter === 'available') plugins = plugins.filter(p => p.status !== 'installed');
    if (categoryFilter) plugins = plugins.filter(p => p.category === categoryFilter);
    const grid = document.getElementById('plugins-grid');
    if (!plugins.length) {
      grid.innerHTML = '<div style="color:var(--text-dim);grid-column:1/-1">No plugins match the filter.</div>';
      return;
    }
    grid.innerHTML = plugins.map(p => pluginCardHTML(p)).join('');
  }

  function pluginCardHTML(p) {
    const isInstalled = p.status === 'installed';
    const toolWord = p.toolCount === 1 ? 'tool' : 'tools';
    const installBtn = isInstalled
      ? \`<button class="btn btn-danger btn-sm" onclick="uninstallPlugin('\${p.id}')">⏏ Uninstall</button>\`
      : \`<button class="btn btn-success btn-sm" id="install-btn-\${p.id}" onclick="installPlugin('\${p.id}')">⬇ Install</button>\`;
    const homepageLink = p.homepage
      ? \`<a href="\${p.homepage}" target="_blank" rel="noopener" style="font-size:0.72rem;color:var(--accent);text-decoration:none">🔗 Docs</a>\`
      : '';
    const toolChipsHtml = p.tools
      ? p.tools.slice(0, 4).map(t => \`<span class="plugin-tool-chip">\${t.name}</span>\`).join('')
        + (p.tools.length > 4 ? \`<span class="plugin-tool-chip" style="color:var(--text-dim)">+\${p.tools.length - 4} more</span>\` : '')
      : \`<span style="font-size:0.72rem;color:var(--text-dim)">\${p.toolCount} \${toolWord}</span>\`;
    return \`<div class="group-card plugin-card \${isInstalled ? 'installed' : ''}" id="plugin-card-\${p.id}">
      <div class="group-card-title">
        \${categoryIcon(p.category)} \${p.name}
        \${isInstalled ? '<span class="plugin-badge-installed">✓ Installed</span>' : ''}
      </div>
      <div class="group-card-desc">\${p.description}</div>
      <div class="plugin-meta">
        <span>\${p.author}</span>
        <span>v\${p.version}</span>
        <span class="plugin-category">\${p.category}</span>
      </div>
      <div class="plugin-tools-list">\${toolChipsHtml}</div>
      <div class="group-card-footer">
        <span class="group-card-meta">\${p.toolCount} \${toolWord}</span>
        \${homepageLink}
        <div style="margin-left:auto;display:flex;gap:6px">\${installBtn}</div>
      </div>
    </div>\`;
  }

  async function installPlugin(pluginId) {
    const btn = document.getElementById('install-btn-' + pluginId);
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Installing…'; }
    const res = await fetch('/api/plugins/install', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pluginId }),
    });
    const data = await res.json();
    if (data.ok) { toast('Plugin "' + data.plugin.name + '" installed ✓'); await loadAll(); }
    else { toast('Install failed: ' + data.error, false); if (btn) { btn.disabled = false; btn.innerHTML = '⬇ Install'; } }
  }

  async function uninstallPlugin(pluginId) {
    const plugin = allPlugins.find(p => p.id === pluginId);
    if (!confirm('Uninstall plugin "' + (plugin ? plugin.name : pluginId) + '"?')) return;
    const res = await fetch('/api/plugins/' + pluginId, { method: 'DELETE' });
    const data = await res.json();
    if (data.ok) { toast('Plugin uninstalled'); await loadAll(); }
    else toast('Error: ' + data.error, false);
  }
  function switchToDispatchAs(agentId) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    const dispatchBtn = document.querySelector('.tab-btn[data-tab="dispatch"]');
    if (dispatchBtn) dispatchBtn.classList.add('active');
    document.getElementById('tab-dispatch').classList.add('active');
    document.getElementById('dispatch-agent').value = agentId;
    refreshToolSelect();
  }

  function populateAgentSelect(agents) {
    const sel = document.getElementById('dispatch-agent');
    const prev = sel.value;
    sel.innerHTML = '<option value="">— all tools (no agent) —</option>'
      + agents.map(a => '<option value="' + a.id + '">' + a.name + ' (' + a.id + ')</option>').join('');
    if (prev) sel.value = prev;
  }

  async function refreshToolSelect() {
    const agentId = document.getElementById('dispatch-agent').value;
    let tools;
    if (agentId) {
      tools = await fetch('/api/agents/' + agentId + '/tools').then(r => r.json());
      if (!Array.isArray(tools)) tools = await fetch('/api/tools').then(r => r.json());
    } else {
      tools = await fetch('/api/tools').then(r => r.json());
    }
    populateToolSelect(tools);
  }

  function populateToolSelect(tools) {
    const sel = document.getElementById('tool-select');
    const prev = sel.value;
    sel.innerHTML = '<option value="">— select a tool —</option>'
      + tools.map(t => '<option value="' + t.name + '">' + t.name + '</option>').join('');
    if (prev) sel.value = prev;
  }

  function onToolSelect() {
    const toolName = document.getElementById('tool-select').value;
    if (!toolName) return;
    fetch('/api/tools').then(r => r.json()).then(ts => {
      const t = ts.find(x => x.name === toolName);
      if (!t) return;
      const example = {};
      Object.entries(t.parameters.properties || {}).forEach(([k, v]) => {
        if ((t.parameters.required || []).includes(k)) {
          example[k] = v.type === 'string' ? 'example' : v.type === 'number' ? 1 : true;
        }
      });
      document.getElementById('tool-args').value = JSON.stringify(example);
    });
  }

  async function dispatchTool() {
    const agentId  = document.getElementById('dispatch-agent').value;
    const toolName = document.getElementById('tool-select').value;
    const argsRaw  = document.getElementById('tool-args').value;
    const resultEl = document.getElementById('dispatch-result');
    const btn      = document.getElementById('dispatch-btn');

    if (!toolName) { toast('Please select a tool', false); return; }
    let args = {};
    if (argsRaw.trim()) {
      try { args = JSON.parse(argsRaw); }
      catch { toast('Invalid JSON in arguments', false); return; }
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Running…';
    resultEl.className = 'dispatch-result';

    try {
      const url  = agentId ? '/api/dispatch-as/' + agentId : '/api/dispatch';
      const res  = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolName, arguments: args }),
      });
      const data = await res.json();
      resultEl.textContent = JSON.stringify(data, null, 2);
      resultEl.className = 'dispatch-result show ' + (data.ok ? 'success' : 'error');
    } catch (e) {
      resultEl.textContent = 'Network error: ' + e.message;
      resultEl.className = 'dispatch-result show error';
    } finally {
      btn.disabled = false;
      btn.innerHTML = '▶ Run';
    }
  }

  // ── Create form toggle ────────────────────────────────────────────────────
  function toggleCreateForm(type) {
    const formId = 'create-' + type + '-form';
    const form = document.getElementById(formId);
    form.classList.toggle('open');
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  loadAll();
</script>
</body>
</html>`;
