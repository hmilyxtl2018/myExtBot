/**
 * @file AgentSpec.ts
 * @module src/core/agent
 *
 * Canonical type definitions for the unified Agent specification.
 *
 * Agent = Identity + Model + PromptStrategy + ToolBox + ControlLoop + Guardrails
 *
 * 统一的 Agent 规范类型定义。
 * Agent = 身份标识 + 模型配置 + 提示策略 + 工具箱 + 控制循环 + 护栏
 *
 * Design principles / 设计原则:
 * - 100% backward-compatible superset of all existing AgentProfile shapes.
 *   向下兼容所有现有 AgentProfile 类型定义的超集。
 * - New fields are optional so legacy profiles continue to work without changes.
 *   新字段均为可选，现有 Profile 无需任何改动即可继续使用。
 * - Single source of truth — import types from here, not from types.ts.
 *   单一可信来源 — 从本模块导入类型，而非 types.ts。
 */

// ─── Model Configuration ─────────────────────────────────────────────────────

/**
 * LLM model configuration for an agent.
 * 用于驱动 Agent 的 LLM 模型配置。
 */
export interface ModelConfig {
  /**
   * LLM provider name (e.g. "openai", "anthropic", "local").
   * LLM 提供商名称（例如 "openai", "anthropic", "local"）。
   */
  provider: string;

  /**
   * Specific model/deployment name (e.g. "gpt-4o", "claude-3-5-sonnet-20241022").
   * 具体模型或部署名称（例如 "gpt-4o", "claude-3-5-sonnet-20241022"）。
   */
  modelName: string;

  /**
   * Sampling temperature (0–2). Lower = more deterministic.
   * 采样温度（0–2），值越低输出越确定。
   * @default 0.7
   */
  temperature?: number;

  /**
   * Maximum number of tokens to generate in one completion.
   * 单次生成的最大 token 数。
   */
  maxTokens?: number;

  /**
   * Custom API endpoint, used for self-hosted or proxy deployments.
   * 自定义 API 端点，用于自托管或代理部署。
   */
  endpoint?: string;
}

// ─── Prompt Strategy ─────────────────────────────────────────────────────────

/**
 * A single prompt phase used in multi-phase reasoning pipelines.
 * 多阶段推理流水线中的单个提示阶段。
 *
 * @example
 * ```ts
 * const planningPhase: PromptPhase = {
 *   phaseId: "planning",
 *   systemPrompt: "You are a strategic planner. Break the task into clear steps.",
 *   temperature: 0.3,
 *   maxTokens: 512,
 * };
 * ```
 */
export interface PromptPhase {
  /** Unique identifier for this phase (e.g. "planning", "execution", "reflection"). */
  phaseId: string;

  /**
   * System prompt injected to the LLM for this phase.
   * 该阶段注入到 LLM 的系统提示词。
   */
  systemPrompt: string;

  /**
   * Phase-specific sampling temperature (overrides the model-level temperature).
   * 阶段级采样温度（覆盖模型级温度设置）。
   */
  temperature?: number;

  /**
   * Tool names allowed during this phase. If omitted, inherits from the agent's ToolBox.
   * 该阶段允许使用的工具名称。省略时继承 Agent ToolBox 的配置。
   */
  allowedTools?: string[];

  /**
   * Phase-specific max tokens (overrides the model-level maxTokens).
   * 阶段级最大 token 数（覆盖模型级设置）。
   */
  maxTokens?: number;
}

/**
 * Prompt strategy for the agent — supports single (legacy), phased, and adaptive modes.
 * Agent 的提示策略 — 支持单一（兼容旧版）、多阶段和自适应三种模式。
 *
 * @example Single mode (backward-compatible):
 * ```ts
 * { mode: "single", default: "You are a helpful assistant." }
 * ```
 *
 * @example Phased mode (plan → execute → reflect):
 * ```ts
 * {
 *   mode: "phased",
 *   phases: {
 *     planning:   { phaseId: "planning",   systemPrompt: "You are a strategic planner..." },
 *     execution:  { phaseId: "execution",  systemPrompt: "You are a task executor..."    },
 *     reflection: { phaseId: "reflection", systemPrompt: "You are a critical reviewer..." },
 *   },
 * }
 * ```
 */
