import { GuardrailsEnforcer, GuardrailsError, withGuardrails } from "../GuardrailsEnforcer";
import type { AgentSpecGuardrails } from "../types";
import type { ToolCall, ToolResult } from "../types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeToolCall(toolName: string, args: Record<string, unknown> | null = {}): ToolCall {
  return { toolName, arguments: args ?? {} };
}

function successResult(output: unknown = "ok", cost?: number): ToolResult {
  return { success: true, output, estimatedCost: cost };
}

function errorResult(error: string): ToolResult {
  return { success: false, error };
}

// ── Content filtering — filterInput ──────────────────────────────────────────

describe("GuardrailsEnforcer — filterInput", () => {
  const enforcer = new GuardrailsEnforcer();

  it("allows clean input with no banned patterns", () => {
    expect(() =>
      enforcer.filterInput("agent-1", makeToolCall("search", { query: "hello world" }))
    ).not.toThrow();
  });

  it("blocks SSN in tool arguments", () => {
    expect(() =>
      enforcer.filterInput("agent-1", makeToolCall("send_email", { body: "SSN: 123-45-6789" }))
    ).toThrow(GuardrailsError);
  });

  it("blocks credit card number in tool arguments", () => {
    expect(() =>
      enforcer.filterInput("agent-1", makeToolCall("pay", { card: "4111 1111 1111 1111" }))
    ).toThrow(GuardrailsError);
  });

  it("blocks AWS access key in tool arguments", () => {
    expect(() =>
      enforcer.filterInput("agent-1", makeToolCall("deploy", { key: "AKIAIOSFODNN7EXAMPLE" }))
    ).toThrow(GuardrailsError);
  });

  it("blocks generic secret/token pattern in tool arguments", () => {
    expect(() =>
      enforcer.filterInput(
        "agent-1",
        makeToolCall("configure", { config: "api_key: mysupersecret123" })
      )
    ).toThrow(GuardrailsError);
  });

  it("blocks custom banned pattern from AgentSpec guardrails", () => {
    const guardrails: AgentSpecGuardrails = { bannedPatterns: ["\\bFORBIDDEN\\b"] };
    expect(() =>
      enforcer.filterInput("agent-1", makeToolCall("search", { q: "FORBIDDEN word" }), guardrails)
    ).toThrow(GuardrailsError);
  });

  it("allows input that does not match custom banned pattern", () => {
    const guardrails: AgentSpecGuardrails = { bannedPatterns: ["\\bFORBIDDEN\\b"] };
    expect(() =>
      enforcer.filterInput("agent-1", makeToolCall("search", { q: "allowed word" }), guardrails)
    ).not.toThrow();
  });

  it("skips invalid custom regex patterns with a warning (no crash)", () => {
    const guardrails: AgentSpecGuardrails = { bannedPatterns: ["[invalid("] };
    // should not throw (invalid regex is skipped with console.warn)
    expect(() =>
      enforcer.filterInput("agent-1", makeToolCall("search", { q: "hello" }), guardrails)
    ).not.toThrow();
  });

  it("handles null/undefined arguments gracefully", () => {
    expect(() => enforcer.filterInput("agent-1", makeToolCall("noop", null))).not.toThrow();
  });
});

// ── Content filtering — filterOutput ─────────────────────────────────────────

describe("GuardrailsEnforcer — filterOutput", () => {
  const enforcer = new GuardrailsEnforcer();

  it("passes through clean output unchanged", () => {
    const result = successResult("here are some safe results");
    expect(enforcer.filterOutput("agent-1", result)).toEqual(result);
  });

  it("redacts output containing SSN and returns error result", () => {
    const result = successResult("User SSN is 987-65-4321");
    const filtered = enforcer.filterOutput("agent-1", result);
    expect(filtered.success).toBe(false);
    expect(filtered.error).toMatch(/banned content/i);
  });

  it("passes through a failed result without re-checking", () => {
    const result = errorResult("tool failure");
    expect(enforcer.filterOutput("agent-1", result)).toEqual(result);
  });

  it("redacts output matching custom banned pattern", () => {
    const guardrails: AgentSpecGuardrails = { bannedPatterns: ["\\bSECRET_WORD\\b"] };
    const result = successResult("The answer is SECRET_WORD");
    const filtered = enforcer.filterOutput("agent-1", result, guardrails);
    expect(filtered.success).toBe(false);
    expect(filtered.error).toMatch(/banned content/i);
  });
});

// ── Cost ceiling ──────────────────────────────────────────────────────────────

