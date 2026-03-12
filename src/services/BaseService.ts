import { ToolCall, ToolDefinition, ToolResult } from "../core/types";

/**
 * Base class for all tool services.
 */
export abstract class BaseService {
  abstract readonly name: string;

  abstract getToolDefinitions(): ToolDefinition[];

  abstract execute(call: ToolCall): Promise<ToolResult>;
}