export interface PromptStrategy {
  /**
   * Prompt operating mode:
   * - `"single"` — one system prompt for all interactions (backward-compatible).
   * - `"phased"` — distinct prompts per named phase (planning/execution/reflection).
   * - `"adaptive"` — runtime selects the appropriate prompt based on context.
   *
   * 提示运行模式：
   * - `"single"` — 所有交互使用同一系统提示（向下兼容）
   * - `"phased"` — 每个命名阶段使用独立提示（规划/执行/反思）
   * - `"adaptive"` — 运行时根据上下文自动选择合适的提示
   */
  mode: "single" | "phased" | "adaptive";

  /**
   * Default system prompt used in `"single"` mode or as the fallback in other modes.
   * 在 `"single"` 模式下使用的默认系统提示，或在其他模式中作为回退提示。
   */
  default?: string;

  /**
   * Named phases, keyed by `phaseId`.  Required when `mode === "phased"`.
   * 按 `phaseId` 键值存储的命名阶段。`mode === "phased"` 时必须提供。
   */
  phases?: Record<string, PromptPhase>;
}

// ─── Tool Box ─────────────────────────────────────────────────────────────────

/**
 * Describes a capability that this agent can delegate to another agent.
 * 描述当前 Agent 可委派给其他 Agent 的能力。
 */
export interface DelegatedCapability {
  /**
   * The ID of the target agent to delegate to.
   * 委派目标 Agent 的 ID。
   */
  agentId: string;

  /**
   * Specific tool names that may be delegated (omit to allow all tools of the target).
   * 允许委派的特定工具名称列表（省略则允许目标 Agent 的全部工具）。
   */
  tools?: string[];
}

/**
 * Per-tool guardrail configuration.
 * 单个工具的护栏配置。
 */
export interface ToolGuard {
  /** The tool name this guard applies to. 此护栏适用的工具名称。 */
  toolName: string;

  /**
   * When true, a human must approve this tool call before it executes.
   * 为 true 时，工具调用执行前须经人工审批。
   * @default false
   */
  requiresApproval?: boolean;

  /**
   * JSON Schema constraints for the tool's input arguments.
   * 工具输入参数的 JSON Schema 约束。
   */
  inputConstraints?: Record<string, unknown>;

  /**
   * Rate limit applied specifically to this tool.
   * 针对此工具的独立限速配置。
   */
  rateLimit?: {
    /** Maximum number of calls per minute. 每分钟最大调用次数。 */
    maxCallsPerMinute: number;
  };
}

/**
 * The agent's tool configuration — replaces the loose `allowedServices` + `canDelegateTo`
 * fields with a structured, guarded capability model.
 *
 * Agent 工具配置 — 用结构化的能力模型替代原有松散的
 * `allowedServices` + `canDelegateTo` 字段。
 */
export interface ToolBox {
  /**
   * Names of tools/services this agent can invoke directly.
   * 该 Agent 可直接调用的工具/服务名称列表。
   */
  directTools: string[];

  /**
   * Other agents this agent can delegate tasks to, with optional tool scoping.
   * 该 Agent 可委派任务的其他 Agent 列表，可选地限定委派的工具范围。
   */
  delegatedCapabilities?: DelegatedCapability[];

  /**
   * Per-tool guardrail rules (approval, schema validation, rate limiting).
   * 工具级护栏规则（人工审批、Schema 验证、限速）。
   */
  guards?: ToolGuard[];
}

// ─── Control Loop ─────────────────────────────────────────────────────────────

/**
 * A single stage within a custom control loop.
 * 自定义控制循环中的单个执行阶段。
 */
export interface ControlStage {
  /** Unique stage identifier. 唯一阶段标识符。 */
  id: string;

