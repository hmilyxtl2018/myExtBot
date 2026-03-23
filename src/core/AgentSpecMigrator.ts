/**
 * AgentSpec migration helpers — version-to-version upgrade infrastructure.
 *
 * Usage:
 *   const migrated = migrateAgentSpec(rawSpec);
 *   const result   = validateAgentSpec(migrated);
 */

import { CURRENT_SPEC_VERSION, SUPPORTED_SPEC_VERSIONS } from "./types";

// ── Public interfaces ──────────────────────────────────────────────────────────

/** Describes a single migration step from one specVersion to the next. */
export interface MigrationStep {
  /** The specVersion this step migrates *from*. */
  fromVersion: string;
  /** The specVersion this step produces. */
  toVersion: string;
  /** Human-readable description of what this step does. */
  description: string;
  /**
   * Applies the migration and returns a **new** spec object.
   * Must never mutate the input.
   */
  migrate(spec: Record<string, unknown>): Record<string, unknown>;
}

/** Thrown when a spec carries an unrecognised / unsupported specVersion. */
export class MigrationError extends Error {
  constructor(
    message: string,
    public readonly specVersion: string
  ) {
    super(message);
    this.name = "MigrationError";
  }
}

// ── Migration step registry ────────────────────────────────────────────────────

/**
 * Ordered list of migration steps.
 * Each step advances the schema by one version.
 * When a new version is introduced:
 *   1. Add its identifier to `SUPPORTED_SPEC_VERSIONS` in `types.ts`.
 *   2. Add a new `MigrationStep` entry here that transforms fromVersion → toVersion.
 */
const MIGRATION_STEPS: MigrationStep[] = [
  {
    // Placeholder identity step so the chain is wired and testable even when only
    // a single version ("1.0") exists. Future steps will replace this pattern.
    fromVersion: "1.0",
    toVersion: "1.0",
    description: "Identity migration for specVersion 1.0 (no structural changes).",
    migrate(spec) {
      return { ...spec };
    },
  },
];

// ── AgentSpecMigrator class ────────────────────────────────────────────────────

/**
 * Applies incremental migration steps to bring an AgentSpec up to a target version.
 *
 * The migrator is stateless — create one instance and reuse it freely.
 */
export class AgentSpecMigrator {
  /**
   * Returns the ordered list of registered migration steps.
   * Useful for introspection and testing.
   */
  getMigrationSteps(): MigrationStep[] {
    return [...MIGRATION_STEPS];
  }

  /**
   * Migrates `spec` from `fromVersion` to `toVersion`.
   *
   * - `fromVersion` defaults to the spec's own `specVersion` field, or
   *   `"1.0"` when neither is provided (backward-compatibility assumption).
   * - `toVersion` defaults to `CURRENT_SPEC_VERSION`.
   * - Returns a **new** object; the input is never mutated.
   * - Throws `MigrationError` if `fromVersion` is not known in the migration chain.
   */
  migrate(
    spec: Record<string, unknown>,
    fromVersion?: string,
    toVersion?: string
  ): Record<string, unknown> {
    const from =
      fromVersion ??
      (typeof spec["specVersion"] === "string" && spec["specVersion"].trim() !== ""
        ? spec["specVersion"]
        : "1.0");
    const to = toVersion ?? CURRENT_SPEC_VERSION;

    // If already at the target version, stamp and return a shallow copy.
    if (from === to) {
      return { ...spec, specVersion: to };
    }

    // Verify fromVersion exists in the chain before attempting to walk it.
    const knownVersions = new Set<string>(
      MIGRATION_STEPS.map((s) => s.fromVersion).concat(
        MIGRATION_STEPS.map((s) => s.toVersion)
      )
    );
    if (!knownVersions.has(from)) {
      throw new MigrationError(
        `Cannot migrate spec: specVersion "${from}" is unknown. ` +
          `Supported versions: [${[...new Set(SUPPORTED_SPEC_VERSIONS as readonly string[])].join(", ")}].`,
        from
      );
    }

    // Walk the migration chain from `from` toward `to`.
    let current = { ...spec };
    let currentVersion = from;

    while (currentVersion !== to) {
      const step = MIGRATION_STEPS.find((s) => s.fromVersion === currentVersion);
      if (!step) {
        throw new MigrationError(
          `No migration path from "${currentVersion}" to "${to}".`,
          currentVersion
        );
      }
      current = step.migrate(current);
      currentVersion = step.toVersion;
    }

    return { ...current, specVersion: to };
  }
}

// ── Convenience function ───────────────────────────────────────────────────────

const _defaultMigrator = new AgentSpecMigrator();

/**
 * Convenience wrapper around `AgentSpecMigrator.migrate()`.
 *
 * Migrates `spec` to `CURRENT_SPEC_VERSION`.
 *
 * - If `spec` has no `specVersion`, it is assumed to be `"1.0"` (backwards compatible).
 * - If `spec` is already at `CURRENT_SPEC_VERSION`, it is returned as-is (with specVersion stamped).
 * - If the `specVersion` is unknown/unsupported, throws a `MigrationError`.
 *
 * Returns a new spec object — the input is never mutated.
 */
export function migrateAgentSpec(
  spec: Record<string, unknown>
): Record<string, unknown> {
  return _defaultMigrator.migrate(spec);
}
