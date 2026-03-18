/**
 * @file index.ts
 * @module src/core/agent
 *
 * Barrel export for the unified Agent specification module.
 *
 * 统一 Agent 规范模块的桶形导出文件。
 *
 * Usage / 使用方式:
 * ```ts
 * import { AgentSpec, AgentFactory, BaseAgent } from "./agent";
 * ```
 */

// ── Type definitions ──────────────────────────────────────────────────────────
export type {
  // Model
  ModelConfig,

  // Prompt strategy
  PromptPhase,
  PromptStrategy,

  // Tool box
  DelegatedCapability,
  ToolGuard,
  ToolBox,

  // Control loop
  ControlStage,
  ControlLoop,

  // Guardrails
  ContentFilter,
  HumanApprovalRule,
  CostLimits,
  AgentGuardrails,

  // The canonical spec
  AgentSpec,

  // Run results
  PhaseResult,
  AgentRunResult,

  // Validation
  ValidationResult,
} from "./AgentSpec";

// ── BaseAgent ─────────────────────────────────────────────────────────────────
export type { LLMAdapter, IDispatcher, ILifecycleManager } from "./BaseAgent";
export { BaseAgent } from "./BaseAgent";

// ── AgentFactory ──────────────────────────────────────────────────────────────
export type { AgentLegacyProfile, PhasedAgentConfig } from "./AgentFactory";
export { AgentFactory } from "./AgentFactory";
