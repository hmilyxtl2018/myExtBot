import { McpServiceListManager } from "./core/McpServiceListManager";
import { PluginRegistry } from "./marketplace/PluginRegistry";
import { PluginInstaller } from "./marketplace/PluginInstaller";
import { createServer } from "./server";

async function main(): Promise<void> {
  console.log("=".repeat(60));
  console.log("  myExtBot — Digital Twin Asset System");
  console.log("=".repeat(60));

  // ── 1. Bootstrap the service manager ────────────────────────────────────────
  const manager = new McpServiceListManager();

  // ── 2. Start the HTTP server ─────────────────────────────────────────────────
  createServer(manager);

  // ── 15. Plugin Marketplace Demo ──────────────────────────────────────────────
  const installer = new PluginInstaller(manager, new PluginRegistry());

  // Restore previously installed plugins
  await installer.restoreInstalled();

  // Install weather-service
  const installResult = await installer.install("weather-service");
  console.log("Install weather-service:", installResult);

  // Verify the tool was registered
  console.log(
    "Tools after install:",
    manager.getToolDefinitions().map((t) => t.name)
  );

  // Uninstall
  const uninstallResult = await installer.uninstall("weather-service");
  console.log("Uninstall weather-service:", uninstallResult);

  // Verify the tool was removed
  console.log(
    "Tools after uninstall:",
    manager.getToolDefinitions().map((t) => t.name)
  );
}

main().catch((err) => {
  console.error("[main] Fatal error:", err);
  process.exit(1);
});
