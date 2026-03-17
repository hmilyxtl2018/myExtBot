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
