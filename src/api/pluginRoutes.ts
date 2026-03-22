import { Router, Request, Response } from "express";
import { McpServiceListManager } from "../core/McpServiceListManager";
import { PluginInstaller } from "../marketplace/PluginInstaller";
import { PluginRegistry } from "../marketplace/PluginRegistry";
import { PluginManifest, PluginSummary } from "../types";

/**
 * createPluginRoutes — builds an Express Router with all plugin marketplace
 * REST endpoints.
 *
 * Endpoints:
 *   GET    /api/plugins              — list all marketplace plugins (with install status)
 *   GET    /api/plugins/installed    — list only installed plugins
 *   GET    /api/plugins/:id          — get a single plugin detail
 *   POST   /api/plugins/:id/install  — install a plugin
 *   DELETE /api/plugins/:id/uninstall — uninstall a plugin
 */

/**
 * @openapi
 * components:
 *   schemas:
 *     PluginSummary:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *         name:
 *           type: string
 *         version:
 *           type: string
 *         author:
 *           type: string
 *         description:
 *           type: string
 *         category:
 *           type: string
 *         installed:
 *           type: boolean
 *         installedAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         tools:
 *           type: array
 *           items:
 *             type: object
 */
export function createPluginRoutes(
  _manager: McpServiceListManager,
  installer: PluginInstaller,
  registry: PluginRegistry
): Router {
  const router = Router();

  /** Build a PluginSummary from a manifest, enriched with installation status. */
  async function toSummary(
    manifest: PluginManifest,
    installedEntries: Awaited<ReturnType<PluginRegistry["loadInstalled"]>>
  ): Promise<PluginSummary> {
    const entry = installedEntries.find((e) => e.id === manifest.id);
    return {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      author: manifest.author,
      description: manifest.description,
      category: manifest.category,
      registryUrl: manifest.registryUrl,
      homepage: manifest.homepage,
      installed: !!entry,
      installedAt: entry?.installedAt,
      tools: manifest.tools,
    };
  }

  /**
   * @openapi
   * /api/plugins:
   *   get:
   *     tags: [Plugins]
   *     summary: List all marketplace plugins with installation status
   *     responses:
   *       200:
   *         description: Array of plugin summaries
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 $ref: '#/components/schemas/PluginSummary'
   *       500:
   *         description: Internal error
   */
  /**
   * GET /api/plugins
   * Returns all marketplace plugins with their installation status.
   */
  router.get("/", async (_req: Request, res: Response) => {
    try {
      const [marketplace, installed] = await Promise.all([
        registry.loadMarketplace(),
        registry.loadInstalled(),
      ]);
      const summaries = await Promise.all(
        marketplace.map((m) => toSummary(m, installed))
      );
      res.json(summaries);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Internal error";
      res.status(500).json({ error: message });
    }
  });

  /**
   * @openapi
   * /api/plugins/installed:
   *   get:
   *     tags: [Plugins]
   *     summary: List only installed plugins
   *     responses:
   *       200:
   *         description: Array of installed plugin summaries
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 $ref: '#/components/schemas/PluginSummary'
   *       500:
   *         description: Internal error
   */
  /**
   * GET /api/plugins/installed
   * Returns only the currently installed plugins.
   */
  router.get("/installed", async (_req: Request, res: Response) => {
    try {
      const installed = await registry.loadInstalled();
      const summaries = await Promise.all(
        installed.map((e) => toSummary(e.manifest, installed))
      );
      res.json(summaries);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Internal error";
      res.status(500).json({ error: message });
    }
  });

  /**
   * @openapi
   * /api/plugins/{id}:
   *   get:
   *     tags: [Plugins]
   *     summary: Get details for a single plugin
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Plugin summary
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/PluginSummary'
   *       404:
   *         description: Plugin not found
   *       500:
   *         description: Internal error
   */
  /**
   * GET /api/plugins/:id
   * Returns details for a single plugin (marketplace or installed).
   */
  router.get("/:id", async (req: Request, res: Response) => {
    try {
      const id = req.params["id"] as string;
      const [marketplace, installed] = await Promise.all([
        registry.loadMarketplace(),
        registry.loadInstalled(),
      ]);

      const manifest =
        marketplace.find((m) => m.id === id) ??
        installed.find((e) => e.id === id)?.manifest;

      if (!manifest) {
        res.status(404).json({ error: `Plugin '${id}' not found.` });
        return;
      }

      const summary = await toSummary(manifest, installed);
      res.json(summary);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Internal error";
      res.status(500).json({ error: message });
    }
  });

  /**
   * @openapi
   * /api/plugins/{id}/install:
   *   post:
   *     tags: [Plugins]
   *     summary: Install a plugin by ID
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Plugin installed successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 plugin:
   *                   $ref: '#/components/schemas/PluginSummary'
   *       404:
   *         description: Plugin not found
   *       500:
   *         description: Internal error
   */
  /**
   * POST /api/plugins/:id/install
   * Installs the plugin with the given ID.
   */
  router.post("/:id/install", async (req: Request, res: Response) => {
    try {
      const id = req.params["id"] as string;
      const result = await installer.install(id);

      if (!result.success) {
        res.status(404).json(result);
        return;
      }

      const [marketplace, installed] = await Promise.all([
        registry.loadMarketplace(),
        registry.loadInstalled(),
      ]);
      const manifest = marketplace.find((m) => m.id === id) ??
        installed.find((e) => e.id === id)?.manifest;

      const plugin = manifest
        ? await toSummary(manifest, installed)
        : undefined;

      res.json({ ...result, plugin });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Internal error";
      res.status(500).json({ error: message });
    }
  });

  /**
   * @openapi
   * /api/plugins/{id}/uninstall:
   *   delete:
   *     tags: [Plugins]
   *     summary: Uninstall a plugin by ID
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Plugin uninstalled successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *       404:
   *         description: Plugin not installed
   *       500:
   *         description: Internal error
   */
  /**
   * DELETE /api/plugins/:id/uninstall
   * Uninstalls the plugin with the given ID.
   */
  router.delete("/:id/uninstall", async (req: Request, res: Response) => {
    try {
      const id = req.params["id"] as string;
      const result = await installer.uninstall(id);

      if (!result.success) {
        res.status(404).json(result);
        return;
      }

      res.json(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Internal error";
      res.status(500).json({ error: message });
    }
  });

  return router;
}
