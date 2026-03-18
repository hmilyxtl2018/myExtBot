/**
 * @file AgentSpec.test.ts
 * @module src/core/agent/__tests__
 *
 * Unit tests for the unified Agent specification module.
 *
 * 统一 Agent 规范模块的单元测试。
 *
 * Tests cover / 测试内容:
 * - `AgentFactory.fromProfile()` — legacy profile conversion
 * - `AgentFactory.createPhasedAgent()` — phased agent creation
 * - `AgentFactory.validate()` — spec validation (valid + invalid cases)
 * - `BaseAgent.run()` in ReAct, PlanExecute, and Reflect modes
 * - Lifecycle integration (busy/active transitions)
 *
 * Run with Node.js built-in test runner (no external dependencies needed):
 *   node --experimental-strip-types --test src/core/agent/__tests__/AgentSpec.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { AgentFactory, type AgentLegacyProfile } from "../AgentFactory";
import type { AgentSpec, AgentRunResult } from "../AgentSpec";
import { BaseAgent, type LLMAdapter, type IDispatcher, type ILifecycleManager } from "../BaseAgent";

// ─── Helpers & mocks ──────────────────────────────────────────────────────────

/** Build a minimal valid AgentSpec for testing. */
function makeMinimalSpec(overrides?: Partial<AgentSpec>): AgentSpec {
  return {
    id: "test-agent",
    name: "Test Agent",
    prompts: { mode: "single", default: "You are a helpful assistant." },
    toolBox: { directTools: ["search_web"] },
    controlLoop: { mode: "react", maxIterations: 3 },
    ...overrides,
  };
}

/** Build a minimal legacy profile for testing. */
function makeProfile(overrides?: Partial<AgentLegacyProfile>): AgentLegacyProfile {
  return {
    id: "legacy-bot",
    name: "Legacy Bot",
    systemPrompt: "You are a legacy assistant.",
    allowedServices: ["search_web"],
    canDelegateTo: ["other-bot"],
    ...overrides,
  };
}

/** Create a mock LLM adapter that returns pre-defined responses in sequence. */
function makeMockLLM(responses: string[]): LLMAdapter {
  let callCount = 0;
  return {
    async chat() {
      const response = responses[callCount] ?? responses[responses.length - 1] ?? "";
      callCount++;
      return response;
    },
  };
}

/** Create a mock dispatcher that returns a successful result. */
function makeMockDispatcher(output?: unknown): IDispatcher {
  return {
    async dispatchAs(_agentId, toolCall) {
      return {
        success: true,
        output: output ?? `result of ${toolCall.toolName}`,
      };
    },
  };
}

/** Create a mock lifecycle manager that tracks method calls. */
function makeMockLifecycle(): ILifecycleManager & {
  busyCalls: string[];
  completeCalls: string[];
} {
  const busyCalls: string[] = [];
  const completeCalls: string[] = [];
  return {
    busyCalls,
    completeCalls,
    markBusy(agentId: string) {
      busyCalls.push(agentId);
    },
    markTaskComplete(agentId: string) {
      completeCalls.push(agentId);
    },
  };
}

// ─── AgentFactory.fromProfile() ───────────────────────────────────────────────

