import { ToolCall, ToolDefinition, ToolResult } from "../core/types";

/**
 * Base class for all tool services.
import { ToolDefinition, ToolCall, ToolResult } from "../types";

/**
 * BaseService — abstract base class for all MCP services.
 *
 * Every service must declare a unique `name` and implement
 * `getToolDefinitions()` and `execute()`.
 */
export abstract class BaseService {
  abstract readonly name: string;

  abstract getToolDefinitions(): ToolDefinition[];

  /** Returns the list of tools this service exposes. */
  abstract getToolDefinitions(): ToolDefinition[];

  /** Executes a tool call and returns the result. */
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
   * Returns the list of tool definitions this service provides.
   * Implementations should describe each tool's name, description,
   * and JSON Schema-compatible parameters.
   */
  abstract getToolDefinitions(): ToolDefinition[];

  /**
   * Executes a tool call routed to this service.
   * @param call - The tool invocation request from the LLM.
   * @returns A promise resolving to the result of the tool execution.
   */
  abstract execute(call: ToolCall): Promise<ToolResult>;
}
