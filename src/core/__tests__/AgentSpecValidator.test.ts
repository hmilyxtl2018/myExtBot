import { validateAgentSpec, VALID_CONTROL_LOOP_TYPES } from "../AgentSpecValidator";

// ── Helper ─────────────────────────────────────────────────────────────────────

/** Minimal valid spec that satisfies all required fields. */
function minimalSpec(): Record<string, unknown> {
  return { id: "bot-1", name: "Bot One" };
}

// ── Top-level shape ────────────────────────────────────────────────────────────

describe("validateAgentSpec — top-level shape", () => {
  it("returns invalid for null", () => {
    const r = validateAgentSpec(null);
    expect(r.valid).toBe(false);
    expect(r.errors).toContain("AgentSpec must be a non-null object");
  });

  it("returns invalid for undefined", () => {
    const r = validateAgentSpec(undefined);
    expect(r.valid).toBe(false);
  });

  it("returns invalid for a non-object primitive", () => {
    const r = validateAgentSpec("not-an-object");
    expect(r.valid).toBe(false);
  });

  it("returns valid for a minimal spec with id and name", () => {
    const r = validateAgentSpec(minimalSpec());
    expect(r.valid).toBe(true);
    expect(r.errors).toHaveLength(0);
  });
});

// ── Pillar 1 — Identity ────────────────────────────────────────────────────────

describe("Pillar 1 — Identity", () => {
  it("rejects missing id", () => {
    const r = validateAgentSpec({ name: "Bot" });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("id"))).toBe(true);
  });

  it("rejects empty id", () => {
    const r = validateAgentSpec({ id: "  ", name: "Bot" });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("id"))).toBe(true);
  });

  it("rejects non-string id", () => {
    const r = validateAgentSpec({ id: 42, name: "Bot" });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("id"))).toBe(true);
  });

  it("rejects missing name", () => {
    const r = validateAgentSpec({ id: "bot-1" });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("name"))).toBe(true);
  });

  it("rejects empty name", () => {
    const r = validateAgentSpec({ id: "bot-1", name: "" });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("name"))).toBe(true);
  });

  it("accepts a non-empty version string", () => {
    const r = validateAgentSpec({ ...minimalSpec(), version: "1.2.3" });
    expect(r.valid).toBe(true);
  });

  it("rejects an empty version string", () => {
    const r = validateAgentSpec({ ...minimalSpec(), version: "" });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("version"))).toBe(true);
  });

  it("rejects a non-string version", () => {
    const r = validateAgentSpec({ ...minimalSpec(), version: 123 });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("version"))).toBe(true);
  });
});

// ── Pillar 2 — Control Loop ────────────────────────────────────────────────────

describe("Pillar 2 — Control Loop", () => {
  it.each(VALID_CONTROL_LOOP_TYPES)(
    "accepts controlLoop.type = '%s'",
    (type) => {
      const r = validateAgentSpec({ ...minimalSpec(), controlLoop: { type } });
      expect(r.valid).toBe(true);
    }
  );

  it("rejects an unknown controlLoop.type", () => {
    const r = validateAgentSpec({ ...minimalSpec(), controlLoop: { type: "unknown-mode" } });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("controlLoop.type"))).toBe(true);
  });

  it("rejects a non-object controlLoop", () => {
    const r = validateAgentSpec({ ...minimalSpec(), controlLoop: "react" });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("controlLoop"))).toBe(true);
  });

  it("is optional — no error when absent", () => {
    const r = validateAgentSpec(minimalSpec());
    expect(r.errors.some((e) => e.includes("Pillar 2"))).toBe(false);
  });
});

// ── Pillar 3 — Tools ──────────────────────────────────────────────────────────

describe("Pillar 3 — Tools", () => {
  it("accepts an empty tools array", () => {
    const r = validateAgentSpec({ ...minimalSpec(), tools: [] });
    expect(r.valid).toBe(true);
  });

  it("accepts tools with valid names", () => {
    const r = validateAgentSpec({
      ...minimalSpec(),
      tools: [{ name: "search" }, { name: "summarize" }],
    });
    expect(r.valid).toBe(true);
  });

  it("rejects a non-array tools value", () => {
    const r = validateAgentSpec({ ...minimalSpec(), tools: "search" });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("Pillar 3"))).toBe(true);
  });

  it("rejects a tool with an empty name", () => {
    const r = validateAgentSpec({ ...minimalSpec(), tools: [{ name: "" }] });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("tools[0].name"))).toBe(true);
  });

  it("rejects a tool that is not an object", () => {
    const r = validateAgentSpec({ ...minimalSpec(), tools: ["not-an-object"] });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("tools[0]"))).toBe(true);
  });
});

// ── Pillar 4 — Guardrails ──────────────────────────────────────────────────────

