import { AgentProfile, AgentSpecGuardrails, ToolCall, ToolResult } from "./types";

// ── Built-in PII / secret patterns ───────────────────────────────────────────

/** Default patterns that are always checked (PII + common secrets). */
const BUILT_IN_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: "SSN", pattern: /\b\d{3}-\d{2}-\d{4}\b/ },
  { name: "credit-card", pattern: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/ },
  { name: "aws-key", pattern: /AKIA[0-9A-Z]{16}/ },
  { name: "generic-secret", pattern: /(?:secret|token|api[_-]?key)\s*[:=]\s*\S+/i },
];

// ── Pending approval record ───────────────────────────────────────────────────

export interface PendingApproval {
  callId: string;
  agentId: string;
  toolName: string;
}

// ── GuardrailsEnforcer ────────────────────────────────────────────────────────

/**
 * GuardrailsEnforcer — application-level middleware that enforces content
 * filtering, per-agent cost ceilings, and human-approval gates before every
 * tool dispatch.
 *
 * Run order (inside dispatchAs / delegateAs):
 *   1. filterInput()     — block banned patterns in tool arguments
 *   2. checkCostCeiling() — halt if maxCostPerTask exceeded
 *   3. checkApproval()   — gate on human approval when required
 *   4. <execute tool>
 *   5. filterOutput()    — block banned patterns in tool result
 */
export class GuardrailsEnforcer {
  /** agentId → cumulative task cost (reset is the caller's responsibility) */
  private taskCosts = new Map<string, number>();

  /** callId → pending approval record */
  private pendingApprovals = new Map<string, PendingApproval>();

  constructor() {}

  // ── Content filtering ─────────────────────────────────────────────────────

  /**
   * Scan tool call arguments for banned patterns.
   * Throws a `GuardrailsError` if a match is found.
   */
  filterInput(_agentId: string, toolCall: ToolCall, guardrails?: AgentSpecGuardrails): void {
    const text = this.serializeArgs(toolCall.arguments);
    this.scanText(text, guardrails?.bannedPatterns, `input for tool "${toolCall.toolName}"`);
  }

  /**
   * Scan tool result output for banned patterns.
   * Returns a sanitised copy of the result (output replaced with error message) if
   * a pattern is found, rather than throwing — we prefer to redact output rather
   * than lose the success/failure signal.
   */
  filterOutput(_agentId: string, result: ToolResult, guardrails?: AgentSpecGuardrails): ToolResult {
    if (!result.success || result.output === undefined || result.output === null) {
      return result;
    }
    const text = typeof result.output === "string" ? result.output : JSON.stringify(result.output);
    try {
      this.scanText(text, guardrails?.bannedPatterns, "output");
    } catch (err) {
      return {
        success: false,
        error: (err as Error).message,
      };
    }
    return result;
  }

  // ── Cost ceiling ──────────────────────────────────────────────────────────

  /**
   * Check whether the agent has exceeded its per-task cost ceiling.
   * Returns a `ToolResult` error if the ceiling is exceeded, otherwise `null`.
   */
  checkCostCeiling(agentId: string, guardrails?: AgentSpecGuardrails): ToolResult | null {
    if (guardrails?.maxCostPerTask === undefined) return null;

    const accumulated = this.getTaskCost(agentId);
    if (accumulated >= guardrails.maxCostPerTask) {
      return {
        success: false,
        error: `[GuardrailsEnforcer] Per-task cost ceiling exceeded for agent "${agentId}": accumulated $${accumulated.toFixed(4)} >= maxCostPerTask $${guardrails.maxCostPerTask}`,
      };
    }
    return null;
  }

  /**
   * Add cost to the per-task accumulator for an agent.
   * Called after a successful tool execution.
   */
  recordTaskCost(agentId: string, cost: number): void {
    const current = this.taskCosts.get(agentId) ?? 0;
    this.taskCosts.set(agentId, current + cost);
  }

  /** Reset the per-task cost accumulator for an agent (e.g. at task boundary). */
  resetTaskCost(agentId: string): void {
    this.taskCosts.delete(agentId);
  }

  /** Get current accumulated task cost for an agent. */
  getTaskCost(agentId: string): number {
    return this.taskCosts.get(agentId) ?? 0;
  }

  // ── Human-approval gate ───────────────────────────────────────────────────

