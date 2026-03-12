import * as http from "http";
import { McpServiceListManager } from "./core/McpServiceListManager";
import { handleCostRoutes } from "./api/costRoutes";

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

const manager = new McpServiceListManager();

const server = http.createServer((req, res) => {
  if (handleCostRoutes(req, res, manager)) {
    return;
  }

  res.setHeader("Content-Type", "application/json");
  res.writeHead(404);
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, () => {
  console.log(`[myExtBot] Server running on http://localhost:${PORT}`);
  console.log(`  GET http://localhost:${PORT}/api/costs`);
  console.log(`  GET http://localhost:${PORT}/api/costs/summary`);
  console.log(`  GET http://localhost:${PORT}/api/costs/agents`);
  console.log(`  GET http://localhost:${PORT}/api/costs/tools`);
});

export { server, manager };
