import express, { Request, Response } from "express";
import { McpServiceListManager } from "./core/McpServiceListManager";
import { PluginRegistry } from "./marketplace/PluginRegistry";
import { PluginInstaller } from "./marketplace/PluginInstaller";
import { PluginManager } from "./core/PluginManager";
import { DelegationLogReader } from "./core/DelegationLogReader";
import { SearchService } from "./services/SearchService";
import { CalendarService } from "./services/CalendarService";
import { CodeRunnerService } from "./services/CodeRunnerService";
import { PlaywrightService } from "./services/PlaywrightService";
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
import { setupSwagger } from "./api/openapi";

// ── Bootstrap ────────────────────────────────────────────────────────────────

const manager = new McpServiceListManager();
manager.register(new SearchService());
manager.register(new CalendarService());
manager.register(new CodeRunnerService());
manager.register(new PlaywrightService());

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
  serviceNames: ["SearchService", "CalendarService", "CodeRunnerService", "PlaywrightService"],
});
manager.registerScene({
  id: "browser-automation",
  name: "Browser Automation",
  description: "AI-driven browser automation and web interaction tasks.",
  serviceNames: ["PlaywrightService"],
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
manager.registerAgent({
  id: "browser-bot",
  name: "Browser Bot",
  description:
    "Controls a real browser via Playwright MCP for web automation, scraping, and E2E testing.",
  sceneId: "browser-automation",
  canDelegateTo: ["research-bot"],
  systemPrompt:
    "你是一个专业的浏览器自动化助手。你可以控制真实浏览器完成网页操作、数据抓取和自动化测试任务。始终优先使用 browser_snapshot 获取页面结构，再执行操作。",
  intents: ["browser-automation", "web-scraping", "e2e-testing", "click", "navigate", "screenshot"],
  domains: ["automation", "testing", "browser"],
  languages: ["zh-CN", "en-US"],
  responseStyle: "markdown",
  primarySkill: "Browser automation via Playwright MCP",
  capabilities: [
    "Navigate to any URL",
    "Click elements on a page",
    "Type text into inputs",
    "Take screenshots",
    "Get page accessibility snapshots",
    "Run end-to-end browser workflows",
  ],
  constraints: [
    "Requires PLAYWRIGHT_MCP_URL environment variable for real browser control",
    "Cannot access browser sessions of other users",
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

// API documentation (Swagger UI at /api-docs, raw JSON at /api-docs/json)
setupSwagger(app);

// Plugin manager
const pluginManager = new PluginManager(manager);

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * @openapi
 * components:
 *   schemas:
 *     Scene:
 *       type: object
 *       required: [id, name, serviceNames]
 *       properties:
 *         id:
 *           type: string
 *         name:
 *           type: string
 *         description:
 *           type: string
 *         serviceNames:
 *           type: array
 *           items:
 *             type: string
 *     AgentProfile:
 *       type: object
 *       required: [id, name]
 *       properties:
 *         id:
 *           type: string
 *         name:
 *           type: string
 *         description:
 *           type: string
 *         sceneId:
 *           type: string
 *         allowedServices:
 *           type: array
 *           items:
 *             type: string
 *         canDelegateTo:
 *           type: array
 *           items:
 *             type: string
 *         primarySkill:
 *           type: string
 *         secondarySkills:
 *           type: array
 *           items:
 *             type: string
 *         capabilities:
 *           type: array
 *           items:
 *             type: string
 *         constraints:
 *           type: array
 *           items:
 *             type: string
 *         systemPrompt:
 *           type: string
 *         intents:
 *           type: array
 *           items:
 *             type: string
 *         domains:
 *           type: array
 *           items:
 *             type: string
 *         languages:
 *           type: array
 *           items:
 *             type: string
 *         responseStyle:
 *           type: string
 */
function extractQuery(req: Request, res: Response): string | null {
  const q = req.query.query;
  if (typeof q !== "string" || q.trim() === "") {
    res.status(400).json({ error: "Missing required query parameter: query" });
    return null;
  }
  return q;
}

// ── Services API ──────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/services:
 *   get:
 *     tags: [Services]
 *     summary: List all registered services
 *     responses:
 *       200:
 *         description: Array of service descriptors
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   name:
 *                     type: string
 *                   enabled:
 *                     type: boolean
 */
app.get("/api/services", (_req: Request, res: Response) => {
  res.json(manager.listServices());
});

/**
 * @openapi
 * /api/services/{name}/enable:
 *   post:
 *     tags: [Services]
 *     summary: Enable a service by name
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Service enabled
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessOk'
 *       404:
 *         description: Service not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.post("/api/services/:name/enable", (req: Request, res: Response) => {
  try {
    manager.enableService(String(req.params.name));
    res.json({ ok: true });
  } catch (e) {
    res.status(404).json({ ok: false, error: (e as Error).message });
  }
});

/**
 * @openapi
 * /api/services/{name}/disable:
 *   post:
 *     tags: [Services]
 *     summary: Disable a service by name
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Service disabled
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessOk'
 *       404:
 *         description: Service not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.post("/api/services/:name/disable", (req: Request, res: Response) => {
  try {
    manager.disableService(String(req.params.name));
    res.json({ ok: true });
  } catch (e) {
    res.status(404).json({ ok: false, error: (e as Error).message });
  }
});

/**
 * @openapi
 * /api/tools:
 *   get:
 *     tags: [Tools]
 *     summary: List all tool definitions from enabled services
 *     responses:
 *       200:
 *         description: Array of tool definitions
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   name:
 *                     type: string
 *                   description:
 *                     type: string
 *                   inputSchema:
 *                     type: object
 */
app.get("/api/tools", (_req: Request, res: Response) => {
  res.json(manager.getToolDefinitions());
});

/**
 * @openapi
 * /api/dispatch:
 *   post:
 *     tags: [Tools]
 *     summary: Dispatch a tool call
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [toolName]
 *             properties:
 *               toolName:
 *                 type: string
 *                 maxLength: 128
 *               arguments:
 *                 type: object
 *     responses:
 *       200:
 *         description: Tool call result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                 result:
 *                   type: object
 *       400:
 *         description: Validation or execution error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
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

/**
 * @openapi
 * /api/scenes:
 *   get:
 *     tags: [Scenes]
 *     summary: List all registered scenes
 *     responses:
 *       200:
 *         description: Array of Scene objects
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Scene'
 */
app.get("/api/scenes", (_req: Request, res: Response) => {
  res.json(manager.listScenes());
});

/**
 * @openapi
 * /api/scenes:
 *   post:
 *     tags: [Scenes]
 *     summary: Register a new scene
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Scene'
 *     responses:
 *       200:
 *         description: Scene registered
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                 scene:
 *                   $ref: '#/components/schemas/Scene'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
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

/**
 * @openapi
 * /api/scenes/{id}:
 *   delete:
 *     tags: [Scenes]
 *     summary: Remove a scene by ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Scene removed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessOk'
 */
app.delete("/api/scenes/:id", (req: Request, res: Response) => {
  const id = String(req.params.id);
  manager.removeScene(id);
  recordAudit(req, 200, `sceneId=${id}`);
  res.json({ ok: true });
});

// ── Agents API ────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/agents:
 *   get:
 *     tags: [Agents]
 *     summary: List all registered agents
 *     responses:
 *       200:
 *         description: Array of AgentProfile objects
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/AgentProfile'
 */
app.get("/api/agents", (_req: Request, res: Response) => {
  res.json(manager.listAgents());
});

/**
 * @openapi
 * /api/agents/route:
 *   get:
 *     tags: [Agents]
 *     summary: Route a query to the most relevant agents
 *     parameters:
 *       - in: query
 *         name: query
 *         required: true
 *         schema:
 *           type: string
 *         description: Natural language query to route
 *       - in: query
 *         name: topN
 *         schema:
 *           type: integer
 *           default: 3
 *         description: Number of top suggestions to return
 *     responses:
 *       200:
 *         description: Array of agent routing suggestions (sorted by score)
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   agentId:
 *                     type: string
 *                   score:
 *                     type: number
 *       400:
 *         description: Missing query parameter
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.get("/api/agents/route", (req: Request, res: Response) => {
  const query = extractQuery(req, res);
  if (query === null) return;
  const topNRaw = req.query.topN;
  const topN =
    typeof topNRaw === "string" && /^\d+$/.test(topNRaw) ? parseInt(topNRaw, 10) : 3;
  res.json(manager.routeAgent(query, topN));
});

/**
 * @openapi
 * /api/agents/route/best:
 *   get:
 *     tags: [Agents]
 *     summary: Get the single best-matching agent for a query
 *     parameters:
 *       - in: query
 *         name: query
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Best agent ID and suggestion
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 agentId:
 *                   type: string
 *                   nullable: true
 *                 suggestion:
 *                   type: object
 *                   nullable: true
 *       400:
 *         description: Missing query parameter
 */
app.get("/api/agents/route/best", (req: Request, res: Response) => {
  const query = extractQuery(req, res);
  if (query === null) return;
  const suggestions = manager.routeAgent(query, 1);
  const top = suggestions[0] ?? null;
  const agentId = top && top.score > 0 ? top.agentId : null;
  res.json({ agentId, suggestion: top && top.score > 0 ? top : null });
});

/**
 * @openapi
 * /api/agents/{id}/tools:
 *   get:
 *     tags: [Agents]
 *     summary: Get tool definitions available to a specific agent
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Array of tool definitions
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *       404:
 *         description: Agent not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.get("/api/agents/:id/tools", (req: Request, res: Response) => {
  try {
    res.json(manager.getToolDefinitionsForAgent(String(req.params.id)));
  } catch (e) {
    res.status(404).json({ ok: false, error: (e as Error).message });
  }
});

/**
 * @openapi
 * /api/agents/{id}:
 *   get:
 *     tags: [Agents]
 *     summary: Get a specific agent by ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: The agent profile
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AgentProfile'
 *       404:
 *         description: Agent not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.get("/api/agents/:id", (req: Request, res: Response) => {
  const agent = manager.listAgents().find((a) => a.id === String(req.params.id));
  if (!agent) {
    res.status(404).json({ ok: false, error: `Agent "${req.params.id}" is not registered.` });
    return;
  }
  res.json(agent);
});

/**
 * @openapi
 * /api/agents:
 *   post:
 *     tags: [Agents]
 *     summary: Register a new agent
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AgentProfile'
 *     responses:
 *       200:
 *         description: Agent registered
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                 agent:
 *                   $ref: '#/components/schemas/AgentProfile'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
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

/**
 * @openapi
 * /api/agents/{id}:
 *   patch:
 *     tags: [Agents]
 *     summary: Update an existing agent (partial update)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Partial AgentProfile fields to update
 *     responses:
 *       200:
 *         description: Agent updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                 agent:
 *                   $ref: '#/components/schemas/AgentProfile'
 *       400:
 *         description: Validation error
 *       404:
 *         description: Agent not found
 */
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

/**
 * @openapi
 * /api/agents/{id}:
 *   delete:
 *     tags: [Agents]
 *     summary: Remove an agent by ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Agent removed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessOk'
 */
app.delete("/api/agents/:id", (req: Request, res: Response) => {
  const id = String(req.params.id);
  manager.removeAgent(id);
  recordAudit(req, 200, `agentId=${id}`);
  res.json({ ok: true });
});

/**
 * @openapi
 * /api/dispatch-as/{agentId}:
 *   post:
 *     tags: [Agents]
 *     summary: Dispatch a tool call as a specific agent
 *     parameters:
 *       - in: path
 *         name: agentId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [toolName]
 *             properties:
 *               toolName:
 *                 type: string
 *               arguments:
 *                 type: object
 *     responses:
 *       200:
 *         description: Tool call result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                 agentId:
 *                   type: string
 *                 result:
 *                   type: object
 *       400:
 *         description: Validation or execution error
 */
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

/**
 * @openapi
 * /api/agents/{fromAgentId}/delegate:
 *   post:
 *     tags: [Delegation]
 *     summary: Delegate a tool call from one agent to another
 *     parameters:
 *       - in: path
 *         name: fromAgentId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [toAgentId, toolName]
 *             properties:
 *               toAgentId:
 *                 type: string
 *               toolName:
 *                 type: string
 *               arguments:
 *                 type: object
 *     responses:
 *       200:
 *         description: Delegation result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                 fromAgentId:
 *                   type: string
 *                 toAgentId:
 *                   type: string
 *                 result:
 *                   type: object
 *       400:
 *         description: Validation or execution error
 */
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

/**
 * @openapi
 * /api/delegation-log:
 *   get:
 *     tags: [Delegation]
 *     summary: Query delegation log entries
 *     parameters:
 *       - in: query
 *         name: date
 *         schema:
 *           type: string
 *           format: date
 *         description: Date to query (YYYY-MM-DD, defaults to today)
 *       - in: query
 *         name: agentId
 *         schema:
 *           type: string
 *         description: Filter by fromAgentId or toAgentId
 *       - in: query
 *         name: toolName
 *         schema:
 *           type: string
 *       - in: query
 *         name: success
 *         schema:
 *           type: string
 *           enum: ["true", "false"]
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 100
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *     responses:
 *       200:
 *         description: Delegation log entries
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 entries:
 *                   type: array
 *                   items:
 *                     type: object
 *                 total:
 *                   type: integer
 *                 date:
 *                   type: string
 */
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

/**
 * @openapi
 * /api/delegation-log/dates:
 *   get:
 *     tags: [Delegation]
 *     summary: List all dates for which delegation log files exist
 *     responses:
 *       200:
 *         description: Available dates in descending order
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 dates:
 *                   type: array
 *                   items:
 *                     type: string
 *                     format: date
 */
app.get("/api/delegation-log/dates", async (_req: Request, res: Response) => {
  const reader = new DelegationLogReader();
  const dates = await reader.listAvailableDates();
  res.json({ dates });
});

/**
 * @openapi
 * /api/delegation-log/summary:
 *   get:
 *     tags: [Delegation]
 *     summary: Get aggregated delegation statistics for a date
 *     parameters:
 *       - in: query
 *         name: date
 *         schema:
 *           type: string
 *           format: date
 *         description: Date to summarise (defaults to today)
 *     responses:
 *       200:
 *         description: Delegation summary
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 totalCalls:
 *                   type: integer
 *                 successRate:
 *                   type: number
 *                 byAgent:
 *                   type: object
 *                 byTool:
 *                   type: object
 */
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

/**
 * @openapi
 * /api/plugins:
 *   get:
 *     tags: [Plugins]
 *     summary: List all plugins (PluginManager — legacy)
 *     responses:
 *       200:
 *         description: Array of plugin summaries
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 */
app.get("/api/plugins", (_req: Request, res: Response) => {
  res.json(pluginManager.listAll());
});

/**
 * @openapi
 * /api/plugins/installed:
 *   get:
 *     tags: [Plugins]
 *     summary: List installed plugins (PluginManager — legacy)
 *     responses:
 *       200:
 *         description: Array of installed plugin summaries
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 */
app.get("/api/plugins/installed", (_req: Request, res: Response) => {
  res.json(pluginManager.listInstalled());
});

/**
 * @openapi
 * /api/plugins/install:
 *   post:
 *     tags: [Plugins]
 *     summary: Install a plugin by ID (PluginManager — legacy)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [pluginId]
 *             properties:
 *               pluginId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Plugin installed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                 plugin:
 *                   type: object
 *       400:
 *         description: Validation or install error
 */
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

/**
 * @openapi
 * /api/plugins/install-from-url:
 *   post:
 *     tags: [Plugins]
 *     summary: Install a plugin from a URL (PluginManager — legacy)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [url]
 *             properties:
 *               url:
 *                 type: string
 *                 format: uri
 *     responses:
 *       200:
 *         description: Plugin installed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       400:
 *         description: Validation or install error
 */
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

/**
 * @openapi
 * /api/plugins/{pluginId}:
 *   delete:
 *     tags: [Plugins]
 *     summary: Uninstall a plugin (PluginManager — legacy)
 *     parameters:
 *       - in: path
 *         name: pluginId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Plugin uninstalled
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessOk'
 *       400:
 *         description: Uninstall error
 */
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

/**
 * @openapi
 * /api/security/audit-log:
 *   get:
 *     tags: [Security]
 *     summary: Get in-memory audit log entries
 *     responses:
 *       200:
 *         description: Array of audit log entries
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   timestamp:
 *                     type: string
 *                     format: date-time
 *                   method:
 *                     type: string
 *                   path:
 *                     type: string
 *                   status:
 *                     type: integer
 *                   detail:
 *                     type: string
 */
app.get("/api/security/audit-log", (_req: Request, res: Response) => {
  res.json(getAuditLog());
});

// ── Health check ──────────────────────────────────────────────────────────────

/**
 * @openapi
 * /health:
 *   get:
 *     tags: [Health]
 *     summary: Basic health check (no auth required)
 *     security: []
 *     responses:
 *       200:
 *         description: Server is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: ok
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 */
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
