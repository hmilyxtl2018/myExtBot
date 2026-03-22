/**
 * AgentSpec runtime validator — 9-Pillar schema enforcement.
 *
 * Usage:
 *   const result = validateAgentSpec(spec, existingAgentIds);
 *   if (!result.valid) throw new Error(result.errors.join("; "));
 */

import { SUPPORTED_SPEC_VERSIONS, CURRENT_SPEC_VERSION } from "./types";

/** Valid control-loop execution strategies (Pillar 2). */
export const VALID_CONTROL_LOOP_TYPES = [
  "plan-act",
  "react",
  "reflexion",
  "custom",
] as const;

export type ControlLoopType = (typeof VALID_CONTROL_LOOP_TYPES)[number];

/** Result returned by validateAgentSpec. */
export interface AgentSpecValidationResult {
  valid: boolean;
  errors: string[];
}

// ── Version-dispatch table ─────────────────────────────────────────────────────

/**
 * Maps each supported specVersion to its core validator function.
 * When a new version is introduced, add a new entry here.
 */
const VALIDATORS: Record<
  string,
  (s: Record<string, unknown>, existingAgentIds: string[]) => string[]
> = {
  "1.0": validateV1,
};

/**
 * Core 9-pillar validator for specVersion "1.0".
 * Extracted so it can be referenced in the dispatch table above.
 */
