import { ToolDefinition, ToolCall, ToolResult } from "../types";

/**
 * BaseService — abstract base class for all MCP services.
 *
 * Every service must declare a unique `name` and implement
 * `getToolDefinitions()` and `execute()`.
 */
export abstract class BaseService {
  abstract readonly name: string;

  /** Returns the list of tools this service exposes. */
  abstract getToolDefinitions(): ToolDefinition[];

  /** Executes a tool call and returns the result. */
  abstract execute(call: ToolCall): Promise<ToolResult>;
}