describe("AgentFactory.fromProfile()", () => {
  it("preserves id and name from the legacy profile", () => {
    const spec = AgentFactory.fromProfile(makeProfile());
    assert.equal(spec.id, "legacy-bot");
    assert.equal(spec.name, "Legacy Bot");
  });

  it("sets prompts.mode to 'single' by default", () => {
    const spec = AgentFactory.fromProfile(makeProfile());
    assert.equal(spec.prompts.mode, "single");
  });

  it("maps systemPrompt to prompts.default", () => {
    const spec = AgentFactory.fromProfile(
      makeProfile({ systemPrompt: "You are a planner." })
    );
    assert.equal(spec.prompts.default, "You are a planner.");
  });

  it("maps allowedServices to toolBox.directTools", () => {
    const spec = AgentFactory.fromProfile(
      makeProfile({ allowedServices: ["search_web", "crawl_page"] })
    );
    assert.deepEqual(spec.toolBox.directTools, ["search_web", "crawl_page"]);
  });

  it("maps canDelegateTo to toolBox.delegatedCapabilities", () => {
    const spec = AgentFactory.fromProfile(
      makeProfile({ canDelegateTo: ["bot-a", "bot-b"] })
    );
    assert.deepEqual(spec.toolBox.delegatedCapabilities, [
      { agentId: "bot-a" },
      { agentId: "bot-b" },
    ]);
  });

  it("defaults controlLoop to react mode with maxIterations 10", () => {
    const spec = AgentFactory.fromProfile(makeProfile());
    assert.equal(spec.controlLoop.mode, "react");
    assert.equal(spec.controlLoop.maxIterations, 10);
  });

  it("preserves optional routing fields (intents, domains, languages, responseStyle)", () => {
    const spec = AgentFactory.fromProfile(
      makeProfile({
        intents: ["web-search"],
        domains: ["research"],
        languages: ["zh-CN", "en-US"],
        responseStyle: "concise",
      })
    );
    assert.deepEqual(spec.intents, ["web-search"]);
    assert.deepEqual(spec.domains, ["research"]);
    assert.deepEqual(spec.languages, ["zh-CN", "en-US"]);
    assert.equal(spec.responseStyle, "concise");
  });

  it("preserves backward-compat legacy fields on the resulting spec", () => {
    const profile = makeProfile();
    const spec = AgentFactory.fromProfile(profile);
    assert.deepEqual(spec.allowedServices, profile.allowedServices);
    assert.deepEqual(spec.canDelegateTo, profile.canDelegateTo);
    assert.equal(spec.systemPrompt, profile.systemPrompt);
  });

  it("applies caller-supplied defaults for model", () => {
    const spec = AgentFactory.fromProfile(makeProfile(), {
      model: { provider: "openai", modelName: "gpt-4o" },
    });
    assert.equal(spec.model?.provider, "openai");
    assert.equal(spec.model?.modelName, "gpt-4o");
  });

  it("uses ownedServices as fallback when allowedServices is absent", () => {
    const spec = AgentFactory.fromProfile(
      makeProfile({ allowedServices: undefined, ownedServices: ["svc-a"] })
    );
    assert.deepEqual(spec.toolBox.directTools, ["svc-a"]);
  });

  it("produces a spec that passes validation", () => {
    const spec = AgentFactory.fromProfile(makeProfile());
    const result = AgentFactory.validate(spec);
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });
});

// ─── AgentFactory.createPhasedAgent() ────────────────────────────────────────

describe("AgentFactory.createPhasedAgent()", () => {
  const phasedConfig = {
    id: "research-bot",
    name: "Research Bot",
    phasePrompts: {
      planning: "You are a strategic planner.",
      execution: "You are a task executor.",
      reflection: "You are a critical reviewer.",
    },
    directTools: ["search_web", "crawl_page"],
    maxIterations: 5,
  };

  it("creates a spec with phased prompt mode", () => {
    const spec = AgentFactory.createPhasedAgent(phasedConfig);
    assert.equal(spec.prompts.mode, "phased");
  });

  it("creates all three standard phases", () => {
    const spec = AgentFactory.createPhasedAgent(phasedConfig);
    assert.ok(spec.prompts.phases?.["planning"], "planning phase missing");
    assert.ok(spec.prompts.phases?.["execution"], "execution phase missing");
    assert.ok(spec.prompts.phases?.["reflection"], "reflection phase missing");
  });

  it("stores the correct system prompts in each phase", () => {
    const spec = AgentFactory.createPhasedAgent(phasedConfig);
    assert.equal(
      spec.prompts.phases?.["planning"]?.systemPrompt,
      "You are a strategic planner."
    );
    assert.equal(
      spec.prompts.phases?.["execution"]?.systemPrompt,
      "You are a task executor."
    );
    assert.equal(
      spec.prompts.phases?.["reflection"]?.systemPrompt,
      "You are a critical reviewer."
    );
  });

  it("sets controlLoop to plan-execute mode", () => {
    const spec = AgentFactory.createPhasedAgent(phasedConfig);
    assert.equal(spec.controlLoop.mode, "plan-execute");
  });

  it("applies the provided maxIterations", () => {
    const spec = AgentFactory.createPhasedAgent(phasedConfig);
    assert.equal(spec.controlLoop.maxIterations, 5);
  });

  it("defaults maxIterations to 5 when not provided", () => {
    const { maxIterations: _omit, ...configWithoutIter } = phasedConfig;
    const spec = AgentFactory.createPhasedAgent(configWithoutIter);
    assert.equal(spec.controlLoop.maxIterations, 5);
  });

  it("sets directTools from config", () => {
    const spec = AgentFactory.createPhasedAgent(phasedConfig);
    assert.deepEqual(spec.toolBox.directTools, ["search_web", "crawl_page"]);
  });

  it("passes validation", () => {
    const spec = AgentFactory.createPhasedAgent(phasedConfig);
    const result = AgentFactory.validate(spec);
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });
});