describe("Pillar 4 — Guardrails", () => {
  it("accepts valid guardrails", () => {
    const r = validateAgentSpec({
      ...minimalSpec(),
      guardrails: { maxTokensPerCall: 1000, maxCostPerCall: 0.5, requireHumanApproval: false },
    });
    expect(r.valid).toBe(true);
  });

  it("rejects maxTokensPerCall of 0", () => {
    const r = validateAgentSpec({ ...minimalSpec(), guardrails: { maxTokensPerCall: 0 } });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("maxTokensPerCall"))).toBe(true);
  });

  it("rejects negative maxTokensPerCall", () => {
    const r = validateAgentSpec({ ...minimalSpec(), guardrails: { maxTokensPerCall: -1 } });
    expect(r.valid).toBe(false);
  });

  it("rejects maxCostPerCall of 0", () => {
    const r = validateAgentSpec({ ...minimalSpec(), guardrails: { maxCostPerCall: 0 } });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("maxCostPerCall"))).toBe(true);
  });

  it("rejects requireHumanApproval that is not a boolean", () => {
    const r = validateAgentSpec({
      ...minimalSpec(),
      guardrails: { requireHumanApproval: "yes" },
    });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("requireHumanApproval"))).toBe(true);
  });

  it("rejects a non-object guardrails value", () => {
    const r = validateAgentSpec({ ...minimalSpec(), guardrails: true });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("Pillar 4"))).toBe(true);
  });

  it("is optional — no error when absent", () => {
    const r = validateAgentSpec(minimalSpec());
    expect(r.errors.some((e) => e.includes("Pillar 4"))).toBe(false);
  });
});

// ── Pillar 5 — Prompts ────────────────────────────────────────────────────────

describe("Pillar 5 — Prompts", () => {
  it("accepts prompts.system as a string", () => {
    const r = validateAgentSpec({ ...minimalSpec(), prompts: { system: "You are a helper." } });
    expect(r.valid).toBe(true);
  });

  it("accepts an empty prompts object", () => {
    const r = validateAgentSpec({ ...minimalSpec(), prompts: {} });
    expect(r.valid).toBe(true);
  });

  it("rejects prompts.system that is not a string", () => {
    const r = validateAgentSpec({ ...minimalSpec(), prompts: { system: 42 } });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("prompts.system"))).toBe(true);
  });

  it("rejects a non-object prompts value", () => {
    const r = validateAgentSpec({ ...minimalSpec(), prompts: "You are…" });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("Pillar 5"))).toBe(true);
  });

  it("is optional — no error when absent", () => {
    const r = validateAgentSpec(minimalSpec());
    expect(r.errors.some((e) => e.includes("Pillar 5"))).toBe(false);
  });

  it("accepts prompts.preamble as a string", () => {
    const r = validateAgentSpec({ ...minimalSpec(), prompts: { preamble: "Context: you assist with code." } });
    expect(r.valid).toBe(true);
  });

  it("rejects prompts.preamble that is not a string", () => {
    const r = validateAgentSpec({ ...minimalSpec(), prompts: { preamble: 123 } });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("prompts.preamble"))).toBe(true);
  });

  it("accepts prompts.suffix as a string", () => {
    const r = validateAgentSpec({ ...minimalSpec(), prompts: { suffix: "Always be concise." } });
    expect(r.valid).toBe(true);
  });

  it("rejects prompts.suffix that is not a string", () => {
    const r = validateAgentSpec({ ...minimalSpec(), prompts: { suffix: false } });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("prompts.suffix"))).toBe(true);
  });

  it("accepts prompts with all three fields as strings", () => {
    const r = validateAgentSpec({
      ...minimalSpec(),
      prompts: { preamble: "Pre.", system: "You are a bot.", suffix: "Be brief." },
    });
    expect(r.valid).toBe(true);
  });
});

// ── Pillar 6 — Intent & Persona ───────────────────────────────────────────────