  /**
   * The action performed in this stage:
   * - `"think"` — pure reasoning (no tool calls)
   * - `"act"` — execute one or more tool calls
   * - `"observe"` — process tool results
   * - `"reflect"` — evaluate quality / self-critique
   * - `"delegate"` — hand off to another agent
   * - `"summarize"` — produce the final answer
   *
   * 该阶段执行的动作：
   * - `"think"` — 纯推理（无工具调用）
   * - `"act"` — 执行一个或多个工具调用
   * - `"observe"` — 处理工具返回结果
   * - `"reflect"` — 评估质量/自我批评
   * - `"delegate"` — 委派给其他 Agent
   * - `"summarize"` — 生成最终答案
   */
  action: "think" | "act" | "observe" | "reflect" | "delegate" | "summarize";

  /**
   * The `PromptPhase` ID to use for this stage (must exist in `prompts.phases`).
   * 该阶段使用的 `PromptPhase` ID（必须存在于 `prompts.phases` 中）。
   */
  promptPhaseId?: string;

  /**
   * Next stage routing:
   * - `string` — unconditional next stage ID
   * - `{ if, then, else }` — conditional routing (condition is evaluated at runtime)
   *
   * 下一阶段路由：
   * - `string` — 无条件跳转到指定阶段
   * - `{ if, then, else }` — 条件路由（条件在运行时求值）
   */
  next?: string | { if: string; then: string; else: string };
}

/**
 * The agent's internal think-act cycle definition.
 * Agent 内部思考-行动循环的定义。
 *
 * @example ReAct mode:
 * ```ts
 * { mode: "react", maxIterations: 10 }
 * ```
 *
 * @example Plan-Execute mode (maps to planning → execution → reflection phases):
 * ```ts
 * { mode: "plan-execute", maxIterations: 5 }
 * ```
 */
export interface ControlLoop {
  /**
   * Loop operating mode:
   * - `"react"` — classic Reason + Act loop (LLM decides when to call tools)
   * - `"plan-execute"` — structured plan → execute → reflect sequence
   * - `"reflect"` — think → act → observe → reflect with self-critique
   * - `"custom"` — walks through the explicit `stages` array
   *
   * 循环运行模式：
   * - `"react"` — 经典推理+行动循环（LLM 自主决定何时调用工具）
   * - `"plan-execute"` — 结构化 规划→执行→反思 序列
   * - `"reflect"` — 思考→行动→观察→反思的自我批评循环
   * - `"custom"` — 按显式 `stages` 数组执行
   */
  mode: "react" | "plan-execute" | "reflect" | "custom";

  /**
   * Maximum number of think-act iterations before the loop terminates.
   * 循环在强制结束前允许的最大思考-行动迭代次数。
   * @default 10
   */
  maxIterations?: number;

  /**
   * Ordered stage definitions (required when `mode === "custom"`).
   * 有序的阶段定义（`mode === "custom"` 时必须提供）。
   */
  stages?: ControlStage[];

  /**
   * Natural-language conditions that, when met, terminate the loop early.
   * 自然语言终止条件，满足时提前结束循环。
   */
  terminationConditions?: string[];
}

// ─── Guardrails ───────────────────────────────────────────────────────────────

/**
 * A content filter applied to agent inputs or outputs.
 * 应用于 Agent 输入或输出的内容过滤器。
 */
export interface ContentFilter {
  /** Filter strategy: regular expression, keyword list, or semantic similarity. */
  type: "regex" | "keyword" | "semantic";
  /** Patterns or keywords to match against. */
  patterns: string[];
  /** Action to take when the filter matches. */
  action: "block" | "warn" | "sanitize";
}

/**
 * A rule that requires human approval before certain tools are invoked.
 * 某些工具调用前要求人工审批的规则。
 */
export interface HumanApprovalRule {
  /** Tool names that require approval. 需要审批的工具名称列表。 */
  tools: string[];
  /** Optional runtime condition (expression evaluated at call time). */
  condition?: string;
}

/**
 * Cost caps for the agent.
 * Agent 的成本上限。
 */
export interface CostLimits {
  /** Maximum USD cost allowed per individual tool call. */
  maxCostPerCall?: number;
  /** Maximum cumulative USD cost allowed per day. */
  maxDailyCost?: number;
}

/**
 * Safety and compliance guardrails for the agent.
 * Agent 的安全与合规护栏配置。
 */