  /**
   * Check whether the tool call requires human approval.
   *
   * Returns a `ToolResult` with `output.pendingApprovalId` if approval is needed.
   * The caller should surface this to the user and retry after calling `approve(callId)`.
   * Returns `null` if no approval is needed.
   */
  checkApproval(
    agentId: string,
    toolCall: ToolCall,
    guardrails?: AgentSpecGuardrails
  ): ToolResult | null {
    const needsApproval = this.requiresApproval(toolCall.toolName, guardrails);
    if (!needsApproval) return null;

    const callId = `${agentId}:${toolCall.toolName}:${Date.now()}`;
    const pending: PendingApproval = { callId, agentId, toolName: toolCall.toolName };
    this.pendingApprovals.set(callId, pending);

    return {
      success: false,
      error: `[GuardrailsEnforcer] Tool "${toolCall.toolName}" requires human approval (callId: ${callId})`,
      output: { pendingApprovalId: callId },
    };
  }

  /** Approve a pending tool call by its callId, removing it from the pending map. */
  approve(callId: string): boolean {
    if (!this.pendingApprovals.has(callId)) return false;
    this.pendingApprovals.delete(callId);
    return true;
  }

  /** Deny a pending tool call by its callId, removing it from the pending map. */
  deny(callId: string): boolean {
    if (!this.pendingApprovals.has(callId)) return false;
    this.pendingApprovals.delete(callId);
    return true;
  }

  /** Returns all currently pending approval records. */
  getPendingApprovals(): PendingApproval[] {
    return [...this.pendingApprovals.values()];
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Determine if the given tool name requires human approval. */
  requiresApproval(toolName: string, guardrails?: AgentSpecGuardrails): boolean {
    if (!guardrails) return false;
    if (guardrails.requireHumanApproval === true) return true;
    if (guardrails.approvalRequiredTools && guardrails.approvalRequiredTools.includes(toolName)) {
      return true;
    }
    return false;
  }

  /** Extract guardrails from an AgentProfile (uses AgentSpec guardrails field). */
  getGuardrails(agent: AgentProfile): AgentSpecGuardrails | undefined {
    return (agent as { guardrails?: AgentSpecGuardrails }).guardrails;
  }

  private serializeArgs(args: unknown): string {
    if (args === null || args === undefined) return "";
    if (typeof args === "string") return args;
    try {
      return JSON.stringify(args);
    } catch {
      return String(args);
    }
  }

  private scanText(text: string, customPatterns: string[] | undefined, location: string): void {
    // Check built-in patterns
    for (const { name, pattern } of BUILT_IN_PATTERNS) {
      if (pattern.test(text)) {
        throw new GuardrailsError(
          `[GuardrailsEnforcer] Banned content detected in ${location}: matched built-in pattern "${name}"`
        );
      }
    }

    // Check custom patterns from AgentSpec
    if (customPatterns) {
      for (const patternStr of customPatterns) {
        let re: RegExp;
        try {
          re = new RegExp(patternStr);
        } catch {
          // Skip invalid patterns rather than crashing
          console.warn(`[GuardrailsEnforcer] Invalid bannedPattern regex: "${patternStr}"`);
          continue;
        }
        if (re.test(text)) {
          throw new GuardrailsError(
            `[GuardrailsEnforcer] Banned content detected in ${location}: matched custom pattern "${patternStr}"`
          );
        }
      }
    }
  }
}

// ── GuardrailsError ───────────────────────────────────────────────────────────

export class GuardrailsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuardrailsError";
  }
}

// ── withGuardrails middleware wrapper ─────────────────────────────────────────

/**
 * Wraps an execute function with full guardrail checks:
 *   1. filterInput
 *   2. checkCostCeiling
 *   3. checkApproval
 *   4. execute
 *   5. filterOutput + recordTaskCost
 *
 * @param enforcer   - The GuardrailsEnforcer instance.
 * @param agentId    - The agent performing the call.
 * @param toolCall   - The tool call to guard.
 * @param guardrails - The agent's guardrail config (from AgentSpec).
 * @param execute    - The function that performs the actual tool call.
 */
export async function withGuardrails(
  enforcer: GuardrailsEnforcer,
  agentId: string,
  toolCall: ToolCall,
  guardrails: AgentSpecGuardrails | undefined,
  execute: () => Promise<ToolResult>
): Promise<ToolResult> {
  // 1. Filter input
  try {
    enforcer.filterInput(agentId, toolCall, guardrails);
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }

  // 2. Cost ceiling check
  const costError = enforcer.checkCostCeiling(agentId, guardrails);
  if (costError) return costError;

  // 3. Human-approval gate
  const approvalResult = enforcer.checkApproval(agentId, toolCall, guardrails);
  if (approvalResult) return approvalResult;

  // 4. Execute
  const result = await execute();

  // 5. Filter output + track cost
  const filtered = enforcer.filterOutput(agentId, result, guardrails);
  if (filtered.success && filtered.estimatedCost !== undefined) {
    enforcer.recordTaskCost(agentId, filtered.estimatedCost);
  }
  return filtered;
}
