# AgentSpec Schema Versioning

This document describes how `specVersion` works in the 9-Pillar Agent Specification, how to validate and migrate specs, and how to introduce new schema versions in the future.

---

## What is `specVersion`?

Every `AgentSpec` object can carry an optional `specVersion` field:

```json
{
  "id": "research-bot",
  "name": "Research Bot",
  "specVersion": "1.0"
}
```

`specVersion` is a string that identifies the schema contract the spec conforms to. It lets the runtime:

1. **Validate** the spec against the correct set of rules for that version.
2. **Migrate** older specs forward to the current version automatically.

When `specVersion` is absent, the runtime assumes `"1.0"` for backward compatibility.

---

## Supported versions and constants

Defined in `src/core/types.ts`:

| Constant | Value | Description |
|---|---|---|
| `SUPPORTED_SPEC_VERSIONS` | `["1.0"]` | Tuple of all recognised version strings. |
| `CURRENT_SPEC_VERSION` | `"1.0"` | The version produced by new specs and targeted by migrations. |
| `SpecVersion` | `"1.0"` | TypeScript union type derived from the tuple. |

The `specVersion` field on the `AgentSpec` interface is typed as `SpecVersion | (string & {})`. This gives full IDE autocomplete for known versions while still accepting unknown future strings at the type level (they will be rejected at runtime by the validator).

---

## Validating a spec

Use `validateAgentSpec()` from `src/core/AgentSpecValidator.ts`:

```typescript
import { validateAgentSpec } from "./src/core/AgentSpecValidator";

const result = validateAgentSpec(mySpec);
if (!result.valid) {
  throw new Error(result.errors.join("; "));
}
```

The validator dispatches to the version-specific pillar checks based on `specVersion` (defaulting to `CURRENT_SPEC_VERSION` when the field is absent).

> **Note:** Always migrate a spec before validating it. Validating an old spec directly will fail if its structure does not match the current schema.

---

## Migrating a spec

Use `migrateAgentSpec()` from `src/core/AgentSpecMigrator.ts`:

```typescript
import { migrateAgentSpec } from "./src/core/AgentSpecMigrator";
import { validateAgentSpec } from "./src/core/AgentSpecValidator";

// Step 1: migrate to CURRENT_SPEC_VERSION
const migrated = migrateAgentSpec(rawSpec);

// Step 2: validate the migrated spec
const result = validateAgentSpec(migrated);
if (!result.valid) {
  throw new Error(result.errors.join("; "));
}
```

### Behaviour

| Input spec `specVersion` | Behaviour |
|---|---|
| Absent / `undefined` | Treated as `"1.0"` (backward compatible). Stamped with `CURRENT_SPEC_VERSION`. |
| `"1.0"` (current) | Returned as-is with `specVersion` stamped. |
| Unknown string (e.g. `"99.0"`) | Throws `MigrationError` with the offending version in `err.specVersion`. |

`migrateAgentSpec()` **never mutates** the input object — it always returns a new object.

### Error handling

```typescript
import { migrateAgentSpec, MigrationError } from "./src/core/AgentSpecMigrator";

try {
  const migrated = migrateAgentSpec(untrustedSpec);
} catch (err) {
  if (err instanceof MigrationError) {
    console.error(`Unsupported spec version: ${err.specVersion}`);
  }
  throw err;
}
```

---

## Two-step process: migrate then validate

```
rawSpec ──► migrateAgentSpec() ──► migratedSpec ──► validateAgentSpec() ──► { valid, errors }
```

This separation means:

- **Migration** is purely structural — it upgrades the spec shape.
- **Validation** is purely semantic — it checks that the spec content is correct.

Running validation on an unmigrated old spec is safe but may produce false errors; always migrate first.

---

## How to add a new version in the future

Follow this checklist whenever a new schema version (e.g. `"2.0"`) is introduced:

1. **`src/core/types.ts`** — Add `"2.0"` to `SUPPORTED_SPEC_VERSIONS`:
   ```typescript
   export const SUPPORTED_SPEC_VERSIONS = ["1.0", "2.0"] as const;
   ```
   Update `CURRENT_SPEC_VERSION` when the new version becomes the default:
   ```typescript
   export const CURRENT_SPEC_VERSION: SpecVersion = "2.0";
   ```

2. **`src/core/AgentSpecValidator.ts`** — Add a `validateV2()` function and register it in the `VALIDATORS` dispatch table:
   ```typescript
   const VALIDATORS = {
     "1.0": validateV1,
     "2.0": validateV2,
   };
   ```

3. **`src/core/AgentSpecMigrator.ts`** — Add a migration step that transforms a `"1.0"` spec into a `"2.0"` spec:
   ```typescript
   {
     fromVersion: "1.0",
     toVersion: "2.0",
     description: "Migrate from 1.0 to 2.0: ...",
     migrate(spec) {
       // Return a new object with the structural changes applied.
       return { ...spec, newField: defaultValue };
     },
   }
   ```
   Remove (or replace) the existing `"1.0" → "1.0"` identity step.

4. **`src/core/__tests__/AgentSpecMigrator.test.ts`** — Add tests covering the new migration step.

5. **`docs/agent-spec-versioning.md`** — Update the supported versions table and add a changelog entry.
