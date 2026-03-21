import * as http from "http";
import * as url from "url";
import { McpServiceListManager } from "../core/McpServiceListManager";
import { CostQueryFilter } from "../core/CostLedger";

/**
 * 注册成本相关的 REST API 路由。
 *
 * GET /api/costs          — 查询成本条目列表
 * GET /api/costs/summary  — 成本汇总报告
 * GET /api/costs/agents   — 按 Agent 汇总今日成本，降序
 * GET /api/costs/tools    — 按 Tool 汇总今日成本，降序
 */
export function handleCostRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  manager: McpServiceListManager
): boolean {
  const parsed = url.parse(req.url ?? "/", true);
  const pathname = parsed.pathname ?? "/";
  const query = parsed.query as Record<string, string | undefined>;

  if (!pathname.startsWith("/api/costs")) {
    return false;
  }

  res.setHeader("Content-Type", "application/json");

  // GET /api/costs/summary
  if (pathname === "/api/costs/summary") {
    const filter: Omit<CostQueryFilter, "limit" | "offset"> = {};
    if (query.agentId) filter.agentId = query.agentId;
    if (query.toolName) filter.toolName = query.toolName;
    if (query.date) filter.date = query.date;
    if (query.startDate) filter.startDate = query.startDate;
    if (query.endDate) filter.endDate = query.endDate;

    const summary = manager.getCostSummary(filter);
    res.writeHead(200);
    res.end(JSON.stringify(summary, null, 2));
    return true;
  }

  // GET /api/costs/agents
  if (pathname === "/api/costs/agents") {
    const today = new Date().toISOString().slice(0, 10);
    const date = query.date ?? today;
    const summary = manager.getCostSummary({ date });

    const agents = Object.entries(summary.byAgent)
      .map(([agentId, stats]) => ({ agentId, ...stats }))
      .sort((a, b) => b.cost - a.cost);

    res.writeHead(200);
    res.end(JSON.stringify(agents, null, 2));
    return true;
  }

  // GET /api/costs/tools
  if (pathname === "/api/costs/tools") {
    const today = new Date().toISOString().slice(0, 10);
    const date = query.date ?? today;
    const summary = manager.getCostSummary({ date });

    const tools = Object.entries(summary.byTool)
      .map(([toolName, stats]) => ({ toolName, ...stats }))
      .sort((a, b) => b.cost - a.cost);

    res.writeHead(200);
    res.end(JSON.stringify(tools, null, 2));
    return true;
  }

  // GET /api/costs
  if (pathname === "/api/costs") {
    const filter: CostQueryFilter = {};
    if (query.agentId) filter.agentId = query.agentId;
    if (query.toolName) filter.toolName = query.toolName;
    if (query.date) filter.date = query.date;
    if (query.limit) filter.limit = parseInt(query.limit, 10);
    if (query.offset) filter.offset = parseInt(query.offset, 10);

    const entries = manager.getCostLedger().query(filter);
    const { limit: _limit, offset: _offset, ...countFilter } = filter;
    const total = manager.getCostLedger().count(countFilter);

    res.writeHead(200);
    res.end(JSON.stringify({ entries, total }, null, 2));
    return true;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: "Not found" }));
  return true;
}
