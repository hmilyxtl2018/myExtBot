/**
 * @file BaseAgent.ts
 * @module src/core/agent
 *
 * Executable Agent base class.  Takes an `AgentSpec` + adapters and provides
 * `run(task)` as the single entry point.  Internally dispatches to
 * `runReAct`, `runPlanExecute`, `runReflect`, or `runCustom` based on
 * `controlLoop.mode`.
 *
 * 可执行的 Agent 基类。接受 `AgentSpec` + 适配器，并以 `run(task)` 作为单一入口。
 * 内部根据 `controlLoop.mode` 分发到对应的循环实现。
 *
 * Integration points (documented here, not all implemented):
 * 集成点说明（此处仅记录，未全部实现）：
 *  - `McpServiceListManager.dispatchAs()` — tool execution adapter
 *  - `AgentLifecycleManager` — lifecycle state management
 *  - `ContractEnforcer` — injectable as middleware on every tool dispatch
 */

import {
  AgentSpec,
  AgentRunResult,
  PhaseResult,
  PromptPhase,
} from "./AgentSpec";

// ─── Adapters ─────────────────────────────────────────────────────────────────

/**
 * Minimal interface for an LLM chat adapter.
 * The concrete implementation is injected at construction time, so `BaseAgent`
 * remains decoupled from any specific LLM provider.
 *
 * LLM 聊天适配器的最小接口。
 * 具体实现在构造时注入，使 `BaseAgent` 与特定 LLM 提供商解耦。
 *
 * @example
 * ```ts
 * const openaiAdapter: LLMAdapter = {
 *   async chat(messages) {
 *     const resp = await openai.chat.completions.create({ model: "gpt-4o", messages });
 *     return resp.choices[0].message.content ?? "";
 *   },
 * };
 * ```
 */
export interface LLMAdapter {
  /**
   * Send a message array to the LLM and return the assistant's reply.
   * 向 LLM 发送消息数组并返回助手回复。
   *
   * @param messages - Conversation history including the system prompt.
   * @returns The LLM's raw text response.
   */
  chat(
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>
  ): Promise<string>;
}

/**
 * Minimal dispatcher interface — a subset of `McpServiceListManager` so that
 * `BaseAgent` does not need to import the full manager.
 *
 * 最小分发器接口 — `McpServiceListManager` 的子集，使 `BaseAgent` 无需引入完整的管理器。
 *
 * @example Wiring to McpServiceListManager:
 * ```ts
 * const agent = new BaseAgent(spec, manager, lifecycleManager, llmAdapter);
 * ```
 */
export interface IDispatcher {
  /**
   * Execute a tool call on behalf of the given agent and return the result.
   * 以指定 Agent 的身份执行工具调用并返回结果。
   *
   * @param agentId  - The agent ID acting as the caller.
   * @param toolCall - Tool name + arguments to pass.
   * @returns A promise resolving to the tool execution result.
   */
  dispatchAs(
    agentId: string,
    toolCall: { toolName: string; arguments: Record<string, unknown> }
  ): Promise<{ success: boolean; output?: unknown; data?: unknown; error?: string }>;
}

/**
 * Minimal lifecycle manager interface — subset of `AgentLifecycleManager`.
 * 最小生命周期管理器接口 — `AgentLifecycleManager` 的子集。
 */
export interface ILifecycleManager {
  /** Mark the agent as busy (called at the start of `run()`). */
  markBusy(agentId: string): void;
  /** Decrement task count; auto-reverts to "active" when count reaches 0. */
  markTaskComplete(agentId: string): void;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Pattern to extract JSON tool-call blocks from the LLM response. */
const TOOL_CALL_PATTERN =
  /```json\s*([\s\S]*?)```|<tool_call>([\s\S]*?)<\/tool_call>/g;

/**
 * Attempt to extract tool call objects from an LLM response string.
 * Returns an empty array if no valid tool calls are found.
 *
 * 尝试从 LLM 响应字符串中提取工具调用对象。
 * 若未找到有效工具调用，返回空数组。
 */
function extractToolCalls(
  response: string
): Array<{ toolName: string; arguments: Record<string, unknown> }> {
  const calls: Array<{ toolName: string; arguments: Record<string, unknown> }> = [];
  let match: RegExpExecArray | null;

  TOOL_CALL_PATTERN.lastIndex = 0;
  while ((match = TOOL_CALL_PATTERN.exec(response)) !== null) {
    const raw = match[1] ?? match[2];
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw.trim()) as unknown;
      if (
        parsed !== null &&
        typeof parsed === "object" &&
        "toolName" in parsed &&
        typeof (parsed as Record<string, unknown>).toolName === "string"
      ) {
        calls.push(parsed as { toolName: string; arguments: Record<string, unknown> });
      }
    } catch {
      // skip malformed JSON blocks
    }
  }
  return calls;
}

