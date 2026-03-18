/**
 * @file AgentFactory.ts
 * @module src/core/agent
 *
 * Backward-compatible factory utilities for creating and validating `AgentSpec`
 * instances from existing `AgentProfile` objects or scratch configurations.
 *
 * 用于从现有 `AgentProfile` 对象或新配置创建和验证 `AgentSpec` 实例的
 * 向下兼容工厂工具。
 *
 * Key methods / 主要方法:
 * - `AgentFactory.fromProfile()` — converts any legacy AgentProfile to AgentSpec
 * - `AgentFactory.createPhasedAgent()` — convenience factory for multi-phase agents
 * - `AgentFactory.validate()` — schema validation with helpful error messages
 */

import {
  AgentSpec,
  ModelConfig,
  PromptPhase,
  PromptStrategy,
  ToolBox,
  ControlLoop,
  AgentGuardrails,
  ValidationResult,
} from "./AgentSpec";

// ─── Legacy profile type ──────────────────────────────────────────────────────

/**
 * Loose union type that captures all fields ever present across the multiple
 * `AgentProfile` declarations in `src/core/types.ts`.  All fields except `id`
 * and `name` are optional to ensure maximum compatibility.
 *
 * 覆盖 `src/core/types.ts` 中所有 `AgentProfile` 声明字段的宽松联合类型。
 * 除 `id` 和 `name` 外所有字段均为可选，以确保最大兼容性。
 *
 * Using this local type (rather than importing from types.ts) insulates the
 * new module from the duplicate declarations in that file.
 * 使用本地类型（而非从 types.ts 导入）可以使新模块不受该文件中重复声明的影响。
 */
export interface AgentLegacyProfile {
  /** Required: unique agent identifier. */
  id: string;
  /** Required: human-readable display name. */
  name: string;

  // Common optional fields
  description?: string;
  sceneId?: string;
  enabled?: boolean;
  primarySkill?: string;
  secondarySkills?: string[];
  capabilities?: string[];
  constraints?: string[];

  // Routing
  intents?: string[];
  domains?: string[];
  languages?: string[];
  responseStyle?: "concise" | "detailed" | "bullet-points" | "markdown";

  // Legacy tool / delegation fields
  allowedServices?: string[];
  canDelegateTo?: string[];
  ownedServices?: string[];

  // Legacy prompt field
  systemPrompt?: string;

  // Lifecycle status (present in some AgentProfile shapes)
  status?: "initializing" | "active" | "busy" | "sleeping" | "retired";

