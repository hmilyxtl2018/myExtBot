# Tools

All tools are registered in the `ToolRegistry` and validated against JSON Schemas before execution. Every tool call requires user approval (unless cached).

## Tool List

### `fs.readFile`

Read the contents of a file.

```json
{
  "path": "/absolute/or/relative/path/to/file.txt"
}
```

**Risk**: low  
**Status**: implemented

---

### `fs.applyPatch`

Apply a unified diff patch to a file.

```json
{
  "path": "/path/to/file.txt",
  "patch": "--- a/file.txt\n+++ b/file.txt\n@@ -1,3 +1,3 @@\n ..."
}
```

**Risk**: medium  
**Status**: placeholder

---

### `cmd.run`

Run a system command. Uses structured program + args (no shell expansion) to prevent injection.

```json
{
  "program": "git",
  "args": ["status"],
  "cwd": "/workspace"
}
```

**Risk**: high  
**Status**: implemented (requires allowlist entry)

---

### `net.fetch`

Perform an HTTP request.

```json
{
  "url": "https://api.example.com/data",
  "method": "GET",
  "headers": { "Authorization": "Bearer $TOKEN" }
}
```

**Risk**: medium  
**Status**: placeholder

---

### `desktop.screenshot`

Capture the primary display as a base64 PNG.

```json
{ "display": 0 }
```

**Risk**: low  
**Status**: placeholder (Windows DXGI implementation planned)

---

### `desktop.getActiveWindowInfo`

Get the title and bounding rect of the currently focused window.

```json
{}
```

**Risk**: low  
**Status**: placeholder

---

### `desktop.clickRectCenter`

Click the center of a screen rectangle.

```json
{ "x": 100, "y": 200, "width": 300, "height": 50 }
```

**Risk**: high  
**Status**: placeholder

---

### `desktop.ocrCloud`

Send an image to an OpenAI-compatible Vision API and extract text.

```json
{
  "image_b64": "<base64-encoded-png>",
  "prompt": "Extract all visible text"
}
```

**Risk**: medium  
**Status**: placeholder

---

## Schema Validation

All parameters are validated against the tool's JSON Schema (Draft-07) by `ToolRegistry::validate_params` before the approval modal is shown. Invalid calls are rejected immediately.
