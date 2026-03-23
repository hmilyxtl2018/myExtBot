import {
  AgentSpecMigrator,
  migrateAgentSpec,
  MigrationError,
} from "../AgentSpecMigrator";
import { validateAgentSpec } from "../AgentSpecValidator";
import { CURRENT_SPEC_VERSION } from "../types";

// ── Helper ─────────────────────────────────────────────────────────────────────

/** Minimal valid spec that satisfies all required fields. */
function minimalSpec(): Record<string, unknown> {
  return { id: "bot-1", name: "Bot One" };
}

// ── migrateAgentSpec — convenience function ────────────────────────────────────

describe("migrateAgentSpec", () => {
  it("stamps specVersion on a spec with no specVersion (assumes 1.0)", () => {
    const spec = minimalSpec();
    const result = migrateAgentSpec(spec);
    expect(result["specVersion"]).toBe("1.0");
  });

  it("returns a new object — does not mutate the input", () => {
    const spec = minimalSpec();
    const result = migrateAgentSpec(spec);
    expect(result).not.toBe(spec);
    expect(spec["specVersion"]).toBeUndefined();
  });

  it("returns a spec with CURRENT_SPEC_VERSION stamped when spec is already current", () => {
    const spec = { ...minimalSpec(), specVersion: CURRENT_SPEC_VERSION };
    const result = migrateAgentSpec(spec);
    expect(result["specVersion"]).toBe(CURRENT_SPEC_VERSION);
  });

  it("does not mutate the input when spec is already at CURRENT_SPEC_VERSION", () => {
    const spec = { ...minimalSpec(), specVersion: CURRENT_SPEC_VERSION };
    const originalVersion = spec.specVersion;
    const result = migrateAgentSpec(spec);
    expect(result).not.toBe(spec);
    expect(spec.specVersion).toBe(originalVersion);
  });

  it("throws MigrationError for an unknown specVersion", () => {
    const spec = { ...minimalSpec(), specVersion: "99.0" };
    expect(() => migrateAgentSpec(spec)).toThrow(MigrationError);
  });

  it("MigrationError carries the offending specVersion", () => {
    const spec = { ...minimalSpec(), specVersion: "99.0" };
    try {
      migrateAgentSpec(spec);
      fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(MigrationError);
      expect((err as MigrationError).specVersion).toBe("99.0");
    }
  });

  it("MigrationError message mentions the unknown version", () => {
    const spec = { ...minimalSpec(), specVersion: "99.0" };
    expect(() => migrateAgentSpec(spec)).toThrow(/99\.0/);
  });

  it("preserves all other spec fields after migration", () => {
    const spec = { ...minimalSpec(), controlLoop: { type: "react" } };
    const result = migrateAgentSpec(spec);
    expect(result["controlLoop"]).toEqual({ type: "react" });
    expect(result["id"]).toBe("bot-1");
    expect(result["name"]).toBe("Bot One");
  });

  it("migrated spec (no original specVersion) passes validateAgentSpec", () => {
    const spec = minimalSpec();
    const migrated = migrateAgentSpec(spec);
    const validation = validateAgentSpec(migrated);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);
  });

  it("migrated spec (with current specVersion) passes validateAgentSpec", () => {
    const spec = { ...minimalSpec(), specVersion: CURRENT_SPEC_VERSION };
    const migrated = migrateAgentSpec(spec);
    const validation = validateAgentSpec(migrated);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);
  });
});

// ── AgentSpecMigrator class ────────────────────────────────────────────────────

describe("AgentSpecMigrator", () => {
  let migrator: AgentSpecMigrator;

  beforeEach(() => {
    migrator = new AgentSpecMigrator();
  });

  describe("getMigrationSteps", () => {
    it("returns a non-empty array of steps", () => {
      const steps = migrator.getMigrationSteps();
      expect(steps.length).toBeGreaterThan(0);
    });

    it("returns a copy — mutations do not affect internal state", () => {
      const steps1 = migrator.getMigrationSteps();
      steps1.splice(0, steps1.length);
      const steps2 = migrator.getMigrationSteps();
      expect(steps2.length).toBeGreaterThan(0);
    });

    it("each step has the required MigrationStep fields", () => {
      for (const step of migrator.getMigrationSteps()) {
        expect(typeof step.fromVersion).toBe("string");
        expect(typeof step.toVersion).toBe("string");
        expect(typeof step.description).toBe("string");
        expect(typeof step.migrate).toBe("function");
      }
    });
  });

  describe("migrate", () => {
    it("stamps specVersion when no fromVersion arg and spec has no specVersion", () => {
      const result = migrator.migrate(minimalSpec());
      expect(result["specVersion"]).toBe(CURRENT_SPEC_VERSION);
    });

    it("uses explicit fromVersion when provided", () => {
      const result = migrator.migrate(minimalSpec(), "1.0");
      expect(result["specVersion"]).toBe(CURRENT_SPEC_VERSION);
    });

    it("uses explicit toVersion when provided", () => {
      const result = migrator.migrate(minimalSpec(), "1.0", "1.0");
      expect(result["specVersion"]).toBe("1.0");
    });

    it("returns a new object — does not mutate the input", () => {
      const spec = minimalSpec();
      const result = migrator.migrate(spec);
      expect(result).not.toBe(spec);
    });

    it("throws MigrationError for unknown fromVersion argument", () => {
      expect(() => migrator.migrate(minimalSpec(), "0.0")).toThrow(MigrationError);
    });

    it("throws MigrationError for unknown specVersion in spec", () => {
      const spec = { ...minimalSpec(), specVersion: "0.0" };
      expect(() => migrator.migrate(spec)).toThrow(MigrationError);
    });
  });
});

// ── MigrationError ─────────────────────────────────────────────────────────────

describe("MigrationError", () => {
  it("is an instance of Error", () => {
    const err = new MigrationError("oops", "2.0");
    expect(err).toBeInstanceOf(Error);
  });

  it("has name MigrationError", () => {
    const err = new MigrationError("oops", "2.0");
    expect(err.name).toBe("MigrationError");
  });

  it("exposes specVersion as a public property", () => {
    const err = new MigrationError("oops", "2.0");
    expect(err.specVersion).toBe("2.0");
  });

  it("message matches the constructor argument", () => {
    const err = new MigrationError("test message", "2.0");
    expect(err.message).toBe("test message");
  });
});