  // Tool definitions (present in some AgentProfile shapes)
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

// ─── Phased agent creation config ─────────────────────────────────────────────

/**
 * Configuration object for `AgentFactory.createPhasedAgent()`.
 * `AgentFactory.createPhasedAgent()` 的配置对象。
 */
export interface PhasedAgentConfig {
  /** Unique agent identifier. */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** Optional description. */
  description?: string;
  /**
   * System prompts for each phase.
   * All three keys are required for a complete plan-execute-reflect cycle.
   * 各阶段的系统提示词。完整的规划-执行-反思循环要求提供全部三个键值。
   */
  phasePrompts: {
    /** Prompt for the planning phase. 规划阶段的提示词。 */
    planning: string;
    /** Prompt for the execution phase. 执行阶段的提示词。 */
    execution: string;
    /** Prompt for the reflection phase. 反思阶段的提示词。 */
    reflection: string;
    /** Any additional custom phases. 其他自定义阶段（可选）。 */
    [phaseId: string]: string;
  };
  /** Tool/service names available to this agent. 该 Agent 可用的工具/服务名称列表。 */
  directTools?: string[];
  /** LLM model configuration (optional). LLM 模型配置（可选）。 */
  model?: ModelConfig;
  /** Maximum plan-execute iterations. 最大规划-执行迭代次数。 @default 5 */
  maxIterations?: number;
  /** Optional guardrails. 可选的护栏配置。 */
  guardrails?: AgentGuardrails;
  /** Optional intents for routing. 用于路由的可选意图标签。 */
  intents?: string[];
  /** Optional domain tags. 可选的领域标签。 */
  domains?: string[];
}

// ─── AgentFactory ─────────────────────────────────────────────────────────────

/**
 * **AgentFactory** provides static utilities for creating and validating
 * `AgentSpec` instances.
 *
 * **AgentFactory** 提供创建和验证 `AgentSpec` 实例的静态工具方法。
 *
 * @example Converting a legacy profile:
 * ```ts
 * const profile: AgentProfile = { id: "bot", name: "Bot", systemPrompt: "...", allowedServices: ["search_web"] };
 * const spec = AgentFactory.fromProfile(profile);
 * // spec.prompts.mode === "single"
 * // spec.toolBox.directTools === ["search_web"]
 * ```
 *
 * @example Creating a phased agent from scratch:
 * ```ts
 * const spec = AgentFactory.createPhasedAgent({
 *   id: "research-bot",
 *   name: "Research Bot",
 *   phasePrompts: {
 *     planning:   "You are a strategic planner...",
 *     execution:  "You are a task executor...",
 *     reflection: "You are a critical reviewer...",
 *   },
 *   directTools: ["search_web", "crawl_page"],
 * });
 * ```
 */
export class AgentFactory {
  /**
   * Convert any existing `AgentProfile` object (or any object that conforms to
   * the `AgentLegacyProfile` shape) into a fully-formed `AgentSpec`.
   *
   * This ensures **zero breaking changes** — all existing `registerAgent()` calls
   * continue to work without modification.
   *
   * 将任何现有的 `AgentProfile` 对象（或符合 `AgentLegacyProfile` 形状的对象）
   * 转换为完整的 `AgentSpec`。
   * 确保**零破坏性变更**——所有现有的 `registerAgent()` 调用无需修改即可继续工作。
   *
   * Defaults applied when fields are absent / 缺失字段时应用的默认值:
   * - `prompts.mode` → `"single"` (backward-compatible single prompt)
   * - `controlLoop.mode` → `"react"`
   * - `controlLoop.maxIterations` → `10`
   * - `toolBox.directTools` → derives from `allowedServices` or `ownedServices`
   * - `toolBox.delegatedCapabilities` → derives from `canDelegateTo`
   *
   * @param profile  - Any legacy AgentProfile-compatible object.
   * @param defaults - Optional partial AgentSpec to deep-merge over the defaults.
   * @returns A complete `AgentSpec` ready for use with `BaseAgent`.
   */
  static fromProfile(
    profile: AgentLegacyProfile,
    defaults?: Partial<AgentSpec>
  ): AgentSpec {
    // Build PromptStrategy from the legacy systemPrompt field
    const prompts: PromptStrategy = defaults?.prompts ?? {
      mode: "single",
      default: profile.systemPrompt,
    };

    // Build ToolBox from legacy allowedServices / ownedServices / canDelegateTo
    const directTools =
      defaults?.toolBox?.directTools ??
      profile.allowedServices ??
      profile.ownedServices ??
      [];

    const delegatedCapabilities =
      defaults?.toolBox?.delegatedCapabilities ??
      (profile.canDelegateTo && profile.canDelegateTo.length > 0
        ? profile.canDelegateTo.map((agentId) => ({ agentId }))
        : undefined);

    const toolBox: ToolBox = defaults?.toolBox ?? {
      directTools,
      ...(delegatedCapabilities ? { delegatedCapabilities } : {}),
    };

    // Build ControlLoop with sensible defaults
    const controlLoop: ControlLoop = defaults?.controlLoop ?? {
      mode: "react",
      maxIterations: 10,
    };

    const spec: AgentSpec = {
      // ── Identity ───────────────────────────────────────────────────────────
      id: profile.id,
      name: profile.name,
      ...(profile.description !== undefined && { description: profile.description }),
      ...(profile.sceneId !== undefined && { sceneId: profile.sceneId }),
      ...(profile.enabled !== undefined && { enabled: profile.enabled }),
      ...(profile.primarySkill !== undefined && { primarySkill: profile.primarySkill }),
      ...(profile.secondarySkills !== undefined && { secondarySkills: profile.secondarySkills }),
      ...(profile.capabilities !== undefined && { capabilities: profile.capabilities }),
      ...(profile.constraints !== undefined && { constraints: profile.constraints }),

      // ── Routing ────────────────────────────────────────────────────────────
      ...(profile.intents !== undefined && { intents: profile.intents }),
      ...(profile.domains !== undefined && { domains: profile.domains }),
      ...(profile.languages !== undefined && { languages: profile.languages }),
      ...(profile.responseStyle !== undefined && { responseStyle: profile.responseStyle }),

      // ── New canonical fields ───────────────────────────────────────────────
      prompts,
      toolBox,
      controlLoop,

      // ── Legacy backward-compat fields ──────────────────────────────────────
      ...(profile.allowedServices !== undefined && { allowedServices: profile.allowedServices }),
      ...(profile.canDelegateTo !== undefined && { canDelegateTo: profile.canDelegateTo }),
      ...(profile.systemPrompt !== undefined && { systemPrompt: profile.systemPrompt }),
      ...(profile.status !== undefined && { status: profile.status }),
      ...(profile.ownedServices !== undefined && { ownedServices: profile.ownedServices }),
      ...(profile.tools !== undefined && { tools: profile.tools }),

      // Apply caller-supplied defaults last (lowest priority fields only)
      ...(defaults?.model !== undefined && { model: defaults.model }),
      ...(defaults?.guardrails !== undefined && { guardrails: defaults.guardrails }),
    };

    return spec;
  }