describe("GuardrailsEnforcer — cost ceiling", () => {
  it("allows execution when no maxCostPerTask is set", () => {
    const enforcer = new GuardrailsEnforcer();
    expect(enforcer.checkCostCeiling("agent-1", {})).toBeNull();
  });

  it("allows execution below the cost ceiling", () => {
    const enforcer = new GuardrailsEnforcer();
    enforcer.recordTaskCost("agent-1", 0.05);
    const guardrails: AgentSpecGuardrails = { maxCostPerTask: 0.10 };
    expect(enforcer.checkCostCeiling("agent-1", guardrails)).toBeNull();
  });

  it("halts execution when cost ceiling is reached", () => {
    const enforcer = new GuardrailsEnforcer();
    enforcer.recordTaskCost("agent-1", 0.10);
    const guardrails: AgentSpecGuardrails = { maxCostPerTask: 0.10 };
    const result = enforcer.checkCostCeiling("agent-1", guardrails);
    expect(result).not.toBeNull();
    expect(result!.success).toBe(false);
    expect(result!.error).toMatch(/cost ceiling exceeded/i);
  });

  it("halts execution when cost ceiling is exceeded", () => {
    const enforcer = new GuardrailsEnforcer();
    enforcer.recordTaskCost("agent-1", 0.15);
    const guardrails: AgentSpecGuardrails = { maxCostPerTask: 0.10 };
    const result = enforcer.checkCostCeiling("agent-1", guardrails);
    expect(result).not.toBeNull();
    expect(result!.success).toBe(false);
  });

  it("accumulates costs across multiple recordTaskCost calls", () => {
    const enforcer = new GuardrailsEnforcer();
    enforcer.recordTaskCost("agent-1", 0.04);
    enforcer.recordTaskCost("agent-1", 0.04);
    enforcer.recordTaskCost("agent-1", 0.04);
    expect(enforcer.getTaskCost("agent-1")).toBeCloseTo(0.12);
  });

  it("resets task cost when resetTaskCost is called", () => {
    const enforcer = new GuardrailsEnforcer();
    enforcer.recordTaskCost("agent-1", 0.10);
    enforcer.resetTaskCost("agent-1");
    expect(enforcer.getTaskCost("agent-1")).toBe(0);
  });

  it("isolates costs per agent", () => {
    const enforcer = new GuardrailsEnforcer();
    enforcer.recordTaskCost("agent-1", 0.10);
    expect(enforcer.getTaskCost("agent-2")).toBe(0);
  });
});

// ── Human-approval gate ───────────────────────────────────────────────────────

describe("GuardrailsEnforcer — human-approval gate", () => {
  it("does not require approval when guardrails are absent", () => {
    const enforcer = new GuardrailsEnforcer();
    const result = enforcer.checkApproval("agent-1", makeToolCall("search"), undefined);
    expect(result).toBeNull();
  });

  it("does not require approval when requireHumanApproval is false", () => {
    const enforcer = new GuardrailsEnforcer();
    const guardrails: AgentSpecGuardrails = { requireHumanApproval: false };
    const result = enforcer.checkApproval("agent-1", makeToolCall("search"), guardrails);
    expect(result).toBeNull();
  });

  it("returns a pending result when requireHumanApproval is true", () => {
    const enforcer = new GuardrailsEnforcer();
    const guardrails: AgentSpecGuardrails = { requireHumanApproval: true };
    const result = enforcer.checkApproval("agent-1", makeToolCall("delete_data"), guardrails);
    expect(result).not.toBeNull();
    expect(result!.success).toBe(false);
    expect(result!.error).toMatch(/requires human approval/i);
    expect((result!.output as { pendingApprovalId: string }).pendingApprovalId).toBeDefined();
  });

  it("returns a pending result when tool is in approvalRequiredTools", () => {
    const enforcer = new GuardrailsEnforcer();
    const guardrails: AgentSpecGuardrails = { approvalRequiredTools: ["delete_data", "deploy"] };
    const result = enforcer.checkApproval("agent-1", makeToolCall("delete_data"), guardrails);
    expect(result).not.toBeNull();
    expect(result!.success).toBe(false);
  });

  it("does not require approval for a tool NOT in approvalRequiredTools", () => {
    const enforcer = new GuardrailsEnforcer();
    const guardrails: AgentSpecGuardrails = { approvalRequiredTools: ["delete_data"] };
    const result = enforcer.checkApproval("agent-1", makeToolCall("search"), guardrails);
    expect(result).toBeNull();
  });

  it("approve() removes the pending approval and returns true", () => {
    const enforcer = new GuardrailsEnforcer();
    const guardrails: AgentSpecGuardrails = { requireHumanApproval: true };
    const pendingResult = enforcer.checkApproval("agent-1", makeToolCall("delete_data"), guardrails);
    const callId = (pendingResult!.output as { pendingApprovalId: string }).pendingApprovalId;
    const approved = enforcer.approve(callId);
    expect(approved).toBe(true);
    // After approval the pending entry is removed
    expect(enforcer.getPendingApprovals()).toHaveLength(0);
  });

  it("deny() removes the pending approval and returns true", () => {
    const enforcer = new GuardrailsEnforcer();
    const guardrails: AgentSpecGuardrails = { requireHumanApproval: true };
    const pendingResult = enforcer.checkApproval("agent-1", makeToolCall("delete_data"), guardrails);
    const callId = (pendingResult!.output as { pendingApprovalId: string }).pendingApprovalId;
    const denied = enforcer.deny(callId);
    expect(denied).toBe(true);
    expect(enforcer.getPendingApprovals()).toHaveLength(0);
  });

  it("approve() returns false for an unknown callId", () => {
    const enforcer = new GuardrailsEnforcer();
    expect(enforcer.approve("nonexistent-id")).toBe(false);
  });

  it("deny() returns false for an unknown callId", () => {
    const enforcer = new GuardrailsEnforcer();
    expect(enforcer.deny("nonexistent-id")).toBe(false);
  });
});

