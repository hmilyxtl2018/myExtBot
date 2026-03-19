import express, { Request, Response } from "express";
import { McpServiceListManager } from "./core/McpServiceListManager";
import { PluginRegistry } from "./marketplace/PluginRegistry";
import { PluginInstaller } from "./marketplace/PluginInstaller";
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
  validatePluginUrl,
  validateAgentFields,
  formatValidationErrors,
  MAX,
} from "./security/validation";
import { recordAudit, getAuditLog } from "./security/auditLog";
import { createLifecycleRoutes } from "./api/lifecycleRoutes";
import { createHealthRoutes } from "./api/healthRoutes";
import { createPipelineRoutes } from "./api/pipelineRoutes";
import { createPluginRoutes } from "./api/pluginRoutes";

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
  systemPrompt:
    "你是一个专注于网络信息获取的智能助手。每次回答必须附上信息来源 URL。优先返回最新的信息。",
  intents: ["web-search", "fact-check", "news", "research", "information-retrieval"],
  domains: ["research", "information"],
  languages: ["zh-CN", "en-US"],
  responseStyle: "detailed",
  primarySkill: "Web research & information retrieval",
  secondarySkills: ["Summarisation", "Source citation", "Fact verification"],
  capabilities: [
    "Search the web for any topic",
    "Summarise long-form documents",
    "Retrieve and cite sources",
  ],
  constraints: [
    "Cannot access internal or private databases",
    "Does not store search history",
  ],
});
manager.registerAgent({
  id: "scheduling-assistant",
  name: "Scheduling Assistant",
  description: "Manages calendar events and scheduling.",
  sceneId: "productivity",
  primarySkill: "Calendar event management",
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
  systemPrompt:
    "你是一个专业的编程助手。优先提供可直接运行的代码示例。代码必须有注释。",
  intents: ["coding", "programming", "run-code", "debug", "script"],
  domains: ["coding", "development"],
  languages: ["zh-CN", "en-US"],
  responseStyle: "markdown",
  primarySkill: "Code execution & technical documentation search",
  capabilities: [
    "Run code snippets",
    "Search documentation",
    "Debug code",
    "Write scripts",
  ],
});
manager.registerAgent({
  id: "full-agent",
  name: "Full Agent",
  description: "Unrestricted access to all registered services. Can delegate to any agent.",
  sceneId: "full",
  canDelegateTo: ["*"],
  primarySkill: "Multi-domain orchestration",
  capabilities: [
    "Access all registered services simultaneously",
    "Orchestrate multi-step workflows across agents",
    "Delegate any task to any registered agent",
  ],
});

// ── Express app setup ─────────────────────────────────────────────────────────

const app = express();

app.use(securityHeaders);
app.use(corsPolicy);
app.use(express.json({ limit: "256kb" }));
app.use("/api", rateLimiter);
app.use("/api", writeRateLimiter);
app.use("/api", requireApiKey);

// Lifecycle, pipeline, and health routes
app.use("/api", createLifecycleRoutes(manager));
app.use("/api", createPipelineRoutes(manager));
app.use("/api", createHealthRoutes(manager));

// Plugin manager
const pluginManager = new PluginManager(manager);

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractQuery(req: Request, res: Response): string | null {
  const q = req.query.query;
  if (typeof q !== "string" || q.trim() === "") {
    res.status(400).json({ error: "Missing required query parameter: query" });
    return null;
  }
  return q;
}