  /**
   * Convenience factory for the common multi-phase pattern.
   *
   * Creates an `AgentSpec` configured for `"plan-execute"` control loop with
   * `"phased"` prompt strategy matching the planning / execution / reflection
   * phases.  This directly implements the pattern from the problem statement:
   *
   * ```python
   * plan   = agent.chat(task,   system_prompts["planning"])
   * result = agent.chat(plan,   system_prompts["execution"])
   * review = agent.chat(result, system_prompts["reflection"])
   * ```
   *
   * 多阶段模式的便捷工厂方法。
   * 创建配置了 `"plan-execute"` 控制循环和 `"phased"` 提示策略的 `AgentSpec`，
   * 与问题描述中的规划/执行/反思模式直接对应。
   *
   * @param config - Phased agent configuration.
   * @returns A complete `AgentSpec` ready for use with `BaseAgent`.
   */
  static createPhasedAgent(config: PhasedAgentConfig): AgentSpec {
    // Build phases map from the phasePrompts config
    const phases: Record<string, PromptPhase> = {};
    for (const [phaseId, systemPrompt] of Object.entries(config.phasePrompts)) {
      phases[phaseId] = { phaseId, systemPrompt };
    }

    return {
      id: config.id,
      name: config.name,
      ...(config.description !== undefined && { description: config.description }),
      ...(config.intents !== undefined && { intents: config.intents }),
      ...(config.domains !== undefined && { domains: config.domains }),
      ...(config.model !== undefined && { model: config.model }),
      ...(config.guardrails !== undefined && { guardrails: config.guardrails }),

      prompts: {
        mode: "phased",
        phases,
      },

      toolBox: {
        directTools: config.directTools ?? [],
      },

      controlLoop: {
        mode: "plan-execute",
        maxIterations: config.maxIterations ?? 5,
      },
    };
  }