// ── withGuardrails middleware integration ─────────────────────────────────────

describe("withGuardrails — middleware wrapper", () => {
  it("passes clean input/output through to the execute function", async () => {
    const enforcer = new GuardrailsEnforcer();
    const execute = jest.fn().mockResolvedValue(successResult("clean output"));
    const result = await withGuardrails(
      enforcer,
      "agent-1",
      makeToolCall("search", { q: "hello" }),
      {},
      execute
    );
    expect(result.success).toBe(true);
    expect(result.output).toBe("clean output");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("blocks execution when input contains PII", async () => {
    const enforcer = new GuardrailsEnforcer();
    const execute = jest.fn();
    const result = await withGuardrails(
      enforcer,
      "agent-1",
      makeToolCall("search", { q: "SSN: 123-45-6789" }),
      {},
      execute
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/banned content/i);
    expect(execute).not.toHaveBeenCalled();
  });

  it("blocks execution when cost ceiling is exceeded", async () => {
    const enforcer = new GuardrailsEnforcer();
    enforcer.recordTaskCost("agent-1", 0.50);
    const guardrails: AgentSpecGuardrails = { maxCostPerTask: 0.30 };
    const execute = jest.fn();
    const result = await withGuardrails(
      enforcer,
      "agent-1",
      makeToolCall("search"),
      guardrails,
      execute
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/cost ceiling exceeded/i);
    expect(execute).not.toHaveBeenCalled();
  });

  it("blocks execution when tool requires approval", async () => {
    const enforcer = new GuardrailsEnforcer();
    const guardrails: AgentSpecGuardrails = { approvalRequiredTools: ["deploy"] };
    const execute = jest.fn();
    const result = await withGuardrails(
      enforcer,
      "agent-1",
      makeToolCall("deploy"),
      guardrails,
      execute
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/requires human approval/i);
    expect(execute).not.toHaveBeenCalled();
  });

  it("redacts output containing PII even when execute succeeds", async () => {
    const enforcer = new GuardrailsEnforcer();
    const execute = jest.fn().mockResolvedValue(successResult("Your SSN is 123-45-6789"));
    const result = await withGuardrails(
      enforcer,
      "agent-1",
      makeToolCall("lookup", { id: "user-1" }),
      {},
      execute
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/banned content/i);
  });

  it("accumulates task cost from estimatedCost in result", async () => {
    const enforcer = new GuardrailsEnforcer();
    const execute = jest.fn().mockResolvedValue(successResult("ok", 0.03));
    await withGuardrails(enforcer, "agent-1", makeToolCall("search"), {}, execute);
    expect(enforcer.getTaskCost("agent-1")).toBeCloseTo(0.03);
  });

  it("does not crash when execute returns a failed result", async () => {
    const enforcer = new GuardrailsEnforcer();
    const execute = jest.fn().mockResolvedValue(errorResult("service down"));
    const result = await withGuardrails(enforcer, "agent-1", makeToolCall("search"), {}, execute);
    expect(result.success).toBe(false);
    expect(result.error).toBe("service down");
  });
});
