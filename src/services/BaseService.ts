import { McpService, ToolCall, ToolDefinition, ToolResult } from "../core/types";

/**
 * Abstract base class for all MCP services.
 *
 * Concrete services should extend this class and implement
 * `getToolDefinitions()` and `execute()`.
 */
export abstract class BaseService implements McpService {
  /** Unique name identifying this service. */
  abstract readonly name: string;

  /** Whether this service is currently enabled (default: true). */
  enabled: boolean = true;

  /**
   * Fallback service name used when this service is unhealthy.
   * When set, McpServiceListManager.dispatch() automatically routes to this
   * service when the primary is "down" or "rate-limited".
   */
  fallbackServiceName?: string;

  /**
   * Returns the list of tool definitions this service provides.
   */
  abstract getToolDefinitions(): ToolDefinition[];

  /**
   * Executes a tool call routed to this service.
   */
  abstract execute(call: ToolCall): Promise<ToolResult>;
}