/**
 * Format a tool result for inclusion in the conversation as an "observation".
 * 将工具结果格式化为对话中的"观察"消息。
 */
function formatObservation(
  toolName: string,
  result: { success: boolean; output?: unknown; data?: unknown; error?: string }
): string {
  if (result.success) {
    const value = result.output ?? result.data;
    return `[Tool "${toolName}" result]: ${JSON.stringify(value)}`;
  }
  return `[Tool "${toolName}" error]: ${result.error ?? "unknown error"}`;
}

// ─── BaseAgent ────────────────────────────────────────────────────────────────

/**
 * **BaseAgent** is the executable runtime for an `AgentSpec`.
 *
 * It wires together:
 * - the canonical `AgentSpec` (identity + prompts + tools + control loop)
 * - an `IDispatcher` (for tool execution via `McpServiceListManager`)
 * - an `ILifecycleManager` (for busy/active state tracking)
 * - an `LLMAdapter` (injected LLM provider — OpenAI, Anthropic, local, or mock)
 *
 * **BaseAgent** 是 `AgentSpec` 的可执行运行时。
 * 它将规范定义、工具分发器、生命周期管理器和 LLM 适配器整合在一起。
 *
 * @example
 * ```ts
 * const agent = new BaseAgent(spec, dispatcher, lifecycle, llmAdapter);
 * const result = await agent.run("Summarise the latest news on AI.");
 * console.log(result.output);
 * ```
 */
export class BaseAgent {
  constructor(
    /** The canonical spec that defines this agent's identity and behaviour. */
    private readonly spec: AgentSpec,
    /** Tool dispatcher (wired to McpServiceListManager). */
    private readonly dispatcher: IDispatcher,
    /** Lifecycle manager for busy/active state transitions. */
    private readonly lifecycle: ILifecycleManager,
    /** Injectable LLM adapter (OpenAI, Anthropic, local model, or test mock). */
    private readonly llm: LLMAdapter
  ) {}

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Execute the agent on a given task string.
   *
   * The implementation selects the control loop strategy from
   * `spec.controlLoop.mode` and returns an `AgentRunResult` with a full
   * per-phase trace.
   *
   * 执行 Agent 处理给定任务。
   * 根据 `spec.controlLoop.mode` 选择控制循环策略，并返回包含完整阶段追踪的结果。
   *
   * @param task    - Natural-language task description.
   * @param context - Optional key-value context passed to the first prompt.
   * @returns Full run result including output, phases trace, and timing.
   */
  async run(
    task: string,
    context?: Record<string, unknown>
  ): Promise<AgentRunResult> {
    const startAt = Date.now();

    this.lifecycle.markBusy(this.spec.id);

    try {
      let result: Omit<AgentRunResult, "durationMs">;

      switch (this.spec.controlLoop.mode) {
        case "react":
          result = await this.runReAct(task, context);
          break;
        case "plan-execute":
          result = await this.runPlanExecute(task, context);
          break;
        case "reflect":
          result = await this.runReflect(task, context);
          break;
        case "custom":
          result = await this.runCustom(task, context);
          break;
        default:
          result = await this.runReAct(task, context);
      }

      this.lifecycle.markTaskComplete(this.spec.id);
      return { ...result, durationMs: Date.now() - startAt };
    } catch (err) {
      this.lifecycle.markTaskComplete(this.spec.id);
      return {
        success: false,
        output: "",
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - startAt,
        phases: [],
      };
    }
  }

  /**
   * Return the agent's canonical spec (read-only).
   * 返回 Agent 的规范定义（只读）。
   */
  getSpec(): Readonly<AgentSpec> {
    return this.spec;
  }

  // ── Control loop implementations ──────────────────────────────────────────

