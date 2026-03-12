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
 *   GET  /api/agents/:id                  — get a single agent profile
 *   POST /api/agents                      — create an agent  { id, name, description?, sceneId?, allowedServices?, canDelegateTo?, primarySkill?, secondarySkills?, capabilities?, constraints? }
 *   PATCH /api/agents/:id                 — update an agent  (any subset of writable fields)
 *   DELETE /api/agents/:id                — remove an agent
 *   POST /api/dispatch-as/:agentId        — dispatch a tool call as a specific agent
 *   POST /api/agents/:fromAgentId/delegate — delegate a tool call to another agent  { toAgentId, toolName, arguments }
 *   GET  /api/delegation-log              — query the inter-agent delegation history (supports agentId/toolName/date/success/limit/offset)
 *   GET  /api/delegation-log/dates        — list all dates with recorded log files (descending)
 *   GET  /api/delegation-log/summary      — aggregated statistics for a given date
 *
 *   GET  /api/plugins                     — list all plugins in the registry (with install status)
 *   GET  /api/plugins/installed           — list installed plugins only
 *   POST /api/plugins/install             — install a plugin  { pluginId }
 *   POST /api/plugins/install-from-url    — install a plugin from an HTTPS manifest URL  { url }
 *   DELETE /api/plugins/:pluginId         — uninstall a plugin
 *
 *   GET  /api/security/audit-log          — security audit log of all mutating operations
 *
 * Security configuration (environment variables):
 *   API_KEY        — Bearer/X-API-Key value for /api/* auth (unset = disabled)
 *   CORS_ORIGIN    — Exact allowed cross-origin (unset = same-origin only)
 *   RATE_LIMIT_MAX — Max read req/min/IP (default 120)
 *   WRITE_RATE_MAX — Max write req/min/IP (default 30)
 *   TRUST_PROXY    — Set "true" to read IP from X-Forwarded-For
 *
 * Run:  npm run server
 */

import express, { Request, Response } from "express";
import { McpServiceListManager } from "./core/McpServiceListManager";
import { PluginManager } from "./core/PluginManager";
import { DelegationLogReader } from "./core/DelegationLogReader";
import { SearchService } from "./services/SearchService";
import { CalendarService } from "./services/CalendarService";
import { CodeRunnerService } from "./services/CodeRunnerService";
import { AgentProfile, Scene, ToolCall } from "./core/types";
import {
  securityHeaders,
  corsPolicy,
  rateLimiter,
  writeRateLimiter,
  requireApiKey,
  printSecurityStatus,
} from "./security/middleware";
import {
  validateId,
  validateName,
  validateDescription,
  validateStringArray,
  validateShortText,
  validatePluginUrl,
  validateAgentFields,
  formatValidationErrors,
  MAX,
} from "./security/validation";
import { recordAudit, getAuditLog } from "./security/auditLog";

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
  canDelegateTo: ["scheduling-assistant"],
  primarySkill: "Web research & information retrieval",
  secondarySkills: ["Summarisation", "Source citation", "Fact verification"],
  capabilities: [
    "Search the web for any topic",
    "Summarise long-form documents",
    "Retrieve and cite sources",
    "Delegate follow-up scheduling to Scheduling Assistant",
  ],
  constraints: [
    "Cannot access internal or private databases",
    "Does not store search history",
    "Results may be outdated — always cite the retrieval date",
  ],
});
manager.registerAgent({
  id: "scheduling-assistant",
  name: "Scheduling Assistant",
  description: "Manages calendar events and scheduling.",
  sceneId: "productivity",
  primarySkill: "Calendar event management",
  secondarySkills: ["Availability checking", "Meeting coordination", "Reminder setting"],
  capabilities: [
    "Create, read, and update calendar events",
    "Check free/busy slots across a date range",
    "Set event reminders and recurrence rules",
  ],
  constraints: [
    "Cannot send external emails or notifications",
    "Cannot access calendars of other users",
    "No delegation permissions — terminal agent",
  ],
});
manager.registerAgent({
  id: "dev-bot",
  name: "Dev Bot",
  description: "Runs code snippets and searches for documentation.",
  allowedServices: ["CodeRunnerService", "SearchService"],
  canDelegateTo: ["research-bot"],
  primarySkill: "Code execution & developer tooling",
  secondarySkills: ["Documentation lookup", "Debugging assistance", "Script automation"],
  capabilities: [
    "Execute code in multiple languages (Python, JS, etc.)",
    "Search developer documentation and Stack Overflow",
    "Generate and validate code snippets",
    "Delegate deep research tasks to Research Bot",
  ],
  constraints: [
    "No network access during code execution (sandboxed)",
    "Cannot read or write to the host filesystem",
    "Execution timeout: 30 seconds per run",
  ],
});
manager.registerAgent({
  id: "full-agent",
  name: "Full Agent",
  description: "Unrestricted access to all registered services. Can delegate to any agent.",
  sceneId: "full",
  canDelegateTo: ["*"],
  primarySkill: "Multi-domain orchestration",
  secondarySkills: ["Task decomposition", "Cross-agent coordination", "Workflow automation"],
  capabilities: [
    "Access all registered services simultaneously",
    "Orchestrate multi-step workflows across agents",
    "Delegate any task to any registered agent",
    "Combine search, calendar, and code in a single pipeline",
  ],
  constraints: [
    "For power users only — no service restrictions",
    "Audit log is mandatory for all operations",
  ],
});

const app = express();

// ── Global security middleware ────────────────────────────────────────────────
// Order matters: headers and CORS first, then rate-limiting, then body parsing.

app.use(securityHeaders);
app.use(corsPolicy);

// Restrict request body to 256 KB to prevent oversized payload attacks.
app.use(express.json({ limit: "256kb" }));

// Rate limiting for all API routes.
app.use("/api", rateLimiter);
app.use("/api", writeRateLimiter);

// Optional API key authentication for all API routes.
app.use("/api", requireApiKey);

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
  // Validate toolName is a reasonable identifier
  if (typeof toolName !== "string" || toolName.length > 128) {
    res.status(400).json({ ok: false, error: "toolName must be a string up to 128 characters" });
    return;
  }
  try {
    const call: ToolCall = { toolName, arguments: args ?? {} };
    const result = await manager.dispatch(call);
    recordAudit(req, 200, `tool=${toolName}`);
    res.json({ ok: true, result });
  } catch (e) {
    recordAudit(req, 400, `tool=${toolName} error=${(e as Error).message}`);
    res.status(400).json({ ok: false, error: (e as Error).message });
  }
});