function validateV1(
  s: Record<string, unknown>,
  existingAgentIds: string[]
): string[] {
  const errors: string[] = [];

  // ── Pillar 1 — Identity ──────────────────────────────────────────────────
  if (typeof s["id"] !== "string" || s["id"].trim() === "") {
    errors.push("Pillar 1: id must be a non-empty string");
  }
  if (typeof s["name"] !== "string" || s["name"].trim() === "") {
    errors.push("Pillar 1: name must be a non-empty string");
  }
  if (s["version"] !== undefined) {
    if (typeof s["version"] !== "string" || s["version"].trim() === "") {
      errors.push("Pillar 1: version must be a non-empty string if present");
    }
  }

  // ── Pillar 2 — Control Loop ──────────────────────────────────────────────
  if (s["controlLoop"] !== undefined) {
    if (!s["controlLoop"] || typeof s["controlLoop"] !== "object" || Array.isArray(s["controlLoop"])) {
      errors.push("Pillar 2: controlLoop must be an object if present");
    } else {
      const cl = s["controlLoop"] as Record<string, unknown>;
      if (!VALID_CONTROL_LOOP_TYPES.includes(cl["type"] as ControlLoopType)) {
        errors.push(
          `Pillar 2: controlLoop.type must be one of [${VALID_CONTROL_LOOP_TYPES.join(", ")}]; got "${String(cl["type"])}"`
        );
      }
    }
  }

  // ── Pillar 3 — Tools ────────────────────────────────────────────────────
  if (s["tools"] !== undefined) {
    if (!Array.isArray(s["tools"])) {
      errors.push("Pillar 3: tools must be an array if present");
    } else {
      (s["tools"] as unknown[]).forEach((tool, i) => {
        if (!tool || typeof tool !== "object") {
          errors.push(`Pillar 3: tools[${i}] must be an object`);
        } else {
          const t = tool as Record<string, unknown>;
          if (typeof t["name"] !== "string" || t["name"].trim() === "") {
            errors.push(`Pillar 3: tools[${i}].name must be a non-empty string`);
          }
        }
      });
    }
  }

  // ── Pillar 4 — Guardrails ────────────────────────────────────────────────
  if (s["guardrails"] !== undefined) {
    if (!s["guardrails"] || typeof s["guardrails"] !== "object" || Array.isArray(s["guardrails"])) {
      errors.push("Pillar 4: guardrails must be an object if present");
    } else {
      const g = s["guardrails"] as Record<string, unknown>;
      if (g["maxTokensPerCall"] !== undefined) {
        if (typeof g["maxTokensPerCall"] !== "number" || g["maxTokensPerCall"] <= 0) {
          errors.push("Pillar 4: guardrails.maxTokensPerCall must be a positive number if present");
        }
      }
      if (g["maxCostPerCall"] !== undefined) {
        if (typeof g["maxCostPerCall"] !== "number" || g["maxCostPerCall"] <= 0) {
          errors.push("Pillar 4: guardrails.maxCostPerCall must be a positive number if present");
        }
      }
      if (g["requireHumanApproval"] !== undefined && typeof g["requireHumanApproval"] !== "boolean") {
        errors.push("Pillar 4: guardrails.requireHumanApproval must be a boolean if present");
      }
      if (g["maxCostPerTask"] !== undefined) {
        if (typeof g["maxCostPerTask"] !== "number" || g["maxCostPerTask"] <= 0) {
          errors.push("Pillar 4: guardrails.maxCostPerTask must be a positive number if present");
        }
      }
      if (g["approvalRequiredTools"] !== undefined) {
        if (!Array.isArray(g["approvalRequiredTools"])) {
          errors.push("Pillar 4: guardrails.approvalRequiredTools must be an array if present");
        } else {
          (g["approvalRequiredTools"] as unknown[]).forEach((tool, i) => {
            if (typeof tool !== "string") {
              errors.push(`Pillar 4: guardrails.approvalRequiredTools[${i}] must be a string`);
            }
          });
        }
      }
      if (g["bannedPatterns"] !== undefined) {
        if (!Array.isArray(g["bannedPatterns"])) {
          errors.push("Pillar 4: guardrails.bannedPatterns must be an array if present");
        } else {
          (g["bannedPatterns"] as unknown[]).forEach((pat, i) => {
            if (typeof pat !== "string") {
              errors.push(`Pillar 4: guardrails.bannedPatterns[${i}] must be a string`);
            } else {
              try {
                new RegExp(pat);
              } catch {
                errors.push(
                  `Pillar 4: guardrails.bannedPatterns[${i}] is not a valid regex: "${pat}"`
                );
              }
            }
          });
        }
      }
    }
  }

  // ── Pillar 5 — Prompts ──────────────────────────────────────────────────
  if (s["prompts"] !== undefined) {
    if (!s["prompts"] || typeof s["prompts"] !== "object" || Array.isArray(s["prompts"])) {
      errors.push("Pillar 5: prompts must be an object if present");
    } else {
      const p = s["prompts"] as Record<string, unknown>;
      if (p["system"] !== undefined && typeof p["system"] !== "string") {
        errors.push("Pillar 5: prompts.system must be a string if present");
      }
      if (p["preamble"] !== undefined && typeof p["preamble"] !== "string") {
        errors.push("Pillar 5: prompts.preamble must be a string if present");
      }
      if (p["suffix"] !== undefined && typeof p["suffix"] !== "string") {
        errors.push("Pillar 5: prompts.suffix must be a string if present");
      }
    }
  }

  // ── Pillar 6 — Intent & Persona ──────────────────────────────────────────
  if (s["intents"] !== undefined) {
    if (!Array.isArray(s["intents"])) {
      errors.push("Pillar 6: intents must be an array if present");
    } else {
      (s["intents"] as unknown[]).forEach((intent, i) => {
        if (typeof intent !== "string") {
          errors.push(`Pillar 6: intents[${i}] must be a string`);
        }
      });
    }
  }
  if (s["domains"] !== undefined) {
    if (!Array.isArray(s["domains"])) {
      errors.push("Pillar 6: domains must be an array if present");
    } else {
      (s["domains"] as unknown[]).forEach((domain, i) => {
        if (!domain || typeof domain !== "object") {
          errors.push(
            `Pillar 6: domains[${i}] must be an object with name (string) and score (number 0–1)`
          );
        } else {
          const d = domain as Record<string, unknown>;
          if (typeof d["name"] !== "string") {
            errors.push(`Pillar 6: domains[${i}].name must be a string`);
          }
          if (
            typeof d["score"] !== "number" ||
            d["score"] < 0 ||
            d["score"] > 1
          ) {
            errors.push(`Pillar 6: domains[${i}].score must be a number between 0 and 1`);
          }
        }
      });
    }
  }

  // ── Pillar 7 — Communication ─────────────────────────────────────────────
  if (s["communication"] !== undefined) {
    if (!s["communication"] || typeof s["communication"] !== "object" || Array.isArray(s["communication"])) {
      errors.push("Pillar 7: communication must be an object if present");
    } else {
      const comm = s["communication"] as Record<string, unknown>;

      // canDelegateTo: array of strings (no registry lookup required)
      if (comm["canDelegateTo"] !== undefined) {
        if (!Array.isArray(comm["canDelegateTo"])) {
          errors.push("Pillar 7: communication.canDelegateTo must be an array if present");
        } else {
          (comm["canDelegateTo"] as unknown[]).forEach((target, i) => {
            if (typeof target !== "string") {
              errors.push(`Pillar 7: communication.canDelegateTo[${i}] must be a string`);
            }
          });
        }
      }

      // delegationTargets: must reference valid registered agent IDs or "*"
      if (comm["delegationTargets"] !== undefined) {
        if (!Array.isArray(comm["delegationTargets"])) {
          errors.push(
            "Pillar 7: communication.delegationTargets must be an array if present"
          );
        } else {
          (comm["delegationTargets"] as unknown[]).forEach((targetId, i) => {
            if (typeof targetId !== "string") {
              errors.push(
                `Pillar 7: communication.delegationTargets[${i}] must be a string`
              );
            } else if (targetId !== "*" && !existingAgentIds.includes(targetId)) {
              errors.push(
                `Pillar 7: communication.delegationTargets[${i}] references unknown agent "${targetId}"`
              );
            }
          });
        }
      }
    }
  }

  // ── Pillar 8 — Orchestration ─────────────────────────────────────────────
  if (s["orchestration"] !== undefined) {
    if (!s["orchestration"] || typeof s["orchestration"] !== "object" || Array.isArray(s["orchestration"])) {
      errors.push("Pillar 8: orchestration must be an object if present");
    } else {
      const orch = s["orchestration"] as Record<string, unknown>;
      if (orch["priority"] !== undefined) {
        if (typeof orch["priority"] !== "number" || orch["priority"] < 0) {
          errors.push(
            "Pillar 8: orchestration.priority must be a non-negative number if present"
          );
        }
      }
      if (orch["maxConcurrency"] !== undefined) {
        if (
          typeof orch["maxConcurrency"] !== "number" ||
          !Number.isInteger(orch["maxConcurrency"]) ||
          orch["maxConcurrency"] <= 0
        ) {
          errors.push(
            "Pillar 8: orchestration.maxConcurrency must be a positive integer if present"
          );
        }
      }
    }
  }

  // ── Pillar 9 — Memory ────────────────────────────────────────────────────
  if (s["memory"] !== undefined) {
    if (!s["memory"] || typeof s["memory"] !== "object" || Array.isArray(s["memory"])) {
      errors.push("Pillar 9: memory must be an object if present");
    } else {
      const mem = s["memory"] as Record<string, unknown>;
      if (mem["kpiEnabled"] !== undefined && typeof mem["kpiEnabled"] !== "boolean") {
        errors.push("Pillar 9: memory.kpiEnabled must be a boolean if present");
      }
      if (mem["autoRetireAfterMinutes"] !== undefined) {
        if (
          typeof mem["autoRetireAfterMinutes"] !== "number" ||
          mem["autoRetireAfterMinutes"] <= 0
        ) {
          errors.push(
            "Pillar 9: memory.autoRetireAfterMinutes must be a positive number if present"
          );
        }
      }
    }
  }

  return errors;
}