  /**
   * Validate an `AgentSpec` and return a `ValidationResult` describing any
   * errors or warnings found.
   *
   * Checks performed / 执行的检查:
   * 1. Required fields: `id`, `name`, `prompts`, `toolBox`, `controlLoop`.
   * 2. In `"phased"` mode, `prompts.phases` must be non-empty.
   * 3. In `"custom"` mode, `controlLoop.stages` must be non-empty.
   * 4. Every `controlLoop.stages[i].promptPhaseId` must reference an existing phase.
   * 5. No circular self-delegation (agent delegating to itself).
   * 6. `maxIterations` should be > 0 when provided.
   *
   * 验证 `AgentSpec` 并返回描述发现的错误或警告的 `ValidationResult`。
   *
   * @param spec - The AgentSpec to validate.
   * @returns `ValidationResult` with `valid`, `errors`, and `warnings` arrays.
   */
  static validate(spec: AgentSpec): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // 1. Required top-level fields
    if (!spec.id || spec.id.trim() === "") {
      errors.push("AgentSpec.id is required and must be a non-empty string.");
    }
    if (!spec.name || spec.name.trim() === "") {
      errors.push("AgentSpec.name is required and must be a non-empty string.");
    }
    if (!spec.prompts) {
      errors.push("AgentSpec.prompts is required.");
    }
    if (!spec.toolBox) {
      errors.push("AgentSpec.toolBox is required.");
    }
    if (!spec.controlLoop) {
      errors.push("AgentSpec.controlLoop is required.");
    }

    // Early exit if required fields are missing
    if (errors.length > 0) {
      return { valid: false, errors, warnings };
    }

    // 2. Phased mode — phases must be present and non-empty
    if (spec.prompts.mode === "phased") {
      const phases = spec.prompts.phases;
      if (!phases || Object.keys(phases).length === 0) {
        errors.push(
          'prompts.mode is "phased" but prompts.phases is empty or missing.'
        );
      }
    }

    // 3. Custom control loop — stages must be present and non-empty
    if (spec.controlLoop.mode === "custom") {
      if (!spec.controlLoop.stages || spec.controlLoop.stages.length === 0) {
        errors.push(
          'controlLoop.mode is "custom" but controlLoop.stages is empty or missing.'
        );
      }
    }

    // 4. Dangling phase references in custom stages
    if (spec.controlLoop.stages && spec.prompts.phases) {
      const definedPhaseIds = new Set(Object.keys(spec.prompts.phases));
      for (const stage of spec.controlLoop.stages) {
        if (
          stage.promptPhaseId &&
          !definedPhaseIds.has(stage.promptPhaseId)
        ) {
          errors.push(
            `controlLoop.stages["${stage.id}"].promptPhaseId "${stage.promptPhaseId}" ` +
              `does not reference an existing phase in prompts.phases.`
          );
        }
      }
    }

    // 5. No circular self-delegation
    if (spec.toolBox.delegatedCapabilities) {
      for (const cap of spec.toolBox.delegatedCapabilities) {
        if (cap.agentId === spec.id) {
          errors.push(
            `toolBox.delegatedCapabilities contains a self-delegation: ` +
              `agent "${spec.id}" delegates to itself.`
          );
        }
      }
    }

    // Legacy canDelegateTo self-delegation check
    if (spec.canDelegateTo?.includes(spec.id)) {
      errors.push(
        `canDelegateTo contains a self-delegation: agent "${spec.id}" delegates to itself.`
      );
    }

    // 6. maxIterations sanity check
    if (
      spec.controlLoop.maxIterations !== undefined &&
      spec.controlLoop.maxIterations <= 0
    ) {
      errors.push(
        `controlLoop.maxIterations must be greater than 0 ` +
          `(got ${spec.controlLoop.maxIterations}).`
      );
    }

    // Warnings (non-blocking)
    if (!spec.prompts.default && spec.prompts.mode === "single") {
      warnings.push(
        'prompts.default is not set for mode "single". The agent will use an empty system prompt.'
      );
    }

    if (spec.toolBox.directTools.length === 0 && !spec.toolBox.delegatedCapabilities?.length) {
      warnings.push(
        "toolBox has no directTools and no delegatedCapabilities. The agent cannot use any tools."
      );
    }

    if (spec.controlLoop.mode === "plan-execute" && spec.prompts.mode !== "phased") {
      warnings.push(
        'controlLoop.mode is "plan-execute" but prompts.mode is not "phased". ' +
          "Planning/execution/reflection prompts will fall back to prompts.default."
      );
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }
}
