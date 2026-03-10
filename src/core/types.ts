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

// ── Scene ───────────────────────────────────────────────────────────────────

/**
 * A Scene groups one or more services by use-case (e.g. "Research", "Productivity").
 * Scenes make it easy to present the LLM with only the tools relevant to the
 * current user intent, reducing prompt noise and improving tool selection accuracy.
 */
export interface Scene {
  /** Unique identifier for this scene (e.g. "research"). */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** Optional description of when to use this scene. */
  description?: string;
  /**
   * Names of the McpServices that belong to this scene.
   * Only enabled services in this list will expose their tools when the scene is active.
   */
  serviceNames: string[];
}

// ── Agent ───────────────────────────────────────────────────────────────────

/**
 * An AgentProfile defines a named LLM persona with a specific, restricted set
 * of tools.  When the LLM operates as a particular agent only the tools allowed
 * by that agent's profile are exposed, providing access-control and focus.
 *
 * An agent may optionally be scoped to a scene; if so, it further restricts the
 * scene's tool set to the services listed in `allowedServices`.
 */
export interface AgentProfile {
  /** Unique identifier for this agent (e.g. "research-bot"). */
  id: string;
  /** Human-readable display name (e.g. "Research Bot"). */
  name: string;
  /** Optional description of the agent's purpose or persona. */
  description?: string;
  /**
   * Optional scene this agent is associated with.
   * When set, the agent inherits the scene's service list as a starting point.
   */
  sceneId?: string;
  /**
   * Explicit list of service names this agent is allowed to use.
   * If omitted (and no sceneId is given), the agent can use all enabled services.
   * If both `sceneId` and `allowedServices` are provided, `allowedServices` takes
   * precedence (use it to further restrict a scene's service set).
   */
  allowedServices?: string[];
}

/**
 * Summary row returned by `McpServiceListManager.listAgents()`.
 */
export interface AgentSummary {
  id: string;
  name: string;
  description?: string;
  sceneId?: string;
  allowedServices?: string[];
  toolCount: number;
}

/**
 * Summary row returned by `McpServiceListManager.listScenes()`.
 */
export interface SceneSummary {
  id: string;
  name: string;
  description?: string;
  serviceNames: string[];
  toolCount: number;
}