  /**
   * Classic **ReAct** (Reason + Act) loop.
   *
   * The LLM reasons about the task and optionally emits JSON tool-call blocks.
   * The runner extracts tool calls, executes them, and feeds observations back
   * until the LLM produces no more tool calls or `maxIterations` is reached.
   *
   * 经典 **ReAct**（推理+行动）循环。
   * LLM 推理任务并可选地输出 JSON 工具调用块。
   * 运行器提取工具调用、执行并将观察结果反馈给 LLM，
   * 直到 LLM 不再输出工具调用或达到 `maxIterations` 上限。
   *
   * @param task    - Task description.
   * @param context - Optional context key-values.
   */
  async runReAct(
    task: string,
    context?: Record<string, unknown>
  ): Promise<Omit<AgentRunResult, "durationMs">> {
    const maxIter = this.spec.controlLoop.maxIterations ?? 10;
    const systemPrompt = this.getPrompt("default");
    const phases: PhaseResult[] = [];

    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: context
          ? `${task}\n\nContext: ${JSON.stringify(context)}`
          : task,
      },
    ];

    let lastOutput = "";

    for (let i = 0; i < maxIter; i++) {
      const phaseStart = Date.now();
      const response = await this.llm.chat(messages);
      lastOutput = response;

      const toolCalls = extractToolCalls(response);

      const phaseToolResults: PhaseResult["toolCalls"] = [];

      if (toolCalls.length === 0) {
        // No more tool calls — the LLM has finished reasoning.
        phases.push({
          phaseId: `react-iter-${i}`,
          input: messages[messages.length - 1]!.content,
          output: response,
          toolCalls: [],
          durationMs: Date.now() - phaseStart,
        });
        break;
      }

      // Execute each tool call and collect observations.
      const observations: string[] = [];
      for (const call of toolCalls) {
        const result = await this.dispatcher.dispatchAs(this.spec.id, call);
        const obs = formatObservation(call.toolName, result);
        observations.push(obs);
        phaseToolResults.push({ tool: call.toolName, args: call.arguments, result });
      }

      phases.push({
        phaseId: `react-iter-${i}`,
        input: messages[messages.length - 1]!.content,
        output: response,
        toolCalls: phaseToolResults,
        durationMs: Date.now() - phaseStart,
      });

      // Feed observations back as an assistant + user turn.
      messages.push({ role: "assistant", content: response });
      messages.push({ role: "user", content: observations.join("\n") });
    }

    return { success: true, output: lastOutput, phases };
  }

  /**
   * **Plan-Execute** control loop.
   *
   * Executes three sequential phases using the corresponding `PromptPhase`
   * objects from `prompts.phases`:
   * 1. **planning** — Break the task into a structured plan.
   * 2. **execution** — Execute the plan (with tool calls if needed).
   * 3. **reflection** — Critically evaluate the result and suggest improvements.
   *
   * This directly models the Python example from the problem statement:
   * ```python
   * plan   = agent.chat(task,   system_prompts["planning"])
   * result = agent.chat(plan,   system_prompts["execution"])
   * review = agent.chat(result, system_prompts["reflection"])
   * ```
   *
   * **规划-执行** 控制循环。
   * 按顺序执行规划→执行→反思三个阶段，每个阶段使用对应的 `PromptPhase`。
   *
   * @param task    - Task description.
   * @param context - Optional context key-values.
   */
  async runPlanExecute(
    task: string,
    context?: Record<string, unknown>
  ): Promise<Omit<AgentRunResult, "durationMs">> {
    const phases: PhaseResult[] = [];
    const contextSuffix = context ? `\n\nContext: ${JSON.stringify(context)}` : "";

    // Phase 1: Planning
    const planPhase = await this.executePhase(
      "planning",
      task + contextSuffix,
      []
    );
    phases.push(planPhase);

    // Phase 2: Execution — uses the plan as input
    const execPhase = await this.executePhase(
      "execution",
      planPhase.output,
      []
    );
    phases.push(execPhase);

    // Phase 3: Reflection — evaluates the execution result
    const reflectPhase = await this.executePhase(
      "reflection",
      execPhase.output,
      []
    );
    phases.push(reflectPhase);

    return { success: true, output: reflectPhase.output, phases };
  }

  /**
   * **Reflect** control loop.
   *
   * Runs a Think → Act → Observe → Reflect sequence.  After each action the
   * LLM reflects on the quality of the result before continuing.
   *
   * **反思** 控制循环。
   * 执行 思考→行动→观察→反思 序列，每次行动后 LLM 对结果质量进行自我批评。
   *
   * @param task    - Task description.
   * @param context - Optional context key-values.
   */
  async runReflect(
    task: string,
    context?: Record<string, unknown>
  ): Promise<Omit<AgentRunResult, "durationMs">> {
    const maxIter = this.spec.controlLoop.maxIterations ?? 10;
    const phases: PhaseResult[] = [];
    const contextSuffix = context ? `\n\nContext: ${JSON.stringify(context)}` : "";

    let currentInput = task + contextSuffix;

    for (let i = 0; i < maxIter; i++) {
      // Think
      const thinkPhase = await this.executePhase(`think-${i}`, currentInput, []);
      phases.push(thinkPhase);

      // Act (extract and execute tool calls)
      const toolCalls = extractToolCalls(thinkPhase.output);
      if (toolCalls.length === 0) {
        // No tools — move straight to reflection
        const reflectPrompt = this.getPrompt("reflection");
        const reflectStart = Date.now();
        const reflectResponse = await this.llm.chat([
          { role: "system", content: reflectPrompt },
          { role: "user", content: thinkPhase.output },
        ]);
        phases.push({
          phaseId: `reflect-${i}`,
          input: thinkPhase.output,
          output: reflectResponse,
          toolCalls: [],
          durationMs: Date.now() - reflectStart,
        });
        return { success: true, output: reflectResponse, phases };
      }

      const observations: string[] = [];
      const actToolResults: PhaseResult["toolCalls"] = [];
      for (const call of toolCalls) {
        const result = await this.dispatcher.dispatchAs(this.spec.id, call);
        observations.push(formatObservation(call.toolName, result));
        actToolResults.push({ tool: call.toolName, args: call.arguments, result });
      }
      phases.push({
        phaseId: `act-${i}`,
        input: thinkPhase.output,
        output: observations.join("\n"),
        toolCalls: actToolResults,
        durationMs: 0,
      });

      // Reflect
      const reflectInput = [thinkPhase.output, ...observations].join("\n");
      const reflectPhase = await this.executePhase(`reflect-${i}`, reflectInput, []);
      phases.push(reflectPhase);

      // Continue with the reflection's output as next input
      currentInput = reflectPhase.output;
    }

    const lastOutput = phases[phases.length - 1]?.output ?? "";
    return { success: true, output: lastOutput, phases };
  }

  /**
   * **Custom** control loop.
   *
   * Walks through the `controlLoop.stages` array in order.  Each stage
   * specifies an action type and an optional `promptPhaseId` for prompt
   * selection.  Conditional routing (`next.if`) is evaluated at runtime.
   *
   * **自定义** 控制循环。
   * 按顺序遍历 `controlLoop.stages` 数组。每个阶段指定动作类型和可选的
   * `promptPhaseId`，条件路由（`next.if`）在运行时求值。
   *
   * @param task    - Task description.
   * @param context - Optional context key-values.
   */
  async runCustom(
    task: string,
    context?: Record<string, unknown>
  ): Promise<Omit<AgentRunResult, "durationMs">> {
    const stages = this.spec.controlLoop.stages ?? [];
    if (stages.length === 0) {
      // Fall back to ReAct when no custom stages are defined.
      return this.runReAct(task, context);
    }

    const phases: PhaseResult[] = [];
    const contextSuffix = context ? `\n\nContext: ${JSON.stringify(context)}` : "";
    let currentInput = task + contextSuffix;
    let stageIndex = 0;

    while (stageIndex < stages.length) {
      const stage = stages[stageIndex]!;
      const phaseId = stage.promptPhaseId ?? stage.id;

      let phaseOutput: string;
      let phaseToolCalls: PhaseResult["toolCalls"] = [];
      const phaseStart = Date.now();

      if (stage.action === "act") {
        // Act: extract + execute tool calls from the previous output
        const toolCalls = extractToolCalls(currentInput);
        const observations: string[] = [];
        for (const call of toolCalls) {
          const result = await this.dispatcher.dispatchAs(this.spec.id, call);
          observations.push(formatObservation(call.toolName, result));
          phaseToolCalls.push({ tool: call.toolName, args: call.arguments, result });
        }
        phaseOutput = observations.join("\n") || currentInput;
      } else if (stage.action === "delegate") {
        // Delegate: pass work to another agent via dispatcher
        const delegateCap = this.spec.toolBox.delegatedCapabilities?.[0];
        if (delegateCap) {
          const result = await this.dispatcher.dispatchAs(delegateCap.agentId, {
            toolName: "run",
            arguments: { task: currentInput },
          });
          phaseOutput = result.success
            ? JSON.stringify(result.output ?? result.data)
            : (result.error ?? "delegation failed");
          phaseToolCalls = [{ tool: "delegate", args: { task: currentInput }, result }];
        } else {
          phaseOutput = currentInput;
        }
      } else {
        // think / observe / reflect / summarize — call LLM
        const phaseResult = await this.executePhase(phaseId, currentInput, []);
        phaseOutput = phaseResult.output;
        phaseToolCalls = phaseResult.toolCalls;
      }

      phases.push({
        phaseId: stage.id,
        input: currentInput,
        output: phaseOutput,
        toolCalls: phaseToolCalls,
        durationMs: Date.now() - phaseStart,
      });

      currentInput = phaseOutput;

      // Routing
      if (!stage.next) {
        stageIndex++;
      } else if (typeof stage.next === "string") {
        const nextIdx = stages.findIndex((s) => s.id === stage.next);
        stageIndex = nextIdx >= 0 ? nextIdx : stages.length;
      } else {
        // Conditional routing — simplified: always take "then" branch for now.
        // TODO: evaluate stage.next.if against phaseOutput at runtime.
        const nextId = stage.next.then;
        const nextIdx = stages.findIndex((s) => s.id === nextId);
        stageIndex = nextIdx >= 0 ? nextIdx : stages.length;
      }
    }

    const lastOutput = phases[phases.length - 1]?.output ?? "";
    return { success: true, output: lastOutput, phases };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Execute a single prompt phase via the LLM adapter.
   * Resolves the system prompt from `prompts.phases[phaseId]` or falls back to
   * `prompts.default`.
   *
   * 通过 LLM 适配器执行单个提示阶段。
   * 从 `prompts.phases[phaseId]` 解析系统提示，若未找到则回退到 `prompts.default`。
   *
   * @param phaseId     - The phase to execute.
   * @param input       - User-turn content.
   * @param _priorPhases - Unused; reserved for future context threading.
   */
  private async executePhase(
    phaseId: string,
    input: string,
    _priorPhases: PhaseResult[]
  ): Promise<PhaseResult> {
    const phaseStart = Date.now();
    const systemPrompt = this.getPrompt(phaseId);

    const response = await this.llm.chat([
      { role: "system", content: systemPrompt },
      { role: "user", content: input },
    ]);

    return {
      phaseId,
      input,
      output: response,
      toolCalls: [],
      durationMs: Date.now() - phaseStart,
    };
  }

  /**
   * Resolve a system prompt by phase ID.
   *
   * Resolution order:
   * 1. `prompts.phases[phaseId].systemPrompt` (if phased mode and phase exists)
   * 2. `prompts.default` (fallback for all modes)
   * 3. `systemPrompt` (legacy field, backward-compat)
   * 4. `""` (empty string as last resort)
   *
   * 按阶段 ID 解析系统提示词。
   * 解析优先级：phases[phaseId] → default → systemPrompt（旧字段） → ""
   *
   * @param phaseId - Phase identifier or `"default"`.
   */
  getPrompt(phaseId: string): string {
    const phase = this.resolvePhase(phaseId);
    if (phase) return phase.systemPrompt;
    return this.spec.prompts.default ?? this.spec.systemPrompt ?? "";
  }

  /**
   * Resolve a `PromptPhase` by ID (or return `undefined` if not found).
   * 按 ID 解析 `PromptPhase`（未找到时返回 `undefined`）。
   */
  private resolvePhase(phaseId: string): PromptPhase | undefined {
    if (
      this.spec.prompts.mode === "single" ||
      phaseId === "default"
    ) {
      return undefined;
    }
    return this.spec.prompts.phases?.[phaseId];
  }
}