// ─── AgentFactory.validate() ─────────────────────────────────────────────────

describe("AgentFactory.validate()", () => {
  describe("valid specs", () => {
    it("passes a minimal valid spec", () => {
      const result = AgentFactory.validate(makeMinimalSpec());
      assert.equal(result.valid, true);
      assert.equal(result.errors.length, 0);
    });

    it("passes a phased spec with all phases defined", () => {
      const spec = AgentFactory.createPhasedAgent({
        id: "bot",
        name: "Bot",
        phasePrompts: {
          planning: "plan",
          execution: "exec",
          reflection: "reflect",
        },
      });
      const result = AgentFactory.validate(spec);
      assert.equal(result.valid, true);
    });
  });

  describe("required field errors", () => {
    it("errors when id is empty", () => {
      const result = AgentFactory.validate(makeMinimalSpec({ id: "" }));
      assert.equal(result.valid, false);
      assert.ok(
        result.errors.some((e) => e.includes("id")),
        `Expected error mentioning 'id', got: ${result.errors.join("; ")}`
      );
    });

    it("errors when name is empty", () => {
      const result = AgentFactory.validate(makeMinimalSpec({ name: "" }));
      assert.equal(result.valid, false);
      assert.ok(
        result.errors.some((e) => e.includes("name")),
        `Expected error mentioning 'name', got: ${result.errors.join("; ")}`
      );
    });

    it("errors when prompts is missing", () => {
      const spec = { ...makeMinimalSpec() } as Partial<AgentSpec> & { id: string; name: string };
      delete spec.prompts;
      const result = AgentFactory.validate(spec as AgentSpec);
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((e) => e.includes("prompts")));
    });

    it("errors when toolBox is missing", () => {
      const spec = { ...makeMinimalSpec() } as Partial<AgentSpec> & { id: string; name: string };
      delete spec.toolBox;
      const result = AgentFactory.validate(spec as AgentSpec);
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((e) => e.includes("toolBox")));
    });

    it("errors when controlLoop is missing", () => {
      const spec = { ...makeMinimalSpec() } as Partial<AgentSpec> & { id: string; name: string };
      delete spec.controlLoop;
      const result = AgentFactory.validate(spec as AgentSpec);
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((e) => e.includes("controlLoop")));
    });
  });

  describe("phased mode errors", () => {
    it("errors when phased mode has empty phases", () => {
      const spec = makeMinimalSpec({
        prompts: { mode: "phased", phases: {} },
      });
      const result = AgentFactory.validate(spec);
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((e) => e.includes("phased")));
    });

    it("errors when phased mode has no phases field", () => {
      const spec = makeMinimalSpec({
        prompts: { mode: "phased" },
      });
      const result = AgentFactory.validate(spec);
      assert.equal(result.valid, false);
    });
  });

  describe("custom mode errors", () => {
    it("errors when custom mode has empty stages", () => {
      const spec = makeMinimalSpec({
        controlLoop: { mode: "custom", stages: [] },
      });
      const result = AgentFactory.validate(spec);
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((e) => e.includes("stages")));
    });
  });

  describe("dangling phase reference errors", () => {
    it("errors when a custom stage references a non-existent phase", () => {
      const spec = makeMinimalSpec({
        prompts: {
          mode: "phased",
          phases: {
            planning: { phaseId: "planning", systemPrompt: "plan" },
          },
        },
        controlLoop: {
          mode: "custom",
          stages: [
            {
              id: "step1",
              action: "think" as const,
              promptPhaseId: "non-existent-phase",
            },
          ],
        },
      });
      const result = AgentFactory.validate(spec);
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((e) => e.includes("non-existent-phase")));
    });
  });

  describe("self-delegation errors", () => {
    it("errors when agent delegates to itself via delegatedCapabilities", () => {
      const spec = makeMinimalSpec({
        toolBox: {
          directTools: [],
          delegatedCapabilities: [{ agentId: "test-agent" }],
        },
      });
      const result = AgentFactory.validate(spec);
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((e) => e.includes("self-delegation")));
    });

    it("errors when agent delegates to itself via canDelegateTo", () => {
      const spec = makeMinimalSpec({ canDelegateTo: ["test-agent"] });
      const result = AgentFactory.validate(spec);
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((e) => e.includes("self-delegation")));
    });
  });

  describe("maxIterations errors", () => {
    it("errors when maxIterations is zero", () => {
      const spec = makeMinimalSpec({
        controlLoop: { mode: "react", maxIterations: 0 },
      });
      const result = AgentFactory.validate(spec);
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((e) => e.includes("maxIterations")));
    });

    it("errors when maxIterations is negative", () => {
      const spec = makeMinimalSpec({
        controlLoop: { mode: "react", maxIterations: -5 },
      });
      const result = AgentFactory.validate(spec);
      assert.equal(result.valid, false);
    });
  });

  describe("warnings (non-blocking)", () => {
    it("warns when single mode has no default prompt", () => {
      const spec = makeMinimalSpec({
        prompts: { mode: "single" }, // no default
      });
      const result = AgentFactory.validate(spec);
      assert.equal(result.valid, true); // still valid
      assert.ok(result.warnings.some((w) => w.includes("prompts.default")));
    });

    it("warns when toolBox has no tools and no delegations", () => {
      const spec = makeMinimalSpec({
        toolBox: { directTools: [] },
      });
      const result = AgentFactory.validate(spec);
      assert.equal(result.valid, true); // still valid
      assert.ok(result.warnings.some((w) => w.includes("no directTools")));
    });

    it("warns when plan-execute mode is used without phased prompts", () => {
      const spec = makeMinimalSpec({
        controlLoop: { mode: "plan-execute", maxIterations: 5 },
        prompts: { mode: "single", default: "You are a bot." },
      });
      const result = AgentFactory.validate(spec);
      assert.equal(result.valid, true); // still valid
      assert.ok(result.warnings.some((w) => w.includes("plan-execute")));
    });
  });
});