export interface AgentGuardrails {
  /** Filters applied to the user's input before it reaches the LLM. */
  inputFilters?: ContentFilter[];
  /** Filters applied to the LLM's output before it is returned to the caller. */
  outputFilters?: ContentFilter[];
  /** Rules requiring human approval for sensitive tool calls. */
  humanInTheLoop?: HumanApprovalRule[];
  /** Hard cost limits. */
  costLimits?: CostLimits;
}

// ─── AgentSpec — The canonical Agent definition ───────────────────────────────

/**
 * **AgentSpec** is the single source of truth for what an Agent *is*.
 *
 * It is a superset of all existing `AgentProfile` shapes and is 100% backward-
 * compatible — any code that previously used `AgentProfile` can continue to work
 * without modification via `AgentFactory.fromProfile()`.
 *
 * **AgentSpec** 是描述 Agent 的唯一可信来源。
 * 它是所有现有 `AgentProfile` 类型的超集，并保持 100% 向下兼容——
 * 所有使用 `AgentProfile` 的现有代码无需修改，通过 `AgentFactory.fromProfile()`
 * 即可继续正常运行。
 *
 * ```
 * AgentSpec = Identity + Model + PromptStrategy + ToolBox + ControlLoop + Guardrails
 * ```
 *
 * @example
 * ```ts
 * const myAgent: AgentSpec = {
 *   id: "research-bot",
 *   name: "Research Bot",
 *   prompts: {
 *     mode: "phased",
 *     phases: {
 *       planning:   { phaseId: "planning",   systemPrompt: "You are a strategic planner..." },
 *       execution:  { phaseId: "execution",  systemPrompt: "You are a task executor..."    },
 *       reflection: { phaseId: "reflection", systemPrompt: "You are a critical reviewer..." },
 *     },
 *   },
 *   toolBox: { directTools: ["search_web", "crawl_page"] },
 *   controlLoop: { mode: "plan-execute", maxIterations: 5 },
 * };
 * ```
 */
export interface AgentSpec {
  // ── Identity ───────────────────────────────────────────────────────────────

  /** Unique identifier for this agent (e.g. "research-bot"). 唯一 Agent 标识符。 */
  id: string;

  /** Human-readable display name. 人类可读的显示名称。 */
  name: string;

  /** Optional description of the agent's purpose or persona. 可选的功能或人设描述。 */
  description?: string;

  /** Scene (context/environment) this agent is associated with. 关联的场景（上下文/环境）。 */
  sceneId?: string;

  /** Whether this agent is active and available for routing. 该 Agent 是否处于激活状态。 */
  enabled?: boolean;

  // ── Capability metadata ───────────────────────────────────────────────────

  /** The agent's single most important skill. Agent 最核心的单一技能。 */
  primarySkill?: string;

  /** Supporting skills, listed in priority order. 辅助技能列表，按优先级排序。 */
  secondarySkills?: string[];

  /**
   * High-level capabilities expressed as action phrases (shown in discovery UIs).
   * 以动作短语表达的高层能力（显示在发现/目录 UI 中）。
   */
  capabilities?: string[];

  /**
   * Hard limits or behavioural constraints the agent must NOT violate.
   * Agent 必须遵守的硬性限制或行为约束。
   */
  constraints?: string[];

  // ── Routing metadata ──────────────────────────────────────────────────────

  /**
   * Intent tags used by AgentRouter for automatic routing.
   * AgentRouter 用于自动路由的意图标签。
   */
  intents?: string[];

  /**
   * High-level domain tags (coarser-grained than intents).
   * 高层领域标签（比意图标签粒度更粗）。
   */
  domains?: string[];

  /** Languages this agent is proficient in. 该 Agent 擅长的语言列表。 */
  languages?: string[];

  /** Preferred response format / style. 首选回复格式/风格。 */
  responseStyle?: "concise" | "detailed" | "bullet-points" | "markdown";

  // ── New canonical fields ──────────────────────────────────────────────────

  /**
   * LLM model to use for this agent. When omitted, the runtime default model is used.
   * 该 Agent 使用的 LLM 模型配置。省略时使用运行时默认模型。
   */
  model?: ModelConfig;

  /**
   * Prompt strategy — single system prompt or multi-phase prompts.
   * 提示策略 — 单一系统提示或多阶段提示。
   */
  prompts: PromptStrategy;

