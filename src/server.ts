import express from "express";
import { McpServiceListManager } from "./core/McpServiceListManager";
import { PluginRegistry } from "./marketplace/PluginRegistry";
import { PluginInstaller } from "./marketplace/PluginInstaller";
import { createPluginRoutes } from "./api/pluginRoutes";

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

/**
 * Creates and starts the Express HTTP server.
 *
 * @param manager  The shared McpServiceListManager instance.
 * @returns        The running HTTP server (useful for testing).
 */
export function createServer(manager: McpServiceListManager) {
  const registry = new PluginRegistry();
  const installer = new PluginInstaller(manager, registry);

  const app = express();
  app.use(express.json());

  // ── Health check ────────────────────────────────────────────────────────────
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // ── Plugin Marketplace API ───────────────────────────────────────────────────
  app.use("/api/plugins", createPluginRoutes(manager, installer, registry));

  // ── Tools introspection ──────────────────────────────────────────────────────
  app.get("/api/tools", (_req, res) => {
    res.json(manager.getToolDefinitions());
  });

  const server = app.listen(PORT, () => {
    console.log(`[server] Listening on http://localhost:${PORT}`);
    console.log(`[server] Plugin API: http://localhost:${PORT}/api/plugins`);
  });

  return server;
}
