import * as fs from "fs";
import * as path from "path";
import { PluginEntry, PluginManifest } from "../types";

/**
 * PluginRegistry — manages local installation state.
 *
 * Persistence file: data/installed-plugins.json (relative to project root).
 * Override the data directory via the MYEXTBOT_DATA_DIR environment variable.
 */
export class PluginRegistry {
  private readonly dataDir: string;
  private readonly installedFile: string;
  private readonly marketplaceFile: string;

  constructor(dataDir?: string) {
    this.dataDir =
      dataDir ??
      process.env.MYEXTBOT_DATA_DIR ??
      path.resolve(__dirname, "../../data");
    this.installedFile = path.join(this.dataDir, "installed-plugins.json");
    this.marketplaceFile = path.join(this.dataDir, "marketplace-index.json");
  }

  /** Load the persisted list of installed plugins. */
  async loadInstalled(): Promise<PluginEntry[]> {
    try {
      if (!fs.existsSync(this.installedFile)) {
        return [];
      }
      const raw = await fs.promises.readFile(this.installedFile, "utf-8");
      return JSON.parse(raw) as PluginEntry[];
    } catch {
      return [];
    }
  }

  /** Write the installed plugins list to the persistence file. */
  async saveInstalled(entries: PluginEntry[]): Promise<void> {
    await fs.promises.mkdir(this.dataDir, { recursive: true });
    await fs.promises.writeFile(
      this.installedFile,
      JSON.stringify(entries, null, 2),
      "utf-8"
    );
  }

  /** Mark a plugin as installed (append to or update persistence file). */
  async markInstalled(manifest: PluginManifest): Promise<void> {
    const entries = await this.loadInstalled();
    const existing = entries.findIndex((e) => e.id === manifest.id);
    const entry: PluginEntry = {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      installedAt: new Date().toISOString(),
      manifest,
    };
    if (existing >= 0) {
      entries[existing] = entry;
    } else {
      entries.push(entry);
    }
    await this.saveInstalled(entries);
  }

  /** Mark a plugin as uninstalled (remove from persistence file). */
  async markUninstalled(pluginId: string): Promise<void> {
    const entries = await this.loadInstalled();
    const filtered = entries.filter((e) => e.id !== pluginId);
    await this.saveInstalled(filtered);
  }

  /** Check whether a plugin is currently installed. */
  async isInstalled(pluginId: string): Promise<boolean> {
    const entries = await this.loadInstalled();
    return entries.some((e) => e.id === pluginId);
  }

  /** Load the marketplace catalogue from marketplace-index.json. */
  async loadMarketplace(): Promise<PluginManifest[]> {
    try {
      if (!fs.existsSync(this.marketplaceFile)) {
        return [];
      }
      const raw = await fs.promises.readFile(this.marketplaceFile, "utf-8");
      return JSON.parse(raw) as PluginManifest[];
    } catch {
      return [];
    }
  }
}