// ── Scenes API ───────────────────────────────────────────────────────────────

app.get("/api/scenes", (_req: Request, res: Response) => {
  res.json(manager.listScenes());
});

app.post("/api/scenes", (req: Request, res: Response) => {
  const { id, name, description, serviceNames } = req.body as Partial<Scene>;

  // Validate required fields
  const idErr = validateId(id);
  if (idErr) {
    res.status(400).json({ ok: false, error: `id: ${idErr}` });
    return;
  }
  const nameErr = validateName(name);
  if (nameErr) {
    res.status(400).json({ ok: false, error: `name: ${nameErr}` });
    return;
  }
  if (!Array.isArray(serviceNames)) {
    res.status(400).json({ ok: false, error: "serviceNames must be an array" });
    return;
  }
  const svcErr = validateStringArray(serviceNames, "serviceNames", MAX.id);
  if (svcErr) {
    res.status(400).json({ ok: false, error: svcErr });
    return;
  }
  const descErr = validateDescription(description);
  if (descErr) {
    res.status(400).json({ ok: false, error: `description: ${descErr}` });
    return;
  }

  try {
    manager.registerScene({ id: id!, name: name!, description, serviceNames });
    recordAudit(req, 200, `sceneId=${id}`);
    res.json({ ok: true, scene: manager.listScenes().find((s) => s.id === id) });
  } catch (e) {
    recordAudit(req, 400, `sceneId=${id} error=${(e as Error).message}`);
    res.status(400).json({ ok: false, error: (e as Error).message });
  }
});

