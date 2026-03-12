// ─────────────────────────────────────────────────────────────────────────────
// Core types for myExtBot digital-avatar asset system
// ─────────────────────────────────────────────────────────────────────────────

// ── Agent & Service types ────────────────────────────────────────────────────

export interface ToolDefinition {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export interface ServiceResult {
  success: boolean;
  output?: unknown;
  error?: string;
}

export interface McpService {
  id: string;
  name: string;
  tools: ToolDefinition[];
  call(toolName: string, args: Record<string, unknown>): Promise<ServiceResult>;
}

export interface AgentProfile {
  id: string;
  name: string;
  description?: string;
  /** IDs of services this agent is allowed to use */
  allowedServices?: string[];
  /** IDs of agents this agent can delegate tasks to ('*' means all) */
  canDelegateTo?: string[];
  /** System prompt injected when the agent drives an LLM */
  systemPrompt?: string;
  /** Intent tags used for automatic routing */
  intents?: string[];
}

// ── Delegation types ─────────────────────────────────────────────────────────

export interface DelegationRequest {
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface DelegationLog {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  result?: ServiceResult;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
}

// ── Pipeline types (M3) ──────────────────────────────────────────────────────

/**
 * A single execution step within a Pipeline.
 */
export interface PipelineStep {
  /** ID of the agent that will execute this step */
  agentId: string;
  /** Name of the tool to invoke */
  toolName: string;
  /**
   * Parameter mapping for the tool call:
   * - string value: literal — passed directly to the tool
   * - { fromStep: number; outputPath: string }: reference to the output of
   *   step N (0-indexed).  outputPath supports dot-notation, e.g.
   *   "results[0].url" or "answer".
   */
  inputMapping?: Record<string, string | { fromStep: number; outputPath: string }>;
  /** Human-readable description of this step (optional) */
  description?: string;
}

/**
 * Definition of an Agent Pipeline — an ordered list of steps executed
 * sequentially, with context passed between steps via inputMapping.
 */
export interface AgentPipeline {
  /** Unique identifier */
  id: string;
  /** Display name */
  name: string;
  /** Optional description */
  description?: string;
  /** Ordered list of steps to execute */
  steps: PipelineStep[];
}

/**
 * The result of a single Pipeline execution run.
 */
export interface PipelineRunResult {
  pipelineId: string;
  startedAt: string;
  completedAt: string;
  success: boolean;
  /** Per-step results, aligned with the steps array */
  stepResults: Array<{
    stepIndex: number;
    agentId: string;
    toolName: string;
    success: boolean;
    output?: unknown;
    error?: string;
    durationMs: number;
  }>;
  /** Output of the last step (treated as the pipeline's overall output) */
  finalOutput?: unknown;
  /** Index of the first step that failed (set only when success is false) */
  failedAtStep?: number;
  error?: string;
}
