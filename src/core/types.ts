/**
 * Shared interfaces and types for the MCP Services List Manager.
 */

/**
 * JSON Schema-compatible parameter property definition.
 */
export interface ParameterProperty {
  type: string;
  description: string;
  enum?: string[];
  default?: unknown;
}

/**
 * JSON Schema-compatible parameters object for a tool.
 */
export interface ToolParameters {
  type: "object";
  properties: Record<string, ParameterProperty>;
  required?: string[];
}

/**
 * Defines a tool that the LLM can call, compatible with OpenAI Function Calling
 * and the MCP protocol.
 */
export interface ToolDefinition {
  /** Unique name of the tool (e.g. "search_web"). */
  name: string;
  /** Human-readable description of what the tool does. */
  description: string;
  /** JSON Schema describing the tool's input parameters. */
  parameters: ToolParameters;
}

/**
 * Represents a tool invocation request coming from the LLM.
 */
export interface ToolCall {
  /** The name of the tool to invoke (must match a registered ToolDefinition name). */
  toolName: string;
  /** Key-value arguments passed to the tool, matching the tool's parameter schema. */
  arguments: Record<string, unknown>;
}

/**
 * The result returned after executing a tool call.
 */
export interface ToolResult {
  /** Whether the tool executed successfully. */
  success: boolean;
  /** The output produced by the tool on success. */
  output?: unknown;
  /** Error message if the tool execution failed. */
  error?: string;
}

/**
 * Interface that every MCP service must implement.
 * A service groups one or more related tools under a single unit of management.
 */
export interface McpService {
  /** Unique name identifying this service (e.g. "SearchService"). */
  readonly name: string;
  /** Whether this service is currently enabled and its tools are available to the LLM. */
  enabled: boolean;
  /**
   * Returns all tool definitions provided by this service.
   * These definitions are forwarded to the LLM so it knows what tools it can call.
   */
  getToolDefinitions(): ToolDefinition[];
  /**
   * Executes a tool call routed to this service.
   * @param call - The tool invocation request from the LLM.
   * @returns A promise resolving to the result of the tool execution.
   */
  execute(call: ToolCall): Promise<ToolResult>;
}