describe("Pillar 6 — Intent & Persona", () => {
  it("accepts a valid intents array", () => {
    const r = validateAgentSpec({ ...minimalSpec(), intents: ["search", "summarize"] });
    expect(r.valid).toBe(true);
  });

  it("accepts an empty intents array", () => {
    const r = validateAgentSpec({ ...minimalSpec(), intents: [] });
    expect(r.valid).toBe(true);
  });

  it("rejects intents that is not an array", () => {
    const r = validateAgentSpec({ ...minimalSpec(), intents: "search" });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("intents"))).toBe(true);
  });

  it("rejects intents with a non-string element", () => {
    const r = validateAgentSpec({ ...minimalSpec(), intents: ["ok", 42] });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("intents[1]"))).toBe(true);
  });

  it("accepts a valid scored domains array", () => {
    const r = validateAgentSpec({
      ...minimalSpec(),
      domains: [
        { name: "finance", score: 0.9 },
        { name: "legal", score: 0.5 },
      ],
    });
    expect(r.valid).toBe(true);
  });

  it("accepts domain score of 0 and 1 (boundary values)", () => {
    const r = validateAgentSpec({
      ...minimalSpec(),
      domains: [
        { name: "a", score: 0 },
        { name: "b", score: 1 },
      ],
    });
    expect(r.valid).toBe(true);
  });

  it("rejects domains that is not an array", () => {
    const r = validateAgentSpec({ ...minimalSpec(), domains: "finance" });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("domains"))).toBe(true);
  });

  it("rejects a domain element that is not an object", () => {
    const r = validateAgentSpec({ ...minimalSpec(), domains: ["not-an-object"] });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("domains[0]"))).toBe(true);
  });

  it("rejects a domain with a non-string name", () => {
    const r = validateAgentSpec({ ...minimalSpec(), domains: [{ name: 99, score: 0.5 }] });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("domains[0].name"))).toBe(true);
  });

  it("rejects a domain with score > 1", () => {
    const r = validateAgentSpec({ ...minimalSpec(), domains: [{ name: "x", score: 1.1 }] });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("domains[0].score"))).toBe(true);
  });

  it("rejects a domain with score < 0", () => {
    const r = validateAgentSpec({ ...minimalSpec(), domains: [{ name: "x", score: -0.1 }] });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("domains[0].score"))).toBe(true);
  });

  it("is optional — no error when absent", () => {
    const r = validateAgentSpec(minimalSpec());
    expect(r.errors.some((e) => /Pillar 6/.test(e))).toBe(false);
  });
});

// ── Pillar 7 — Communication ──────────────────────────────────────────────────

describe("Pillar 7 — Communication", () => {
  it("accepts communication.canDelegateTo as an array of strings", () => {
    const r = validateAgentSpec({
      ...minimalSpec(),
      communication: { canDelegateTo: ["agent-a", "agent-b"] },
    });
    expect(r.valid).toBe(true);
  });

  it("rejects communication.canDelegateTo with a non-string element", () => {
    const r = validateAgentSpec({
      ...minimalSpec(),
      communication: { canDelegateTo: [42] },
    });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("canDelegateTo[0]"))).toBe(true);
  });

  it('accepts delegationTargets containing "*" wildcard without registry check', () => {
    const r = validateAgentSpec(
      { ...minimalSpec(), communication: { delegationTargets: ["*"] } },
      []
    );
    expect(r.valid).toBe(true);
  });

  it("accepts delegationTargets referencing a known agent ID", () => {
    const r = validateAgentSpec(
      { ...minimalSpec(), communication: { delegationTargets: ["existing-agent"] } },
      ["existing-agent"]
    );
    expect(r.valid).toBe(true);
  });

  it("rejects delegationTargets referencing an unknown agent ID", () => {
    const r = validateAgentSpec(
      { ...minimalSpec(), communication: { delegationTargets: ["ghost-agent"] } },
      ["agent-a"]
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("ghost-agent"))).toBe(true);
  });

  it("rejects delegationTargets that is not an array", () => {
    const r = validateAgentSpec({
      ...minimalSpec(),
      communication: { delegationTargets: "agent-a" },
    });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("delegationTargets"))).toBe(true);
  });

  it("rejects a non-object communication value", () => {
    const r = validateAgentSpec({ ...minimalSpec(), communication: "yes" });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("Pillar 7"))).toBe(true);
  });

  it("is optional — no error when absent", () => {
    const r = validateAgentSpec(minimalSpec());
    expect(r.errors.some((e) => /Pillar 7/.test(e))).toBe(false);
  });
});

// ── Pillar 8 — Orchestration ──────────────────────────────────────────────────

describe("Pillar 8 — Orchestration", () => {
  it("accepts a valid orchestration config", () => {
    const r = validateAgentSpec({
      ...minimalSpec(),
      orchestration: { priority: 5, maxConcurrency: 3 },
    });
    expect(r.valid).toBe(true);
  });

  it("accepts orchestration.priority of 0 (boundary)", () => {
    const r = validateAgentSpec({ ...minimalSpec(), orchestration: { priority: 0 } });
    expect(r.valid).toBe(true);
  });

  it("rejects negative orchestration.priority", () => {
    const r = validateAgentSpec({ ...minimalSpec(), orchestration: { priority: -1 } });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("orchestration.priority"))).toBe(true);
  });

  it("rejects orchestration.maxConcurrency of 0", () => {
    const r = validateAgentSpec({ ...minimalSpec(), orchestration: { maxConcurrency: 0 } });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("maxConcurrency"))).toBe(true);
  });

  it("rejects a fractional orchestration.maxConcurrency", () => {
    const r = validateAgentSpec({ ...minimalSpec(), orchestration: { maxConcurrency: 1.5 } });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("maxConcurrency"))).toBe(true);
  });

  it("rejects a non-object orchestration value", () => {
    const r = validateAgentSpec({ ...minimalSpec(), orchestration: 99 });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("Pillar 8"))).toBe(true);
  });

  it("is optional — no error when absent", () => {
    const r = validateAgentSpec(minimalSpec());
    expect(r.errors.some((e) => /Pillar 8/.test(e))).toBe(false);
  });
});