/**
 * Validates an AgentSpec object against the 9-pillar schema.
 * Dispatches to the appropriate version-specific validator based on `specVersion`
 * (defaults to `CURRENT_SPEC_VERSION` when the field is absent).
 *
 * @param spec            - The raw spec object to validate (typed as `unknown` to
 *                          accept untrusted/arbitrary input).
 * @param existingAgentIds - IDs of agents already registered in the registry.
 *                          Used to validate Pillar 7 delegation target references.
 * @returns `{ valid, errors }` — `valid` is true iff `errors` is empty.
 */
export function validateAgentSpec(
  spec: unknown,
  existingAgentIds: string[] = []
): AgentSpecValidationResult {
  if (spec === null || spec === undefined || typeof spec !== "object") {
    return { valid: false, errors: ["AgentSpec must be a non-null object"] };
  }

  const s = spec as Record<string, unknown>;
  const errors: string[] = [];

  // ── specVersion validation & dispatch ────────────────────────────────────
  let resolvedVersion: string = CURRENT_SPEC_VERSION;
  if (s["specVersion"] !== undefined) {
    if (typeof s["specVersion"] !== "string" || s["specVersion"].trim() === "") {
      errors.push("specVersion must be a non-empty string if present");
    } else if (!(SUPPORTED_SPEC_VERSIONS as readonly string[]).includes(s["specVersion"])) {
      errors.push(
        `specVersion "${s["specVersion"]}" is not supported; supported versions: [${SUPPORTED_SPEC_VERSIONS.join(", ")}]`
      );
    } else {
      resolvedVersion = s["specVersion"];
    }
  }

  // Short-circuit if specVersion itself is invalid — no point running pillar checks
  if (errors.length > 0) {
    return { valid: false, errors };
  }

  const versionValidator = VALIDATORS[resolvedVersion];
  const pillarErrors = versionValidator(s, existingAgentIds);
  return { valid: pillarErrors.length === 0, errors: pillarErrors };
}