app.delete("/api/scenes/:id", (req: Request, res: Response) => {
  const id = String(req.params.id);
  manager.removeScene(id);
  recordAudit(req, 200, `sceneId=${id}`);
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

app.get("/api/agents/:id", (req: Request, res: Response) => {
  const agent = manager.listAgents().find((a) => a.id === String(req.params.id));
  if (!agent) {
    res.status(404).json({ ok: false, error: `Agent "${req.params.id}" is not registered.` });
    return;
  }
  res.json(agent);
});

app.post("/api/agents", (req: Request, res: Response) => {
  const body = req.body as Partial<AgentProfile>;

  // Validate id and name (required)
  const idErr = validateId(body.id);
  if (idErr) {
    res.status(400).json({ ok: false, error: `id: ${idErr}` });
    return;
  }
  const nameErr = validateName(body.name);
  if (nameErr) {
    res.status(400).json({ ok: false, error: `name: ${nameErr}` });
    return;
  }

  // Validate optional fields
  const fieldErrors = validateAgentFields(body as Record<string, unknown>);
  if (Object.keys(fieldErrors).length > 0) {
    res.status(400).json({ ok: false, error: formatValidationErrors(fieldErrors) });
    return;
  }

  try {
    manager.registerAgent({
      id: body.id!,
      name: body.name!,
      description: body.description,
      sceneId: body.sceneId,
      allowedServices: body.allowedServices,
      canDelegateTo: body.canDelegateTo,
      primarySkill: body.primarySkill,
      secondarySkills: body.secondarySkills,
      capabilities: body.capabilities,
      constraints: body.constraints,
    });
    recordAudit(req, 200, `agentId=${body.id}`);
    res.json({ ok: true, agent: manager.listAgents().find((a) => a.id === body.id) });
  } catch (e) {
    recordAudit(req, 400, `agentId=${body.id} error=${(e as Error).message}`);
    res.status(400).json({ ok: false, error: (e as Error).message });
  }
});

app.patch("/api/agents/:id", (req: Request, res: Response) => {
  const id = String(req.params.id);
  const patch = req.body as Partial<Omit<AgentProfile, "id">>;

  // Validate patch fields
  const fieldErrors = validateAgentFields(patch as Record<string, unknown>);
  if (Object.keys(fieldErrors).length > 0) {
    res.status(400).json({ ok: false, error: formatValidationErrors(fieldErrors) });
    return;
  }

  try {
    manager.updateAgent(id, patch);
    recordAudit(req, 200, `agentId=${id}`);
    res.json({ ok: true, agent: manager.listAgents().find((a) => a.id === id) });
  } catch (e) {
    recordAudit(req, 404, `agentId=${id} error=${(e as Error).message}`);
    res.status(404).json({ ok: false, error: (e as Error).message });
  }
});

app.delete("/api/agents/:id", (req: Request, res: Response) => {
  const id = String(req.params.id);
  manager.removeAgent(id);
  recordAudit(req, 200, `agentId=${id}`);
  res.json({ ok: true });
});

app.post("/api/dispatch-as/:agentId", async (req: Request, res: Response) => {
  const agentId = String(req.params.agentId);
  const { toolName, arguments: args } = req.body as {
    toolName?: string;
    arguments?: Record<string, unknown>;
  };
  if (!toolName || typeof toolName !== "string" || toolName.length > 128) {
    res.status(400).json({ ok: false, error: "toolName must be a non-empty string up to 128 characters" });
    return;
  }
  try {
    const call: ToolCall = { toolName, arguments: args ?? {} };
    const result = await manager.dispatchAs(agentId, call);
    recordAudit(req, 200, `agentId=${agentId} tool=${toolName}`);
    res.json({ ok: true, agentId, result });
  } catch (e) {
    recordAudit(req, 400, `agentId=${agentId} tool=${toolName} error=${(e as Error).message}`);
    res.status(400).json({ ok: false, error: (e as Error).message });
  }
});

app.post("/api/agents/:fromAgentId/delegate", async (req: Request, res: Response) => {
  const fromAgentId = String(req.params.fromAgentId);
  const { toAgentId, toolName, arguments: args } = req.body as {
    toAgentId?: string;
    toolName?: string;
    arguments?: Record<string, unknown>;
  };
  if (!toAgentId || !toolName) {
    res.status(400).json({ ok: false, error: "toAgentId and toolName are required" });
    return;
  }
  if (typeof toolName !== "string" || toolName.length > 128) {
    res.status(400).json({ ok: false, error: "toolName must be a string up to 128 characters" });
    return;
  }
  try {
    const call: ToolCall = { toolName, arguments: args ?? {} };
    const result = await manager.delegateAs(fromAgentId, toAgentId, call);
    recordAudit(req, 200, `from=${fromAgentId} to=${toAgentId} tool=${toolName}`);
    res.json({ ok: true, fromAgentId, toAgentId, result });
  } catch (e) {
    recordAudit(req, 400, `from=${fromAgentId} to=${toAgentId} error=${(e as Error).message}`);
    res.status(400).json({ ok: false, error: (e as Error).message });
  }
});

app.get("/api/delegation-log", async (req: Request, res: Response) => {
  const { agentId, toolName, date, success, limit, offset } = req.query as Record<string, string | undefined>;
  const reader = new DelegationLogReader();
  const entries = await reader.query({
    agentId,
    toolName,
    date,
    success: success === undefined ? undefined : success === "true",
    limit: limit !== undefined ? parseInt(limit, 10) : 100,
    offset: offset !== undefined ? parseInt(offset, 10) : 0,
  });
  const resolvedDate = date ?? new Date().toISOString().slice(0, 10);
  res.json({ entries, total: entries.length, date: resolvedDate });
});

app.get("/api/delegation-log/dates", async (_req: Request, res: Response) => {
  const reader = new DelegationLogReader();
  const dates = await reader.listAvailableDates();
  res.json({ dates });
});

app.get("/api/delegation-log/summary", async (req: Request, res: Response) => {
  const { date } = req.query as { date?: string };
  const reader = new DelegationLogReader();
  const entries = await reader.query({ date, limit: 10000, offset: 0 });

  const byAgent: Record<string, { calls: number; success: number }> = {};
  const byTool: Record<string, { calls: number; success: number }> = {};

  for (const e of entries) {
    for (const id of [e.fromAgentId, e.toAgentId]) {
      if (!byAgent[id]) byAgent[id] = { calls: 0, success: 0 };
      byAgent[id].calls++;
      if (e.success) byAgent[id].success++;
    }
    if (!byTool[e.toolName]) byTool[e.toolName] = { calls: 0, success: 0 };
    byTool[e.toolName].calls++;
    if (e.success) byTool[e.toolName].success++;
  }

  const totalCalls = entries.length;
  const successCount = entries.filter((e) => e.success).length;
  res.json({
    totalCalls,
    successRate: totalCalls === 0 ? 0 : successCount / totalCalls,
    byAgent,
    byTool,
  });
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
  const idErr = validateId(pluginId);
  if (idErr) {
    res.status(400).json({ ok: false, error: `pluginId: ${idErr}` });
    return;
  }
  try {
    const summary = pluginManager.install(pluginId!);
    recordAudit(req, 200, `pluginId=${pluginId}`);
    res.json({ ok: true, plugin: summary });
  } catch (e) {
    recordAudit(req, 400, `pluginId=${pluginId} error=${(e as Error).message}`);
    res.status(400).json({ ok: false, error: (e as Error).message });
  }
});

app.post("/api/plugins/install-from-url", async (req: Request, res: Response) => {
  const { url } = req.body as { url?: string };

  // SSRF + URL validation before any network call.
  const urlErr = validatePluginUrl(url);
  if (urlErr) {
    res.status(400).json({ ok: false, error: `url: ${urlErr}` });
    return;
  }

  try {
    const summary = await pluginManager.installFromUrl(url!);
    recordAudit(req, 200, `url=${url}`);
    res.json({ ok: true, plugin: summary });
  } catch (e) {
    recordAudit(req, 400, `url=${url} error=${(e as Error).message}`);
    res.status(400).json({ ok: false, error: (e as Error).message });
  }
});

app.delete("/api/plugins/:pluginId", (req: Request, res: Response) => {
  const pluginId = String(req.params.pluginId);
  try {
    pluginManager.uninstall(pluginId);
    recordAudit(req, 200, `pluginId=${pluginId}`);
    res.json({ ok: true });
  } catch (e) {
    recordAudit(req, 400, `pluginId=${pluginId} error=${(e as Error).message}`);
    res.status(400).json({ ok: false, error: (e as Error).message });
  }
});

// ── Security API ──────────────────────────────────────────────────────────────

/**
 * Returns the security audit log.
 * Lists all mutating operations (POST, PATCH, DELETE) in reverse-chronological
 * order so operators can review what changes were made and by whom.
 */
app.get("/api/security/audit-log", (_req: Request, res: Response) => {
  res.json(getAuditLog());
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
  printSecurityStatus();
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
  <!-- API Key entry (shown when auth is required) -->
  <div id="api-key-row" style="display:flex;align-items:center;gap:8px;margin-left:auto">
    <span id="key-indicator" title="Auth status" style="font-size:1.1rem;cursor:default">🔓</span>
    <input id="api-key-input" type="password" placeholder="API Key (optional)"
      style="font-size:0.78rem;padding:5px 10px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text);width:180px"
      onchange="setApiKey(this.value)" onblur="setApiKey(this.value)" />
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
    <button class="tab-btn"        data-tab="security" onclick="switchTab('security', this); loadSecurityPanel()">🔒 Security</button>
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
      <div class="form-grid-2">
        <div><label>Description</label><input id="new-agent-desc" type="text" placeholder="Optional description" /></div>
        <div><label>Can delegate to (agent IDs, comma-separated; * = any)</label><input id="new-agent-delegate" type="text" placeholder="scheduling-assistant, *" /></div>
      </div>
      <div class="form-grid-2">
        <div><label>Primary Skill</label><input id="new-agent-primary-skill" type="text" placeholder="Web research &amp; retrieval" /></div>
        <div><label>Secondary Skills (comma-separated)</label><input id="new-agent-secondary-skills" type="text" placeholder="Summarisation, Citation" /></div>
      </div>
      <div class="form-grid-2">
        <div><label>Capabilities (one per line)</label><textarea id="new-agent-capabilities" rows="3" placeholder="Search the web&#10;Summarise documents" style="width:100%;resize:vertical;font-size:0.82rem;padding:6px 10px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text)"></textarea></div>
        <div><label>Constraints (one per line)</label><textarea id="new-agent-constraints" rows="3" placeholder="No filesystem access&#10;30 s execution timeout" style="width:100%;resize:vertical;font-size:0.82rem;padding:6px 10px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text)"></textarea></div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-primary btn-sm" onclick="createAgent()">Create Agent</button>
        <button class="btn btn-ghost btn-sm"  onclick="toggleCreateForm('agent')">Cancel</button>
      </div>
    </div>

    <div class="group-grid" id="agents-grid">
      <div style="color:var(--text-dim)">Loading agents…</div>
    </div>

    <!-- Communication Log -->
    <div style="margin-top:28px">
      <div class="flex-gap mb-8">
        <div class="section-title" style="margin:0;font-size:0.95rem">📨 Inter-Agent Communication Log</div>
        <button class="btn btn-ghost btn-sm" onclick="refreshDelegationLog()" style="margin-left:auto">↻ Refresh</button>
        <button class="btn btn-ghost btn-sm" onclick="toggleDelegateForm()" id="delegate-toggle-btn">＋ Try Delegate</button>
      </div>

      <!-- Try-delegate form (collapsible) -->
      <div class="create-form" id="delegate-try-form">
        <div style="font-weight:600;margin-bottom:10px;font-size:0.85rem">Send a delegation request between agents</div>
        <div class="form-grid-2" style="margin-bottom:10px">
          <div>
            <label>From Agent</label>
            <select id="delegate-from" onchange="populateDelegateTargets()">
              <option value="">— choose —</option>
            </select>
          </div>
          <div>
            <label>To Agent</label>
            <select id="delegate-to" onchange="populateDelegateTools()">
              <option value="">— choose —</option>
            </select>
          </div>
        </div>
        <div class="form-grid-2" style="margin-bottom:10px">
          <div>
            <label>Tool Name</label>
            <select id="delegate-tool">
              <option value="">— choose to-agent first —</option>
            </select>
          </div>
          <div>
            <label>Arguments (JSON)</label>
            <input id="delegate-args" type="text" placeholder='{"query":"test"}' />
          </div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-primary btn-sm" onclick="submitDelegate()" aria-label="Send delegation request">📨 Send Delegation</button>
          <button class="btn btn-ghost btn-sm"   onclick="toggleDelegateForm()">Cancel</button>
        </div>
      </div>

      <div id="delegation-log-container">
        <div style="color:var(--text-dim);font-size:0.8rem">No delegations recorded yet.</div>
      </div>
    </div>
  </div>

  <!-- ── TAB: Plugins ── -->
  <div class="tab-pane" id="tab-plugins">
    <div class="flex-gap mb-8">
      <div class="section-title" style="margin:0">🔌 Plugin Marketplace</div>
      <div style="margin-left:auto;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <input id="plugin-search" type="search" placeholder="🔍 Search plugins…" oninput="renderPluginGrid()"
          style="font-size:0.78rem;padding:4px 10px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text);width:160px" />
        <select id="plugin-filter" onchange="renderPluginGrid()" style="font-size:0.78rem;padding:4px 8px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text)">
          <option value="all">All plugins</option>
          <option value="available">Available</option>
          <option value="installed">Installed</option>
        </select>
        <select id="plugin-category-filter" onchange="renderPluginGrid()" style="font-size:0.78rem;padding:4px 8px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text)">
          <option value="">All categories</option>
        </select>
        <button class="btn btn-primary btn-sm" onclick="toggleUrlInstallForm()">＋ URL</button>
        <button class="btn btn-ghost btn-sm" onclick="loadAll()">↻ Refresh</button>
      </div>
    </div>

    <!-- Install-from-URL form (collapsible) -->
    <div class="create-form" id="url-install-form">
      <div style="font-weight:600;margin-bottom:10px;font-size:0.85rem">Install plugin from manifest URL</div>
      <div class="form-grid-1" style="margin-bottom:10px">
        <div>
          <label>Manifest URL (HTTPS)</label>
          <input id="url-install-input" type="url" placeholder="https://example.com/my-plugin/manifest.json" />
        </div>
      </div>
      <div style="font-size:0.72rem;color:var(--text-dim);margin-bottom:12px">
        The URL must point to a valid JSON manifest with the required fields: <code>id, name, version, author, description, category, tools</code>.
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-primary btn-sm" onclick="installFromUrl()">⬇ Install from URL</button>
        <button class="btn btn-ghost btn-sm" onclick="toggleUrlInstallForm()">Cancel</button>
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

  <!-- ── TAB: Security ── -->
  <div class="tab-pane" id="tab-security">
    <div class="section-title">🔒 Security Overview &amp; Audit Log</div>

    <!-- Security config cards -->
    <div class="stats-bar" id="sec-config-bar" style="margin-bottom:16px">
      <div class="stat-card"><div class="stat-value" id="sec-auth-status" style="font-size:1.3rem">—</div><div class="stat-label">Auth</div></div>
      <div class="stat-card"><div class="stat-value" id="sec-cors-status"  style="font-size:1.3rem">—</div><div class="stat-label">CORS</div></div>
      <div class="stat-card"><div class="stat-value" id="sec-rate-status"  style="font-size:1.3rem">—</div><div class="stat-label">Rate Limit</div></div>
      <div class="stat-card"><div class="stat-value" id="sec-headers-status" style="font-size:1.3rem">—</div><div class="stat-label">Headers</div></div>
      <div class="stat-card"><div class="stat-value purple" id="sec-audit-count">—</div><div class="stat-label">Audit Entries</div></div>
    </div>

    <!-- Threat model information -->
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;margin-bottom:20px">
      <div class="group-card" style="border-left:3px solid var(--success,#22c55e)">
        <div class="group-card-title" style="color:var(--success,#22c55e)">✅ Implemented Controls</div>
        <ul style="margin:8px 0 0 16px;padding:0;font-size:0.8rem;line-height:1.8">
          <li>Content-Security-Policy (XSS mitigation)</li>
          <li>X-Frame-Options: DENY (clickjacking)</li>
          <li>X-Content-Type-Options: nosniff</li>
          <li>Referrer-Policy + Permissions-Policy</li>
          <li>Per-IP rate limiting (read + write)</li>
          <li>Optional Bearer / X-API-Key auth</li>
          <li>SSRF prevention on plugin URLs</li>
          <li>Input validation (slugs, lengths, arrays)</li>
          <li>Request body size limit (256 KB)</li>
          <li>HTML output escaping (XSS)</li>
          <li>Audit log for all mutating ops</li>
          <li>X-Powered-By header removed</li>
        </ul>
      </div>
      <div class="group-card" style="border-left:3px solid var(--warning,#f59e0b)">
        <div class="group-card-title" style="color:var(--warning,#f59e0b)">⚠️ Recommendations (Production)</div>
        <ul style="margin:8px 0 0 16px;padding:0;font-size:0.8rem;line-height:1.8">
          <li>Enable API_KEY env var for authentication</li>
          <li>Terminate TLS at a reverse proxy (nginx)</li>
          <li>Persist audit log to a database</li>
          <li>Add CORS_ORIGIN if serving cross-origin</li>
          <li>Run behind firewall — not directly exposed</li>
          <li>Rotate API key periodically</li>
          <li>Add structured logging (Winston / Pino)</li>
        </ul>
      </div>
      <div class="group-card" style="border-left:3px solid var(--accent,#6366f1)">
        <div class="group-card-title">🔑 API Key Configuration</div>
        <div style="font-size:0.8rem;margin-top:6px;line-height:1.8">
          <p style="margin:0 0 8px">Enter your API key below to authenticate UI requests (stored in sessionStorage for this tab only):</p>
          <div style="display:flex;gap:8px;align-items:center">
            <input id="sec-key-input" type="password" placeholder="Paste API key here…"
              style="flex:1;font-size:0.78rem;padding:5px 10px;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--text)"
              onchange="applySecurityTabKey(this.value)" />
            <button class="btn btn-primary btn-sm" onclick="applySecurityTabKey(document.getElementById('sec-key-input').value)">Apply</button>
          </div>
          <p style="margin:8px 0 0;color:var(--text-dim);font-size:0.75rem">
            Start server with <code>API_KEY=your-secret npm run server</code> to enable server-side auth.
          </p>
        </div>
      </div>
    </div>

    <!-- Audit log -->
    <div class="flex-gap mb-8" style="margin-top:16px">
      <div class="section-title" style="margin:0">📋 Mutation Audit Log</div>
      <button class="btn btn-ghost btn-sm ml-auto" onclick="loadAuditLog()">↻ Refresh</button>
    </div>
    <div id="audit-log-container">
      <div style="color:var(--text-dim);font-size:0.8rem">Click ↻ Refresh to load the audit log.</div>
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

  /** Escapes a string for safe HTML interpolation. */
  function esc(s) {
    if (!s) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ── Tab navigation ────────────────────────────────────────────────────────
  function switchTab(id, btn) {
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('tab-' + id).classList.add('active');
    btn.classList.add('active');
  }

  // ── API Key management ────────────────────────────────────────────────────
  // The management UI sends the API key (if configured) with every request.
  // The key is stored in sessionStorage so it does not persist across tabs/sessions.
  let _apiKey = sessionStorage.getItem('mcp_api_key') || '';

  function setApiKey(key) {
    _apiKey = key.trim();
    if (_apiKey) { sessionStorage.setItem('mcp_api_key', _apiKey); }
    else { sessionStorage.removeItem('mcp_api_key'); }
    syncApiKeyInputs(_apiKey);
    updateKeyUI();
    loadAll();
  }

  /** Keeps both the header input and the Security-tab input in sync. */
  function syncApiKeyInputs(value) {
    const headerInput = document.getElementById('api-key-input');
    const secInput    = document.getElementById('sec-key-input');
    if (headerInput) headerInput.value = value;
    if (secInput)    secInput.value    = value;
  }

  /** Called from the Security tab "Apply" button and its input's onchange. */
  function applySecurityTabKey(value) {
    setApiKey(value);
  }

  function updateKeyUI() {
    const indicator = document.getElementById('key-indicator');
    if (indicator) indicator.textContent = _apiKey ? '🔐' : '🔓';
  }

  /**
   * Drop-in replacement for fetch() that automatically injects
   * the API key header when one is configured.
   * On 401, shows the key row (via CSS class) and throws.
   */
  async function apiFetch(url, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (_apiKey) headers['X-API-Key'] = _apiKey;
    const res = await fetch(url, { ...options, headers });
    if (res.status === 401) {
      toast('🔐 Unauthorized — please enter a valid API key.', false);
      // Reveal the key input by removing the 'hidden' class if present.
      const keyRow = document.getElementById('api-key-row');
      if (keyRow) keyRow.classList.remove('hidden');
      throw new Error('Unauthorized');
    }
    return res;
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
        apiFetch('/api/services').then(r => r.json()),
        apiFetch('/api/tools').then(r => r.json()),
        apiFetch('/api/scenes').then(r => r.json()),
        apiFetch('/api/agents').then(r => r.json()),
        apiFetch('/api/plugins').then(r => r.json()),
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
      refreshDelegationLog();
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
      const tools = await apiFetch('/api/tools').then(r => r.json());
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
      const res = await apiFetch('/api/services/' + name + '/' + action, { method: 'POST' });
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
    const res = await apiFetch('/api/scenes/' + id, { method: 'DELETE' });
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
    const res = await apiFetch('/api/scenes', {
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
        ? '<span class="svc-chip">scene: ' + esc(ag.sceneId) + '</span>'
        : '<span class="svc-chip">all services</span>';
    const svcChips = (ag.allowedServices || []).map(n =>
      '<span class="svc-chip">' + icon(n) + ' ' + esc(n) + '</span>'
    ).join('');
    const delegateChips = ag.canDelegateTo && ag.canDelegateTo.length
      ? '<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px;align-items:center">'
          + '<span style="font-size:0.7rem;color:var(--text-dim)">📨 delegates to:</span>'
          + ag.canDelegateTo.map(d => '<span class="svc-chip" style="background:var(--accent);color:#fff;opacity:0.85">' + esc(d) + '</span>').join('')
          + '</div>'
      : '';

    // ── Capability metadata rows ──────────────────────────────────────────
    const primarySkillRow = ag.primarySkill
      ? '<div style="margin-top:8px;display:flex;align-items:flex-start;gap:6px">'
          + '<span style="font-size:0.7rem;color:var(--text-dim);white-space:nowrap;margin-top:2px">⭐ Primary:</span>'
          + '<span style="font-size:0.78rem;font-weight:600;color:var(--text)">' + esc(ag.primarySkill) + '</span>'
          + '</div>'
      : '';
    const secondarySkillsRow = ag.secondarySkills && ag.secondarySkills.length
      ? '<div style="margin-top:5px;display:flex;flex-wrap:wrap;align-items:center;gap:4px">'
          + '<span style="font-size:0.7rem;color:var(--text-dim)">🔸 Secondary:</span>'
          + ag.secondarySkills.map(s => '<span class="svc-chip" style="background:rgba(234,179,8,0.15);color:var(--text)">' + esc(s) + '</span>').join('')
          + '</div>'
      : '';
    const capabilitiesSection = ag.capabilities && ag.capabilities.length
      ? '<details style="margin-top:6px"><summary style="font-size:0.75rem;color:var(--text-dim);cursor:pointer;user-select:none">✅ Capabilities (' + ag.capabilities.length + ')</summary>'
          + '<ul style="margin:4px 0 0 16px;padding:0;font-size:0.78rem;color:var(--text)">'
          + ag.capabilities.map(c => '<li>' + esc(c) + '</li>').join('')
          + '</ul></details>'
      : '';
    const constraintsSection = ag.constraints && ag.constraints.length
      ? '<details style="margin-top:4px"><summary style="font-size:0.75rem;color:var(--text-dim);cursor:pointer;user-select:none">🚫 Constraints (' + ag.constraints.length + ')</summary>'
          + '<ul style="margin:4px 0 0 16px;padding:0;font-size:0.78rem;color:var(--warning,#f59e0b)">'
          + ag.constraints.map(c => '<li>' + esc(c) + '</li>').join('')
          + '</ul></details>'
      : '';

    // ── Inline edit form (hidden by default) ─────────────────────────────
    const editFormId = 'edit-agent-form-' + ag.id;
    const editForm = \`<div id="\${editFormId}" style="display:none;margin-top:12px;border-top:1px solid var(--border);padding-top:12px">
      <div style="font-weight:600;font-size:0.82rem;margin-bottom:8px">✏️ Edit Agent Profile</div>
      <div class="form-grid-2" style="margin-bottom:8px">
        <div><label>Display Name</label><input data-field="name" value="\${esc(ag.name)}" type="text" /></div>
        <div><label>Description</label><input data-field="description" value="\${esc(ag.description || '')}" type="text" /></div>
      </div>
      <div class="form-grid-2" style="margin-bottom:8px">
        <div><label>Primary Skill</label><input data-field="primarySkill" value="\${esc(ag.primarySkill || '')}" type="text" placeholder="e.g. Web research &amp; retrieval" /></div>
        <div><label>Secondary Skills (comma-separated)</label><input data-field="secondarySkills" value="\${esc((ag.secondarySkills || []).join(', '))}" type="text" /></div>
      </div>
      <div class="form-grid-2" style="margin-bottom:8px">
        <div><label>Capabilities (one per line)</label>
          <textarea data-field="capabilities" rows="4" style="width:100%;resize:vertical;font-size:0.78rem;padding:6px 10px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text)">\${esc((ag.capabilities || []).join('\\n'))}</textarea>
        </div>
        <div><label>Constraints (one per line)</label>
          <textarea data-field="constraints" rows="4" style="width:100%;resize:vertical;font-size:0.78rem;padding:6px 10px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text)">\${esc((ag.constraints || []).join('\\n'))}</textarea>
        </div>
      </div>
      <div class="form-grid-2" style="margin-bottom:8px">
        <div><label>Scene ID</label><input data-field="sceneId" value="\${esc(ag.sceneId || '')}" type="text" /></div>
        <div><label>Allowed Services (comma-separated)</label><input data-field="allowedServices" value="\${esc((ag.allowedServices || []).join(', '))}" type="text" /></div>
      </div>
      <div class="form-grid-1" style="margin-bottom:8px">
        <div><label>Can delegate to (comma-separated; * = any)</label><input data-field="canDelegateTo" value="\${esc((ag.canDelegateTo || []).join(', '))}" type="text" /></div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-primary btn-sm" onclick="saveAgent('\${esc(ag.id)}')">💾 Save</button>
        <button class="btn btn-ghost btn-sm" onclick="toggleEditForm('\${esc(ag.id)}')">Cancel</button>
      </div>
    </div>\`;

    return \`<div class="group-card" id="agent-card-\${esc(ag.id)}">
      <div class="group-card-title">🤖 \${esc(ag.name)} <span style="font-size:0.7rem;color:var(--text-dim);font-weight:400">#\${esc(ag.id)}</span></div>
      \${ag.description ? '<div class="group-card-desc">' + esc(ag.description) + '</div>' : ''}
      <div class="group-card-services">\${scopeLabel}\${svcChips}</div>
      \${delegateChips}
      \${primarySkillRow}
      \${secondarySkillsRow}
      \${capabilitiesSection}
      \${constraintsSection}
      \${editForm}
      <div class="group-card-footer">
        <span class="group-card-meta">\${ag.toolCount} \${toolWord}</span>
        <button class="btn btn-ghost btn-sm ml-auto" onclick="switchToDispatchAs('\${esc(ag.id)}')">▶ Try</button>
        <button class="btn btn-ghost btn-sm" onclick="toggleEditForm('\${esc(ag.id)}')">✏️ Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteAgent('\${esc(ag.id)}')">🗑</button>
      </div>
    </div>\`;
  }

  function toggleEditForm(agentId) {
    const form = document.getElementById('edit-agent-form-' + agentId);
    if (form) form.style.display = form.style.display === 'none' ? 'block' : 'none';
  }

  async function saveAgent(agentId) {
    const card = document.getElementById('agent-card-' + agentId);
    const patch = {};
    card.querySelectorAll('[data-field]').forEach(el => {
      const field = el.getAttribute('data-field');
      const val = el.value.trim();
      if (['secondarySkills', 'allowedServices', 'canDelegateTo'].includes(field)) {
        patch[field] = val ? val.split(',').map(s => s.trim()).filter(Boolean) : undefined;
      } else if (['capabilities', 'constraints'].includes(field)) {
        patch[field] = val ? val.split('\\n').map(s => s.trim()).filter(Boolean) : undefined;
      } else {
        patch[field] = val || undefined;
      }
    });
    const res = await apiFetch('/api/agents/' + agentId, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (data.ok) { toast('Agent "' + agentId + '" updated ✓'); await loadAll(); }
    else toast('Error: ' + data.error, false);
  }

  async function deleteAgent(id) {
    if (!confirm('Remove agent "' + id + '"?')) return;
    const res = await apiFetch('/api/agents/' + id, { method: 'DELETE' });
    const data = await res.json();
    if (data.ok) { toast('Agent removed'); await loadAll(); }
    else toast('Error: ' + data.error, false);
  }

  async function createAgent() {
    const id       = document.getElementById('new-agent-id').value.trim();
    const name     = document.getElementById('new-agent-name').value.trim();
    const scene    = document.getElementById('new-agent-scene').value.trim();
    const svcs     = document.getElementById('new-agent-svcs').value.split(',').map(s => s.trim()).filter(Boolean);
    const desc     = document.getElementById('new-agent-desc').value.trim();
    const delegate = document.getElementById('new-agent-delegate').value.split(',').map(s => s.trim()).filter(Boolean);
    const primarySkill    = document.getElementById('new-agent-primary-skill').value.trim();
    const secondarySkills = document.getElementById('new-agent-secondary-skills').value.split(',').map(s => s.trim()).filter(Boolean);
    const capabilities    = document.getElementById('new-agent-capabilities').value.split('\\n').map(s => s.trim()).filter(Boolean);
    const constraints     = document.getElementById('new-agent-constraints').value.split('\\n').map(s => s.trim()).filter(Boolean);
    if (!id || !name) { toast('ID and Name are required', false); return; }
    const body = {
      id, name,
      description: desc || undefined,
      sceneId: scene || undefined,
      allowedServices: svcs.length ? svcs : undefined,
      canDelegateTo: delegate.length ? delegate : undefined,
      primarySkill: primarySkill || undefined,
      secondarySkills: secondarySkills.length ? secondarySkills : undefined,
      capabilities: capabilities.length ? capabilities : undefined,
      constraints: constraints.length ? constraints : undefined,
    };
    const res = await apiFetch('/api/agents', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.ok) { toast('Agent "' + name + '" created ✓'); toggleCreateForm('agent'); await loadAll(); }
    else toast('Error: ' + data.error, false);
  }

  // ── Delegation helpers ─────────────────────────────────────────────────────

  function toggleDelegateForm() {
    const form = document.getElementById('delegate-try-form');
    form.classList.toggle('open');
    if (form.classList.contains('open')) {
      populateDelegateFromSelect();
    }
  }

  function populateDelegateFromSelect() {
    const sel = document.getElementById('delegate-from');
    sel.innerHTML = '<option value="">— choose —</option>'
      + allAgents.map(a => '<option value="' + a.id + '">' + a.name + ' (' + a.id + ')</option>').join('');
    document.getElementById('delegate-to').innerHTML = '<option value="">— choose from-agent first —</option>';
    document.getElementById('delegate-tool').innerHTML = '<option value="">— choose to-agent first —</option>';
  }

  function populateDelegateTargets() {
    const fromId = document.getElementById('delegate-from').value;
    const from = allAgents.find(a => a.id === fromId);
    const toSel = document.getElementById('delegate-to');
    if (!from) { toSel.innerHTML = '<option value="">— choose from-agent first —</option>'; return; }
    const canDelegate = from.canDelegateTo || [];
    const targets = canDelegate.includes('*')
      ? allAgents.filter(a => a.id !== fromId)
      : allAgents.filter(a => canDelegate.includes(a.id));
    toSel.innerHTML = '<option value="">— choose —</option>'
      + (targets.length
          ? targets.map(a => '<option value="' + a.id + '">' + a.name + ' (' + a.id + ')</option>').join('')
          : '<option disabled>(no delegation targets permitted)</option>');
    document.getElementById('delegate-tool').innerHTML = '<option value="">— choose to-agent first —</option>';
  }

  async function populateDelegateTools() {
    const toId = document.getElementById('delegate-to').value;
    const toolSel = document.getElementById('delegate-tool');
    if (!toId) { toolSel.innerHTML = '<option value="">— choose to-agent first —</option>'; return; }
    try {
      const tools = await apiFetch('/api/agents/' + toId + '/tools').then(r => r.json());
      toolSel.innerHTML = '<option value="">— choose tool —</option>'
        + tools.map(t => '<option value="' + t.name + '">' + t.name + ' — ' + t.description + '</option>').join('');
    } catch { toolSel.innerHTML = '<option value="">Failed to load tools</option>'; }
  }

  async function submitDelegate() {
    const fromId = document.getElementById('delegate-from').value;
    const toId   = document.getElementById('delegate-to').value;
    const tool   = document.getElementById('delegate-tool').value;
    const argsRaw = document.getElementById('delegate-args').value.trim();
    if (!fromId || !toId || !tool) { toast('From, To, and Tool are required', false); return; }
    let args = {};
    if (argsRaw) {
      try { args = JSON.parse(argsRaw); }
      catch { toast('Arguments must be valid JSON', false); return; }
    }
    const btn = document.querySelector('#delegate-try-form .btn-primary');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Sending...';
    const res = await apiFetch('/api/agents/' + fromId + '/delegate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toAgentId: toId, toolName: tool, arguments: args }),
    });
    const data = await res.json();
    btn.disabled = false; btn.innerHTML = '📨 Send Delegation';
    if (data.ok) {
      toast('Delegation succeeded ✓');
      toggleDelegateForm();
      await refreshDelegationLog();
    } else {
      toast('Delegation failed: ' + data.error, false);
      await refreshDelegationLog();
    }
  }

  async function refreshDelegationLog() {
    const container = document.getElementById('delegation-log-container');
    try {
      const log = await apiFetch('/api/delegation-log').then(r => r.json());
      if (!log.length) {
        container.innerHTML = '<div style="color:var(--text-dim);font-size:0.8rem">No delegations recorded yet.</div>';
        return;
      }
      container.innerHTML = '<div style="display:flex;flex-direction:column;gap:6px">'
        + log.map(entry => {
          const ts = new Date(entry.timestamp).toLocaleTimeString();
          const statusColor = entry.success ? 'var(--success,#22c55e)' : 'var(--danger,#ef4444)';
          const statusIcon  = entry.success ? '✓' : '✗';
          const rawOutput   = entry.success
            ? (typeof entry.output === 'object' ? JSON.stringify(entry.output).slice(0, 120) : String(entry.output ?? '').slice(0, 120))
            : entry.error;
          const outputStr = esc(rawOutput || '');
          return \`<div style="background:var(--surface);border:1px solid var(--border);border-left:3px solid \${statusColor};border-radius:6px;padding:8px 12px;font-size:0.78rem">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
              <span style="color:var(--text-dim)">\${esc(ts)}</span>
              <span style="font-weight:600">🤖 \${esc(entry.fromAgentId)}</span>
              <span style="color:var(--accent)">→</span>
              <span style="font-weight:600">🤖 \${esc(entry.toAgentId)}</span>
              <span style="font-family:monospace;background:var(--bg);padding:1px 6px;border-radius:4px">\${esc(entry.toolName)}</span>
              <span style="margin-left:auto;color:\${statusColor};font-weight:600">\${statusIcon}</span>
            </div>
            <div style="color:var(--text-dim);font-family:monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">\${outputStr || '—'}</div>
          </div>\`;
        }).join('')
        + '</div>';
    } catch { container.innerHTML = '<div style="color:var(--text-dim);font-size:0.8rem">Failed to load delegation log.</div>'; }
  }

  // ── Security panel ────────────────────────────────────────────────────────
  async function loadSecurityPanel() {
    // Update security status cards
    document.getElementById('sec-auth-status').textContent = _apiKey ? '🔐 ON' : '🔓 OFF';
    document.getElementById('sec-auth-status').style.color = _apiKey ? 'var(--success,#22c55e)' : 'var(--warning,#f59e0b)';
    document.getElementById('sec-cors-status').textContent  = '🌐';
    document.getElementById('sec-rate-status').textContent  = '✅';
    document.getElementById('sec-headers-status').textContent = '✅';
    // Populate the secondary key input from current key
    const secInput = document.getElementById('sec-key-input');
    if (secInput && !secInput.value) secInput.value = _apiKey;
    await loadAuditLog();
  }

  async function loadAuditLog() {
    const container = document.getElementById('audit-log-container');
    if (!container) return;
    container.innerHTML = '<div style="color:var(--text-dim);font-size:0.8rem">Loading…</div>';
    try {
      const entries = await apiFetch('/api/security/audit-log').then(r => r.json());
      document.getElementById('sec-audit-count').textContent = entries.length;
      if (!entries.length) {
        container.innerHTML = '<div style="color:var(--text-dim);font-size:0.8rem">No audit entries yet — mutating operations will appear here.</div>';
        return;
      }
      container.innerHTML = '<div style="display:flex;flex-direction:column;gap:5px">'
        + entries.map(e => {
          const ts = new Date(e.timestamp).toLocaleString();
          const statusOk    = e.status < 300;
          const statusWarn  = e.status === 401;
          const statusColor = statusOk ? 'var(--success,#22c55e)' : statusWarn ? 'var(--warning,#f59e0b)' : 'var(--danger,#ef4444)';
          const statusLabel = statusOk ? '✓ ' + e.status : statusWarn ? '⚠ ' + e.status : '✗ ' + e.status;
          const methodColor = ['POST','PATCH','PUT'].includes(e.method) ? 'var(--accent,#6366f1)' : e.method === 'DELETE' ? 'var(--danger,#ef4444)' : 'var(--text-dim)';
          return \`<div style="background:var(--surface);border:1px solid var(--border);border-left:3px solid \${statusColor};border-radius:6px;padding:7px 12px;font-size:0.78rem;display:flex;align-items:center;gap:10px;flex-wrap:wrap" role="row" aria-label="\${esc(e.method)} \${esc(e.path)} status \${e.status}">
            <span style="color:var(--text-dim);white-space:nowrap">\${esc(ts)}</span>
            <span style="font-family:monospace;font-weight:700;color:\${methodColor};min-width:50px">\${esc(e.method)}</span>
            <span style="font-family:monospace;color:var(--text);flex:1;min-width:200px">\${esc(e.path)}</span>
            <span style="font-family:monospace;background:var(--bg);padding:1px 7px;border-radius:4px;color:\${statusColor};font-weight:600">\${esc(statusLabel)}</span>
            <span style="color:var(--text-dim);font-size:0.73rem">\${esc(e.ip)}</span>
            \${e.detail ? \`<span style="color:var(--text-dim);font-size:0.73rem;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">\${esc(e.detail)}</span>\` : ''}
          </div>\`;
        }).join('')
        + '</div>';
    } catch (err) {
      container.innerHTML = \`<div style="color:var(--text-dim);font-size:0.8rem">Failed to load audit log\${err.message ? ': ' + esc(err.message) : ''}.</div>\`;
    }
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
    const searchQuery    = (document.getElementById('plugin-search').value || '').trim().toLowerCase();
    let plugins = allPlugins;
    if (statusFilter === 'installed') plugins = plugins.filter(p => p.status === 'installed');
    else if (statusFilter === 'available') plugins = plugins.filter(p => p.status !== 'installed');
    if (categoryFilter) plugins = plugins.filter(p => p.category === categoryFilter);
    if (searchQuery) plugins = plugins.filter(p =>
      p.name.toLowerCase().includes(searchQuery) ||
      p.description.toLowerCase().includes(searchQuery) ||
      p.author.toLowerCase().includes(searchQuery)
    );
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
    const res = await apiFetch('/api/plugins/install', {
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
    const res = await apiFetch('/api/plugins/' + pluginId, { method: 'DELETE' });
    const data = await res.json();
    if (data.ok) { toast('Plugin uninstalled'); await loadAll(); }
    else toast('Error: ' + data.error, false);
  }

  function toggleUrlInstallForm() {
    const form = document.getElementById('url-install-form');
    form.classList.toggle('open');
    if (form.classList.contains('open')) {
      document.getElementById('url-install-input').focus();
    }
  }

  async function installFromUrl() {
    const url = document.getElementById('url-install-input').value.trim();
    if (!url) { toast('Please enter a URL', false); return; }
    const btn = document.querySelector('#url-install-form .btn-primary');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Installing…';
    const res = await apiFetch('/api/plugins/install-from-url', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    btn.disabled = false; btn.innerHTML = '⬇ Install from URL';
    if (data.ok) {
      toast('Plugin "' + data.plugin.name + '" installed ✓');
      document.getElementById('url-install-input').value = '';
      toggleUrlInstallForm();
      await loadAll();
    } else {
      toast('Install failed: ' + data.error, false);
    }
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
      tools = await apiFetch('/api/agents/' + agentId + '/tools').then(r => r.json());
      if (!Array.isArray(tools)) tools = await apiFetch('/api/tools').then(r => r.json());
    } else {
      tools = await apiFetch('/api/tools').then(r => r.json());
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
    apiFetch('/api/tools').then(r => r.json()).then(ts => {
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
  syncApiKeyInputs(_apiKey);
  updateKeyUI();
  loadAll();
</script>
</body>
</html>`;
