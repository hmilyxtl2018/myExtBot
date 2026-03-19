/**
 * Re-exports the canonical PluginService from src/services/PluginService.ts.
 *
 * The authoritative implementation lives in `../services/PluginService`.
 * This file exists only for backward-compatibility with imports that reference
 * `src/marketplace/PluginService`.
 */
export { PluginService } from "../services/PluginService";
