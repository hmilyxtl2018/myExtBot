import { McpServiceListManager } from "../core/McpServiceListManager";
import { PluginRegistry } from "./PluginRegistry";
import { PluginService } from "./PluginService";
import { PluginManifest } from "../types";

/**
 * PluginInstaller — executes plugin install and uninstall logic.
 *
 * Install flow:
 * 1. Check whether the plugin is already installed (return success if so).
 * 2. Look up the manifest in the marketplace catalogue (or accept an external manifest).
 * 3. Create a PluginService wrapping the manifest's tools.
 * 4. Call manager.register(pluginService).
 * 5. Call registry.markInstalled(manifest).
 *
 * Uninstall flow:
 * 1. Check whether the plugin is installed.
 * 2. Call manager.unregister(pluginId).
 * 3. Call registry.markUninstalled(pluginId).
 */
export class PluginInstaller {
  constructor(
    private manager: McpServiceListManager,
    private registry: PluginRegistry
  ) {}

  /** Install a plugin by its marketplace ID. */
  async install(
    pluginId: string
  ): Promise<{ success: boolean; message: string }> {
    if (await this.registry.isInstalled(pluginId)) {
      return { success: true, message: `Plugin '${pluginId}' is already installed.` };
    }

    const marketplace = await this.registry.loadMarketplace();
    const manifest = marketplace.find((m) => m.id === pluginId);
    if (!manifest) {
      return {
        success: false,
        message: `Plugin '${pluginId}' not found in marketplace.`,
      };
    }

    return this.installFromManifest(manifest);
  }

  /** Install a plugin directly from a manifest object. */
  async installFromManifest(
    manifest: PluginManifest
  ): Promise<{ success: boolean; message: string }> {
    if (await this.registry.isInstalled(manifest.id)) {
      return {
        success: true,
        message: `Plugin '${manifest.id}' is already installed.`,
      };
    }

    const service = new PluginService(manifest);
    this.manager.register(service);
    await this.registry.markInstalled(manifest);

    return {
      success: true,
      message: `Plugin '${manifest.id}' installed successfully.`,
    };
  }

  /** Uninstall a plugin by its ID. */
  async uninstall(
    pluginId: string
  ): Promise<{ success: boolean; message: string }> {
    if (!(await this.registry.isInstalled(pluginId))) {
      return {
        success: false,
        message: `Plugin '${pluginId}' is not installed.`,
      };
    }

    this.manager.unregister(pluginId);
    await this.registry.markUninstalled(pluginId);

    return {
      success: true,
      message: `Plugin '${pluginId}' uninstalled successfully.`,
    };
  }

  /**
   * Restore all previously installed plugins from installed-plugins.json.
   * Called at startup to resume the last-known plugin state.
   */
  async restoreInstalled(): Promise<void> {
    const entries = await this.registry.loadInstalled();
    for (const entry of entries) {
      const service = new PluginService(entry.manifest);
      this.manager.register(service);
      console.log(`[PluginInstaller] Restored plugin: ${entry.id}`);
    }
  }
}
