/**
 * Management HTTP server for the MCP Services List Manager.
 *
 * Exposes:
 *   GET  /            — single-page management UI
 *   GET  /api/services        — list all registered services
 *   POST /api/services/:name/enable  — enable a service
 *   POST /api/services/:name/disable — disable a service
 *   GET  /api/tools           — get all tool definitions (enabled services only)
 *   POST /api/dispatch        — dispatch a tool call  { toolName, arguments }
 *
 * Run:  npm run server
 */

import express, { Request, Response } from "express";
import { McpServiceListManager } from "./core/McpServiceListManager";
import { SearchService } from "./services/SearchService";
import { CalendarService } from "./services/CalendarService";
import { CodeRunnerService } from "./services/CodeRunnerService";
import { ToolCall } from "./core/types";

// ── Bootstrap ────────────────────────────────────────────────────────────────

const manager = new McpServiceListManager();
manager.register(new SearchService());
manager.register(new CalendarService());
manager.register(new CodeRunnerService());

const app = express();
app.use(express.json());

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
      --bg: #0f1117;
      --surface: #1a1d27;
      --card: #1e2130;
      --border: #2a2d3e;
      --accent: #6c63ff;
      --accent-hover: #8a82ff;
      --green: #2ecc71;
      --red: #e74c3c;
      --orange: #f39c12;
      --text: #e0e0e0;
      --text-dim: #8a8fa8;
      --tag-bg: #252840;
      --radius: 10px;
      --shadow: 0 4px 24px rgba(0,0,0,0.4);
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
    .badge.enabled  { background: rgba(46,204,113,0.15); color: var(--green); }
    .badge.disabled { background: rgba(231,76,60,0.15);  color: var(--red); }
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
    .btn-success  { background: rgba(46,204,113,0.15); color: var(--green); border: 1px solid rgba(46,204,113,0.3); }
    .btn-success:hover { background: rgba(46,204,113,0.25); }
    .btn-danger   { background: rgba(231,76,60,0.15); color: var(--red); border: 1px solid rgba(231,76,60,0.3); }
    .btn-danger:hover { background: rgba(231,76,60,0.25); }
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
      color: var(--accent-hover);
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
      color: #a8d8ea;
    }
    .param-tag.required { color: #f9ca7f; }

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
    .dispatch-result.success { border-color: rgba(46,204,113,0.4); color: #a8f0c6; }
    .dispatch-result.error   { border-color: rgba(231,76,60,0.4);  color: #f0a8a8; }

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
      border: 2px solid rgba(255,255,255,0.3);
      border-top-color: currentColor;
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    .flex-gap { display: flex; gap: 8px; align-items: center; }
    .ml-auto { margin-left: auto; }
    .mb-8 { margin-bottom: 8px; }

    @media (max-width: 600px) {
      .form-row { grid-template-columns: 1fr; }
      .stats-bar { gap: 10px; }
    }
  </style>
</head>
<body>

<header>
  <div class="logo">🤖</div>
  <div>
    <h1>MCP Services Manager</h1>
    <div class="subtitle">Manage and monitor LLM tool services</div>
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
  </div>

  <!-- Services -->
  <div class="flex-gap mb-8">
    <div class="section-title" style="margin:0">Registered Services</div>
    <button class="btn btn-ghost btn-sm ml-auto" onclick="loadServices()">↻ Refresh</button>
  </div>
  <div class="services-grid" id="services-grid">
    <div style="color:var(--text-dim); font-size:0.85rem; grid-column:1/-1;">Loading services…</div>
  </div>

  <!-- Dispatch -->
  <div class="section-title">Try a Tool Call</div>
  <div class="dispatch-section">
    <div class="form-row">
      <div>
        <label for="tool-select">Tool</label>
        <select id="tool-select" onchange="onToolSelect()">
          <option value="">— select a tool —</option>
        </select>
      </div>
      <div>
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
</main>

<div class="toast" id="toast"></div>

<script>
  // ── Service icons ─────────────────────────────────────────────────────────
  const ICONS = {
    SearchService:      '🔍',
    CalendarService:    '📅',
    CodeRunnerService:  '⚡',
  };

  function icon(name) {
    return ICONS[name] || '🧩';
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

  // ── Load & render services ────────────────────────────────────────────────
  let allServices = [];

  async function loadServices() {
    try {
      const [svcs, tools] = await Promise.all([
        fetch('/api/services').then(r => r.json()),
        fetch('/api/tools').then(r => r.json()),
      ]);
      allServices = svcs;
      renderServices(svcs);
      renderStats(svcs, tools);
      populateToolSelect(tools);
    } catch (e) {
      document.getElementById('services-grid').innerHTML =
        '<div style="color:var(--red)">Failed to load services: ' + e.message + '</div>';
    }
  }

  function renderStats(svcs, tools) {
    const enabled = svcs.filter(s => s.enabled).length;
    document.getElementById('stat-total').textContent   = svcs.length;
    document.getElementById('stat-enabled').textContent = enabled;
    document.getElementById('stat-disabled').textContent = svcs.length - enabled;
    document.getElementById('stat-tools').textContent   = tools.length;
  }

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
    if (panel.classList.contains('open')) {
      panel.classList.remove('open');
      return;
    }
    panel.classList.add('open');
    if (panel.dataset.loaded) return;

    try {
      panel.innerHTML = await renderToolsForService(name);
      panel.dataset.loaded = '1';
    } catch (e) {
      panel.innerHTML = '<div style="color:var(--red);font-size:0.8rem">Error: ' + e.message + '</div>';
    }
  }

  async function renderToolsForService(serviceName) {
    // Fetch tool definitions — only enabled services are returned by /api/tools
    // We'll show a note if the service is disabled
    const svc = allServices.find(s => s.name === serviceName);
    if (!svc || !svc.enabled) {
      return '<div style="color:var(--text-dim);font-size:0.78rem;padding:4px 0">Enable this service to inspect its tools.</div>';
    }
    const tools = await fetch('/api/tools').then(r => r.json());
    const filtered = tools; // /api/tools returns all enabled tools — we show all here for context
    if (!filtered.length) return '<div style="color:var(--text-dim);font-size:0.78rem">No active tools.</div>';
    return filtered.map(t => \`
      <div class="tool-item">
        <div class="tool-name">\${t.name}</div>
        <div class="tool-desc">\${t.description}</div>
        <div class="tool-params">
          \${Object.entries(t.parameters.properties || {}).map(([k, v]) => {
            const req = (t.parameters.required || []).includes(k);
            return '<span class="param-tag' + (req ? ' required' : '') + '">' + k + ': ' + v.type + (req ? ' *' : '') + '</span>';
          }).join('')}
        </div>
      </div>
    \`).join('');
  }

  // ── Enable / Disable ──────────────────────────────────────────────────────
  async function toggleService(name, enable) {
    const action = enable ? 'enable' : 'disable';
    const card = document.getElementById('card-' + name);
    const btns = card.querySelectorAll('.btn');
    btns.forEach(b => b.disabled = true);

    try {
      const res = await fetch('/api/services/' + name + '/' + action, { method: 'POST' });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      toast(name + (enable ? ' enabled ✓' : ' disabled'), enable);
      await loadServices();
    } catch (e) {
      toast('Error: ' + e.message, false);
      btns.forEach(b => b.disabled = false);
    }
  }

  // ── Tool dispatch ─────────────────────────────────────────────────────────
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
    // auto-fill example args
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
      const res  = await fetch('/api/dispatch', {
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

  // ── Init ──────────────────────────────────────────────────────────────────
  loadServices();
</script>
</body>
</html>`;