  /**
   * Tool configuration — direct tools + delegation + per-tool guards.
   * 工具配置 — 直接工具 + 委派能力 + 工具级护栏。
   */
  toolBox: ToolBox;

  /**
   * Internal think-act cycle definition.
   * 内部思考-行动循环定义。
   */
  controlLoop: ControlLoop;

  /**
   * Optional safety and compliance guardrails.
   * 可选的安全与合规护栏配置。
   */
  guardrails?: AgentGuardrails;

  // ── Legacy backward-compat fields ─────────────────────────────────────────
  // These mirror the fields on existing AgentProfile shapes so that code using
  // AgentSpec can read them directly without going through the new fields.
  // 以下字段镜像现有 AgentProfile 的字段，使使用 AgentSpec 的代码可以直接读取，
  // 无需通过新字段间接获取。

  /**
   * @deprecated Use `toolBox.directTools` instead.
   * 请使用 `toolBox.directTools` 代替。
   */
  allowedServices?: string[];

  /**
   * @deprecated Use `toolBox.delegatedCapabilities` instead.
   * 请使用 `toolBox.delegatedCapabilities` 代替。
   */
  canDelegateTo?: string[];

  /**
   * @deprecated Use `prompts.default` instead.
   * 请使用 `prompts.default` 代替。
   */
  systemPrompt?: string;

  /** Agent lifecycle status (used by AgentLifecycleManager). Agent 生命周期状态。 */
  status?: "initializing" | "active" | "busy" | "sleeping" | "retired";

  /** Services owned/provided by this agent. 该 Agent 拥有/提供的服务列表。 */
  ownedServices?: string[];

  /**
   * Tool definitions exposed by this agent.
   * 该 Agent 对外暴露的工具定义列表。
   */
  tools?: Array<{
    name: string;
    description: string;
    serviceName?: string;
    inputSchema?: Record<string, unknown>;
    parameters?: {
      type: "object";
      properties: Record<string, { type: string; description: string; enum?: string[]; default?: unknown }>;
      required?: string[];
    };
  }>;
}

// ─── Run result types ─────────────────────────────────────────────────────────

/**
 * The result of a single phase execution within a control loop.
 * 控制循环中单个阶段执行的结果。
 */
export interface PhaseResult {
  /** Phase identifier. 阶段标识符。 */
  phaseId: string;
  /** Raw input passed to this phase. 传入该阶段的原始输入。 */
  input: string;
  /** LLM output for this phase. 该阶段的 LLM 输出。 */
  output: string;
  /** Tool calls made during this phase. 该阶段进行的工具调用记录。 */
  toolCalls: Array<{
    tool: string;
    args: Record<string, unknown>;
    result: unknown;
  }>;
  /** Wall-clock time for this phase in milliseconds. 该阶段的实际耗时（毫秒）。 */
  durationMs: number;
}

/**
 * The result returned by `BaseAgent.run()`.
 * `BaseAgent.run()` 返回的结果结构。
 */
export interface AgentRunResult {
  /** Whether the overall run succeeded. 本次运行是否成功。 */
  success: boolean;
  /** The final output string produced by the agent. Agent 产生的最终输出字符串。 */
  output: string;
  /** Error message if `success === false`. 失败时的错误信息。 */
  error?: string;
  /** Total wall-clock time in milliseconds. 总实际耗时（毫秒）。 */
  durationMs: number;
  /** Full trace of each phase executed. 每个执行阶段的完整追踪记录。 */
  phases: PhaseResult[];
}

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * Result returned by `AgentFactory.validate()`.
 * `AgentFactory.validate()` 返回的验证结果。
 */
export interface ValidationResult {
  /** `true` if the spec passed all validation checks. 规范通过所有验证检查时为 `true`。 */
  valid: boolean;
  /**
   * List of validation errors (empty when `valid === true`).
   * 验证错误列表（`valid === true` 时为空数组）。
   */
  errors: string[];
  /**
   * Non-blocking warnings that do not prevent the agent from running.
   * 不阻止 Agent 运行的非阻塞警告信息。
   */
  warnings: string[];
}