// ─── BaseAgent control loops ──────────────────────────────────────────────────

describe("BaseAgent.run()", () => {
  // ── ReAct mode ─────────────────────────────────────────────────────────────

  describe("ReAct mode", () => {
    it("returns success with the LLM output when no tool calls are present", async () => {
      const spec = makeMinimalSpec({ controlLoop: { mode: "react", maxIterations: 3 } });
      const llm = makeMockLLM(["Here is my answer."]);
      const lifecycle = makeMockLifecycle();
      const agent = new BaseAgent(spec, makeMockDispatcher(), lifecycle, llm);

      const result = await agent.run("What is 2+2?");

      assert.equal(result.success, true);
      assert.equal(result.output, "Here is my answer.");
    });

    it("loops think→act→observe until the LLM stops calling tools", async () => {
      const spec = makeMinimalSpec({ controlLoop: { mode: "react", maxIterations: 5 } });
      // First response contains a tool call; second does not
      const llm = makeMockLLM([
        '```json\n{"toolName":"search_web","arguments":{"query":"test"}}\n```',
        "Final answer based on search results.",
      ]);
      const lifecycle = makeMockLifecycle();
      const agent = new BaseAgent(spec, makeMockDispatcher(), lifecycle, llm);

      const result = await agent.run("Search for something.");

      assert.equal(result.success, true);
      assert.ok(result.phases.length >= 2, "Expected at least 2 phases");
      // First phase should have a tool call recorded
      assert.ok(result.phases[0]!.toolCalls.length > 0, "First phase should have tool calls");
      assert.equal(result.phases[0]!.toolCalls[0]!.tool, "search_web");
    });

    it("stops at maxIterations even if tool calls keep appearing", async () => {
      const spec = makeMinimalSpec({ controlLoop: { mode: "react", maxIterations: 3 } });
      // Always returns a tool call — should stop at maxIterations
      const llm = makeMockLLM([
        '```json\n{"toolName":"search_web","arguments":{"query":"q"}}\n```',
      ]);
      const lifecycle = makeMockLifecycle();
      const agent = new BaseAgent(spec, makeMockDispatcher(), lifecycle, llm);

      const result = await agent.run("Keep searching.");

      assert.equal(result.success, true);
      assert.ok(result.phases.length <= 3, `Expected at most 3 phases, got ${result.phases.length}`);
    });

    it("records durationMs >= 0", async () => {
      const spec = makeMinimalSpec();
      const llm = makeMockLLM(["Done."]);
      const lifecycle = makeMockLifecycle();
      const agent = new BaseAgent(spec, makeMockDispatcher(), lifecycle, llm);

      const result = await agent.run("Task");

      assert.ok(result.durationMs >= 0, `Expected durationMs >= 0, got ${result.durationMs}`);
    });
  });

  // ── PlanExecute mode ───────────────────────────────────────────────────────

  describe("PlanExecute mode", () => {
    function makePhasedSpec() {
      return AgentFactory.createPhasedAgent({
        id: "planner-bot",
        name: "Planner Bot",
        phasePrompts: {
          planning: "You are a strategic planner.",
          execution: "You are a task executor.",
          reflection: "You are a critical reviewer.",
        },
        directTools: ["search_web"],
        maxIterations: 5,
      });
    }

    it("calls planning→execution→reflection prompts in order", async () => {
      const spec = makePhasedSpec();
      const calledPrompts: string[] = [];

      const llm: LLMAdapter = {
        async chat(messages) {
          calledPrompts.push(messages[0]!.content); // capture system prompt
          return "phase output";
        },
      };
      const lifecycle = makeMockLifecycle();
      const agent = new BaseAgent(spec, makeMockDispatcher(), lifecycle, llm);

      await agent.run("Research topic X.");

      assert.equal(calledPrompts[0], "You are a strategic planner.");
      assert.equal(calledPrompts[1], "You are a task executor.");
      assert.equal(calledPrompts[2], "You are a critical reviewer.");
    });

    it("returns exactly 3 phases (planning, execution, reflection)", async () => {
      const spec = makePhasedSpec();
      const llm = makeMockLLM(["plan", "execute", "reflect"]);
      const lifecycle = makeMockLifecycle();
      const agent = new BaseAgent(spec, makeMockDispatcher(), lifecycle, llm);

      const result = await agent.run("Do something.");

      assert.equal(result.phases.length, 3);
      assert.equal(result.phases[0]!.phaseId, "planning");
      assert.equal(result.phases[1]!.phaseId, "execution");
      assert.equal(result.phases[2]!.phaseId, "reflection");
    });

    it("uses the planning output as input to execution", async () => {
      const spec = makePhasedSpec();
      const inputs: string[] = [];

      const llm: LLMAdapter = {
        async chat(messages) {
          inputs.push(messages[1]!.content); // capture user-turn content
          return `output-${inputs.length}`;
        },
      };
      const lifecycle = makeMockLifecycle();
      const agent = new BaseAgent(spec, makeMockDispatcher(), lifecycle, llm);

      await agent.run("Initial task.");

      assert.ok(
        inputs[0]!.includes("Initial task."),
        "Planning input should include the original task"
      );
      assert.equal(inputs[1], "output-1"); // execution receives plan output
      assert.equal(inputs[2], "output-2"); // reflection receives execution output
    });

    it("returns the reflection output as the final output", async () => {
      const spec = makePhasedSpec();
      const llm = makeMockLLM(["plan", "execute", "FINAL REVIEW"]);
      const lifecycle = makeMockLifecycle();
      const agent = new BaseAgent(spec, makeMockDispatcher(), lifecycle, llm);

      const result = await agent.run("Task.");

      assert.equal(result.output, "FINAL REVIEW");
    });
  });

  // ── Reflect mode ───────────────────────────────────────────────────────────

  describe("Reflect mode", () => {
    it("invokes reflection after detecting no tool calls", async () => {
      const spec = makeMinimalSpec({
        prompts: {
          mode: "phased",
          phases: {
            default: { phaseId: "default", systemPrompt: "You are a thinker." },
            reflection: { phaseId: "reflection", systemPrompt: "Reflect critically." },
          },
        },
        controlLoop: { mode: "reflect", maxIterations: 3 },
      });

      const calledSystemPrompts: string[] = [];
      const llm: LLMAdapter = {
        async chat(messages) {
          calledSystemPrompts.push(messages[0]!.content);
          return "reflective output";
        },
      };
      const lifecycle = makeMockLifecycle();
      const agent = new BaseAgent(spec, makeMockDispatcher(), lifecycle, llm);

      const result = await agent.run("Think about this.");

      assert.equal(result.success, true);
      assert.ok(
        calledSystemPrompts.some((p) => p.includes("Reflect critically.")),
        "Expected reflection prompt to be called"
      );
    });

    it("records act phases with tool calls when the LLM emits a tool call", async () => {
      const spec = makeMinimalSpec({
        controlLoop: { mode: "reflect", maxIterations: 3 },
      });
      const llm = makeMockLLM([
        // First: think with a tool call
        '```json\n{"toolName":"search_web","arguments":{"query":"test"}}\n```',
        // Second: reflect (no tool call)
        "I reflected on the search results.",
      ]);
      const lifecycle = makeMockLifecycle();
      const agent = new BaseAgent(spec, makeMockDispatcher(), lifecycle, llm);

      const result = await agent.run("Research and reflect.");

      assert.equal(result.success, true);
      const actPhases = result.phases.filter((p) => p.phaseId.startsWith("act-"));
      assert.ok(actPhases.length > 0, "Expected at least one act phase");
      assert.equal(actPhases[0]!.toolCalls[0]!.tool, "search_web");
    });
  });

  // ── Lifecycle integration ──────────────────────────────────────────────────

  describe("lifecycle integration", () => {
    it("marks agent busy at the start of run()", async () => {
      const spec = makeMinimalSpec();
      const llm = makeMockLLM(["ok"]);
      const lifecycle = makeMockLifecycle();
      const agent = new BaseAgent(spec, makeMockDispatcher(), lifecycle, llm);

      await agent.run("Do something.");

      assert.ok(
        lifecycle.busyCalls.includes("test-agent"),
        "Expected markBusy('test-agent') to be called"
      );
    });

    it("marks task complete after a successful run()", async () => {
      const spec = makeMinimalSpec();
      const llm = makeMockLLM(["done"]);
      const lifecycle = makeMockLifecycle();
      const agent = new BaseAgent(spec, makeMockDispatcher(), lifecycle, llm);

      await agent.run("Task.");

      assert.ok(
        lifecycle.completeCalls.includes("test-agent"),
        "Expected markTaskComplete('test-agent') to be called"
      );
    });

    it("marks task complete even when the LLM throws an error", async () => {
      const spec = makeMinimalSpec();
      const llm: LLMAdapter = {
        async chat() {
          throw new Error("LLM unavailable");
        },
      };
      const lifecycle = makeMockLifecycle();
      const agent = new BaseAgent(spec, makeMockDispatcher(), lifecycle, llm);

      const result = await agent.run("Fail gracefully.");

      assert.equal(result.success, false);
      assert.ok(
        result.error?.includes("LLM unavailable"),
        `Expected error to include 'LLM unavailable', got: ${result.error}`
      );
      // Must still release the lifecycle lock
      assert.ok(
        lifecycle.completeCalls.includes("test-agent"),
        "Expected markTaskComplete to be called even after error"
      );
    });
  });

  // ── getPrompt() ────────────────────────────────────────────────────────────

  describe("getPrompt() phase resolution", () => {
    it("returns the default prompt in single mode", () => {
      const spec = makeMinimalSpec({
        prompts: { mode: "single", default: "Default system prompt." },
      });
      const agent = new BaseAgent(
        spec,
        makeMockDispatcher(),
        makeMockLifecycle(),
        makeMockLLM([])
      );
      assert.equal(agent.getPrompt("default"), "Default system prompt.");
      assert.equal(agent.getPrompt("planning"), "Default system prompt.");
    });

    it("returns the phase-specific prompt in phased mode", () => {
      const spec = makeMinimalSpec({
        prompts: {
          mode: "phased",
          default: "Fallback.",
          phases: {
            planning: { phaseId: "planning", systemPrompt: "Planning prompt." },
          },
        },
      });
      const agent = new BaseAgent(
        spec,
        makeMockDispatcher(),
        makeMockLifecycle(),
        makeMockLLM([])
      );
      assert.equal(agent.getPrompt("planning"), "Planning prompt.");
    });

    it("falls back to prompts.default for an unknown phase in phased mode", () => {
      const spec = makeMinimalSpec({
        prompts: {
          mode: "phased",
          default: "Fallback.",
          phases: {
            planning: { phaseId: "planning", systemPrompt: "Planning prompt." },
          },
        },
      });
      const agent = new BaseAgent(
        spec,
        makeMockDispatcher(),
        makeMockLifecycle(),
        makeMockLLM([])
      );
      assert.equal(agent.getPrompt("execution"), "Fallback.");
    });

    it("falls back to legacy systemPrompt when prompts.default is absent", () => {
      const spec = makeMinimalSpec({
        prompts: { mode: "single" },
        systemPrompt: "Legacy system prompt.",
      });
      const agent = new BaseAgent(
        spec,
        makeMockDispatcher(),
        makeMockLifecycle(),
        makeMockLLM([])
      );
      assert.equal(agent.getPrompt("default"), "Legacy system prompt.");
    });

    it("returns empty string when no prompt is configured", () => {
      const spec = makeMinimalSpec({
        prompts: { mode: "single" },
      });
      const agent = new BaseAgent(
        spec,
        makeMockDispatcher(),
        makeMockLifecycle(),
        makeMockLLM([])
      );
      assert.equal(agent.getPrompt("default"), "");
    });
  });

  // ── getSpec() ──────────────────────────────────────────────────────────────

  describe("getSpec()", () => {
    it("returns the same spec reference passed at construction", () => {
      const spec = makeMinimalSpec();
      const agent = new BaseAgent(
        spec,
        makeMockDispatcher(),
        makeMockLifecycle(),
        makeMockLLM([])
      );
      assert.equal(agent.getSpec(), spec);
    });
  });
});

// ─── AgentRunResult shape ─────────────────────────────────────────────────────

describe("AgentRunResult shape", () => {
  it("has all required fields on a successful run", async () => {
    const spec = makeMinimalSpec();
    const llm = makeMockLLM(["output"]);
    const lifecycle = makeMockLifecycle();
    const agent = new BaseAgent(spec, makeMockDispatcher(), lifecycle, llm);

    const result: AgentRunResult = await agent.run("Task");

    assert.equal(typeof result.success, "boolean");
    assert.equal(typeof result.output, "string");
    assert.equal(typeof result.durationMs, "number");
    assert.ok(Array.isArray(result.phases));
  });

  it("sets error field when run fails", async () => {
    const spec = makeMinimalSpec();
    const llm: LLMAdapter = {
      async chat() {
        throw new Error("failure");
      },
    };
    const lifecycle = makeMockLifecycle();
    const agent = new BaseAgent(spec, makeMockDispatcher(), lifecycle, llm);

    const result = await agent.run("Task");

    assert.equal(result.success, false);
    assert.ok(result.error !== undefined, "Expected error field to be set");
  });
});