// ── Pillar 9 — Memory ─────────────────────────────────────────────────────────

describe("Pillar 9 — Memory", () => {
  it("accepts valid memory config", () => {
    const r = validateAgentSpec({
      ...minimalSpec(),
      memory: { kpiEnabled: true, autoRetireAfterMinutes: 60 },
    });
    expect(r.valid).toBe(true);
  });

  it("accepts kpiEnabled = false", () => {
    const r = validateAgentSpec({ ...minimalSpec(), memory: { kpiEnabled: false } });
    expect(r.valid).toBe(true);
  });

  it("rejects kpiEnabled that is not a boolean", () => {
    const r = validateAgentSpec({ ...minimalSpec(), memory: { kpiEnabled: "true" } });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("kpiEnabled"))).toBe(true);
  });

  it("rejects autoRetireAfterMinutes of 0", () => {
    const r = validateAgentSpec({ ...minimalSpec(), memory: { autoRetireAfterMinutes: 0 } });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("autoRetireAfterMinutes"))).toBe(true);
  });

  it("rejects negative autoRetireAfterMinutes", () => {
    const r = validateAgentSpec({ ...minimalSpec(), memory: { autoRetireAfterMinutes: -5 } });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("autoRetireAfterMinutes"))).toBe(true);
  });

  it("rejects a non-object memory value", () => {
    const r = validateAgentSpec({ ...minimalSpec(), memory: [] });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("Pillar 9"))).toBe(true);
  });

  it("is optional — no error when absent", () => {
    const r = validateAgentSpec(minimalSpec());
    expect(r.errors.some((e) => /Pillar 9/.test(e))).toBe(false);
  });
});

// ── Multiple errors in one spec ───────────────────────────────────────────────

describe("multiple errors collected in one pass", () => {
  it("returns all errors when several pillars are invalid", () => {
    const r = validateAgentSpec({
      id: "",
      name: "",
      controlLoop: { type: "bad-type" },
      guardrails: { maxTokensPerCall: -1 },
    });
    expect(r.valid).toBe(false);
    expect(r.errors.length).toBeGreaterThanOrEqual(3);
    expect(r.errors.some((e) => e.includes("id"))).toBe(true);
    expect(r.errors.some((e) => e.includes("name"))).toBe(true);
    expect(r.errors.some((e) => e.includes("controlLoop"))).toBe(true);
  });
});

// ── McpServiceListManager integration ────────────────────────────────────────

describe("McpServiceListManager.registerAgent integration", () => {
  it("throws when registering an agent with an empty id", () => {
    const { McpServiceListManager } = require("../McpServiceListManager");
    const mgr = new McpServiceListManager();
    expect(() => mgr.registerAgent({ id: "", name: "Bot" })).toThrow(/Invalid AgentSpec/);
  });

  it("throws when registering an agent with an invalid controlLoop type", () => {
    const { McpServiceListManager } = require("../McpServiceListManager");
    const mgr = new McpServiceListManager();
    expect(() =>
      mgr.registerAgent({ id: "bot-1", name: "Bot", controlLoop: { type: "bad" } })
    ).toThrow(/Invalid AgentSpec/);
  });

  it("successfully registers a valid agent", () => {
    const { McpServiceListManager } = require("../McpServiceListManager");
    const mgr = new McpServiceListManager();
    expect(() =>
      mgr.registerAgent({
        id: "bot-1",
        name: "Bot One",
        controlLoop: { type: "react" },
        tools: [{ name: "search" }],
      })
    ).not.toThrow();
    expect(mgr.getAgent("bot-1")).toBeDefined();
  });

  it("throws when delegationTargets reference an unknown agent", () => {
    const { McpServiceListManager } = require("../McpServiceListManager");
    const mgr = new McpServiceListManager();
    expect(() =>
      mgr.registerAgent({
        id: "bot-1",
        name: "Bot One",
        communication: { delegationTargets: ["ghost"] },
      })
    ).toThrow(/ghost/);
  });

  it("allows delegationTargets referencing an already-registered agent", () => {
    const { McpServiceListManager } = require("../McpServiceListManager");
    const mgr = new McpServiceListManager();
    mgr.registerAgent({ id: "agent-a", name: "Agent A" });
    expect(() =>
      mgr.registerAgent({
        id: "bot-1",
        name: "Bot One",
        communication: { delegationTargets: ["agent-a"] },
      })
    ).not.toThrow();
  });
});
