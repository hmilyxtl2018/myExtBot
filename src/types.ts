/**
 * Type definitions mirroring the Rust AgentState enum and IPC event payloads.
 */

export type AgentState =
  | "idle"
  | "thinking"
  | "waiting_approval"
  | "running_tool"
  | "completed"
  | "failed";

export interface StateChangedPayload {
  state: AgentState;
}

export interface MessagePayload {
  role: "user" | "assistant" | "tool";
  content: string;
}

export interface ApprovalRequestedPayload {
  tool_name: string;
  args: Record<string, unknown>;
}

export interface ChatMessage {
  id: number;
  role: MessagePayload["role"];
  content: string;
 * Shared type definitions for myExtBot.
 */

/** A single parameter property definition for a tool. */
export interface ToolParameterProperty {
  type: string;
  description: string;
  default?: string | number | boolean;
  enum?: string[];
}

/** JSON Schema-style parameters definition for a tool. */
export interface ToolParameters {
  type: "object";
  properties: Record<string, ToolParameterProperty>;
  required?: string[];
}

/** Definition of a single tool exposed by a service. */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameters;
}

/** A tool call request from a caller. */
export interface ToolCall {
  toolName: string;
  parameters: Record<string, unknown>;
}

/** Result returned by a tool execution. */
export interface ToolResult {
  success: boolean;
  output: unknown;
  error?: string;
}

/** Manifest for a plugin in the marketplace. */
export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  category: string;
  registryUrl: string;
  homepage?: string;
  /** Optional HTTP endpoint to forward tool calls to. */
  executeEndpoint?: string;
  tools: ToolDefinition[];
}

/** A persisted record of an installed plugin. */
export interface PluginEntry {
  id: string;
  name: string;
  version: string;
  installedAt: string;
  manifest: PluginManifest;
}

/** Summary of a plugin for API responses (includes installation status). */
export interface PluginSummary {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  category: string;
  registryUrl: string;
  homepage?: string;
  installed: boolean;
  installedAt?: string;
  tools: ToolDefinition[];
}
