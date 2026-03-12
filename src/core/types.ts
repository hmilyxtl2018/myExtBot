/**
 * Core types for the myExtBot digital avatar asset system.
 */

// ── Tool / Delegation types ────────────────────────────────────────────────

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, { type: string; description?: string; default?: unknown }>;
    required?: string[];
  };
}

export interface ToolCall {
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  success: boolean;
  output?: unknown;
  error?: string;
}

/**
 * A single delegation log entry representing one agent-to-agent tool invocation.
 */
export interface DelegationLogEntry {
  /** Unique entry ID */
  id: string;
  /** ISO 8601 timestamp when the delegation occurred */
  timestamp: string;
  /** The delegating agent */
  fromAgentId: string;
  /** The receiving agent */
  toAgentId: string;
  /** The tool that was invoked */
  toolName: string;
  /** The arguments passed to the tool */
  arguments: Record<string, unknown>;
  /** Whether the invocation succeeded */
  success: boolean;
  /** Error message if success === false */
  error?: string;
  /** Execution duration in milliseconds */
  durationMs?: number;
  /** Optional session ID for grouping related delegations */
  sessionId?: string;
}

// ── Lineage Graph types ────────────────────────────────────────────────────

/**
 * A single node in the lineage graph.
 */
export interface LineageNode {
  /** Unique node ID (based on agentId or toolName) */
  id: string;
  /** Node type */
  type: "agent" | "tool" | "external-api";
  /** Display label */
  label: string;
  /** Associated agent ID (if type === "agent") */
  agentId?: string;
  /** Associated tool name (if type === "tool") */
  toolName?: string;
  /** Whether the most recent execution succeeded */
  success: boolean;
  /** Execution duration in ms (if available) */
  durationMs?: number;
  /** ISO 8601 timestamp of the first occurrence */
  timestamp: string;
}

/**
 * A directed edge in the lineage graph.
 */
export interface LineageEdge {
  /** Unique edge ID */
  id: string;
  /** Source node ID */
  from: string;
  /** Target node ID */
  to: string;
  /** Optional label (e.g. "委托" / "调用" / "返回结果") */
  label?: string;
  /** Edge type */
  type: "delegation" | "tool-call" | "return";
}

/**
 * A complete lineage graph.
 */
export interface LineageGraph {
  /** Session ID (optional, used for grouping) */
  sessionId?: string;
  nodes: LineageNode[];
  edges: LineageEdge[];
  startedAt: string;
  endedAt?: string;
  /** Total node count */
  nodeCount: number;
  /** Total edge count */
  edgeCount: number;
  /** Overall success rate (successful tool nodes / total tool nodes) */
  successRate: number;
}

/**
 * Summary of a lineage graph (for the summary API endpoint).
 */
export interface LineageGraphSummary {
  totalNodes: number;
  totalEdges: number;
  agentNodes: string[];
  toolNodes: string[];
  successRate: number;
  timeRange: { earliest: string; latest: string };
}