// ── Services API ──────────────────────────────────────────────────────────────

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
  if (!toolName || typeof toolName !== "string" || toolName.length > 128) {
    res.status(400).json({ ok: false, error: "toolName must be a non-empty string up to 128 characters" });
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

// ── Scenes API ────────────────────────────────────────────────────────────────

app.get("/api/scenes", (_req: Request, res: Response) => {
  res.json(manager.listScenes());
});

app.post("/api/scenes", (req: Request, res: Response) => {
  const { id, name, description, serviceNames } = req.body as Partial<Scene>;

  const idErr = validateId(id);
  if (idErr) { res.status(400).json({ ok: false, error: `id: ${idErr}` }); return; }
  const nameErr = validateName(name);
  if (nameErr) { res.status(400).json({ ok: false, error: `name: ${nameErr}` }); return; }
  if (!Array.isArray(serviceNames)) {
    res.status(400).json({ ok: false, error: "serviceNames must be an array" }); return;
  }
  const svcErr = validateStringArray(serviceNames, "serviceNames", MAX.id);
  if (svcErr) { res.status(400).json({ ok: false, error: svcErr }); return; }
  const descErr = validateDescription(description);
  if (descErr) { res.status(400).json({ ok: false, error: `description: ${descErr}` }); return; }

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

// ── Agents API ────────────────────────────────────────────────────────────────

app.get("/api/agents", (_req: Request, res: Response) => {
  res.json(manager.listAgents());
});

app.get("/api/agents/route", (req: Request, res: Response) => {
  const query = extractQuery(req, res);
  if (query === null) return;
  const topNRaw = req.query.topN;
  const topN =
    typeof topNRaw === "string" && /^\d+$/.test(topNRaw) ? parseInt(topNRaw, 10) : 3;
  res.json(manager.routeAgent(query, topN));
});

app.get("/api/agents/route/best", (req: Request, res: Response) => {
  const query = extractQuery(req, res);
  if (query === null) return;
  const suggestions = manager.routeAgent(query, 1);
  const top = suggestions[0] ?? null;
  const agentId = top && top.score > 0 ? top.agentId : null;
  res.json({ agentId, suggestion: top && top.score > 0 ? top : null });
});

app.get("/api/agents/:id/tools", (req: Request, res: Response) => {
  try {
    res.json(manager.getToolDefinitionsForAgent(String(req.params.id)));
  } catch (e) {
    res.status(404).json({ ok: false, error: (e as Error).message });
  }
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
  const idErr = validateId(body.id);
  if (idErr) { res.status(400).json({ ok: false, error: `id: ${idErr}` }); return; }
  const nameErr = validateName(body.name);
  if (nameErr) { res.status(400).json({ ok: false, error: `name: ${nameErr}` }); return; }
  const fieldErrors = validateAgentFields(body as Record<string, unknown>);
  if (Object.keys(fieldErrors).length > 0) {
    res.status(400).json({ ok: false, error: formatValidationErrors(fieldErrors) }); return;
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
      systemPrompt: body.systemPrompt,
      intents: body.intents,
      languages: body.languages,
      responseStyle: body.responseStyle,
      domains: body.domains,
      communication: body.communication,
      orchestration: body.orchestration,
      memory: body.memory,
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
  const fieldErrors = validateAgentFields(patch as Record<string, unknown>);
  if (Object.keys(fieldErrors).length > 0) {
    res.status(400).json({ ok: false, error: formatValidationErrors(fieldErrors) }); return;
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
  if (!toAgentId || !toolName || typeof toolName !== "string" || toolName.length > 128) {
    res.status(400).json({ ok: false, error: "toAgentId and toolName are required" });
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

// ── Delegation log API ────────────────────────────────────────────────────────

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
  if (idErr) { res.status(400).json({ ok: false, error: `pluginId: ${idErr}` }); return; }
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
  const urlErr = validatePluginUrl(url);
  if (urlErr) { res.status(400).json({ ok: false, error: `url: ${urlErr}` }); return; }
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

// ── Security / Audit API ──────────────────────────────────────────────────────

app.get("/api/security/audit-log", (_req: Request, res: Response) => {
  res.json(getAuditLog());
});

// ── Health check ──────────────────────────────────────────────────────────────

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ── createServer: exported factory for programmatic use ───────────────────────

/**
 * Creates and starts the Express HTTP server.
 * Used by index.ts and tests.
 *
 * @param mgr  The shared McpServiceListManager instance.
 * @returns    The running HTTP server.
 */
export function createServer(mgr: McpServiceListManager) {
  const registry = new PluginRegistry();
  const installer = new PluginInstaller(mgr, registry);

  const serverApp = express();
  serverApp.use(express.json());

  serverApp.get("/health", (_req: import("express").Request, res: import("express").Response) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  serverApp.use("/api/plugins", createPluginRoutes(mgr, installer, registry));

  serverApp.get("/api/tools", (_req: import("express").Request, res: import("express").Response) => {
    res.json(mgr.getToolDefinitions());
  });

  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
  const server = serverApp.listen(PORT, () => {
    console.log(`[server] Listening on http://localhost:${PORT}`);
  });

  return server;
}

// ── Start standalone server ───────────────────────────────────────────────────

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
app.listen(PORT, () => {
  console.log(`myExtBot server running on http://localhost:${PORT}`);
  printSecurityStatus();
});

export { app, manager };
