# Verifiers

myExtBot's verifier framework lets you define assertions about the state of the
world after a tool execution. Results create **Claims** that update node
confidence and are visible in the Graph panel.

---

## Default Behaviour

1. **Auto-verify on high-risk actions** — any `desktop.clickRectCenter` or
   `desktop.typeText` call automatically gets a `verify.screen_changed` verifier
   node inserted after execution.
2. **Cloud OCR region requirement** — `verify.text_present_ocr` always requires
   a `region` parameter (`{x, y, w, h}`). Calling it without a region returns an
   error.
3. **Custom rules default scope** — user-defined verifier rules default to
   `scope: "task"`.

---

## Confidence Update Rule

Each verifier claim updates the node's confidence score:

| Claim   | Formula                                              |
|---------|------------------------------------------------------|
| `pass`  | `new = max(existing ?? 0.5, score)`                 |
| `fail`  | `new = min(existing ?? 0.5, 1.0 - score)`           |

The result is clamped to `[0, 1]`.

---

## Built-in Verifiers

### `verify.screen_changed`

Checks that the screen has visually changed after an action, using an image diff
score threshold.

| Param       | Type   | Default | Description                         |
|-------------|--------|---------|-------------------------------------|
| `threshold` | float  | `0.05`  | Minimum diff score to pass          |

```json
{ "verifier": "verify.screen_changed", "params": { "threshold": 0.05 } }
```

### `verify.exit_code_is`

Checks that a command's exit code matches the expected value.

| Param      | Type | Default | Description           |
|------------|------|---------|-----------------------|
| `expected` | int  | `0`     | Expected exit code    |
| `actual`   | int  | —       | **Required** actual value |

```json
{ "verifier": "verify.exit_code_is", "params": { "expected": 0, "actual": 0 } }
```

### `verify.window_title_is`

Checks that the active window title equals the expected string.

| Param      | Type   | Description                     |
|------------|--------|---------------------------------|
| `expected` | string | **Required** expected title     |
| `actual`   | string | **Required** observed title     |

```json
{ "verifier": "verify.window_title_is",
  "params": { "expected": "Untitled - Notepad", "actual": "Untitled - Notepad" } }
```

### `verify.dom_contains`

Checks that a DOM selector is present in the browser (requires browser sidecar).
Currently a stub — returns `fail` until the sidecar is connected.

| Param      | Type   | Description            |
|------------|--------|------------------------|
| `selector` | string | CSS selector to check  |

```json
{ "verifier": "verify.dom_contains", "params": { "selector": "#submit-btn" } }
```

### `verify.text_present_ocr`

Uses `desktop.ocrCloud` to check that a specific text string is present in a
screen region.

> **Region required** — this verifier always requires a `region` parameter.
> This prevents accidental full-screen OCR submissions to cloud APIs.

| Param    | Type   | Description                             |
|----------|--------|-----------------------------------------|
| `text`   | string | **Required** text to search for         |
| `region` | object | **Required** `{x, y, w, h}` in pixels  |

```json
{ "verifier": "verify.text_present_ocr",
  "params": { "text": "Submit", "region": {"x": 0, "y": 400, "w": 800, "h": 100} } }
```

---

## Custom Verifier Rules (JSON DSL)

Custom rules are persisted in the `verifier_rules` table and evaluated
automatically when a matching tool is called.

### Schema

```json
{
  "name": "check-button-clicked",
  "when": "desktop.clickRectCenter",
  "scope": "task",
  "assert": "all",
  "checks": [
    { "type": "screen_changed", "threshold": 0.1 },
    { "type": "ocr_contains",
      "text": "OK",
      "region": {"x": 0, "y": 0, "w": 800, "h": 100} }
  ],
  "on_fail": ["retry", "ask_user"]
}
```

### Fields

| Field       | Type     | Default  | Description                                         |
|-------------|----------|----------|-----------------------------------------------------|
| `name`      | string   | —        | Human-readable rule name                            |
| `when`      | string   | —        | Tool name that triggers this rule (use `*` for all) |
| `scope`     | string   | `"task"` | `task` \| `session` \| `global`                   |
| `assert`    | string   | `"all"`  | `all` — all checks must pass; `any` — at least one |
| `checks`    | array    | —        | List of check objects (see below)                   |
| `on_fail`   | string[] | `[]`     | Suggestions: `retry`, `ask_user`, `abort`, `log_only` |

### Check types

| `type`          | Required params      | Description               |
|-----------------|----------------------|---------------------------|
| `screen_changed`| `threshold?`         | Delegates to built-in     |
| `ocr_contains`  | `text`, `region`     | Delegates to built-in OCR |

### UI Editor

Open the Verifier Rule Editor from the Graph panel → **规则编辑器** button.
The editor provides a form-based interface for all fields above.

### Tauri commands

```typescript
// Save a rule
await invoke("save_verifier_rule", {
  id: undefined,  // omit to create; provide to update
  scope: "task",
  name: "my-rule",
  ruleJson: JSON.stringify({ when: "desktop.clickRectCenter", assert: "all", checks: [...] })
});

// List rules
const rules = await invoke<object[]>("list_verifier_rules");
```
