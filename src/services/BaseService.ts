/**
 * src/services/BaseService.ts
 *
 * Abstract base class for all MCP Services.
 */

import { McpService, ServiceResult } from "../core/types";

export abstract class BaseService implements McpService {
  abstract readonly name: string;
  abstract readonly description: string;

  /**
   * Fallback service name used when this service is unhealthy.
   * When set, McpServiceListManager.dispatch() automatically routes to this
   * service when the primary is "down" or "rate-limited".
   * Example: PerplexityService.fallbackServiceName = "SearchService"
   */
  fallbackServiceName?: string;

  abstract execute(payload: unknown): Promise<ServiceResult>;
}
