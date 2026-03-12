# myExtBot

**myExtBot** is a digital twin asset system that lets you dynamically equip your bot with skills (plugins) at runtime — no restarts required.

---

## Quick Start

```bash
npm install
npm run dev
```

---

## Plugin Marketplace

### Overview

Skills are like phone apps: install them when you need them, uninstall them when you don't. The Plugin Marketplace lets you extend myExtBot's capabilities at runtime without touching code.

### REST API

All endpoints are prefixed with `/api/plugins`.

| Method   | Path                        | Description                                      |
|----------|-----------------------------|--------------------------------------------------|
| `GET`    | `/api/plugins`              | List all marketplace plugins (with install status) |
| `GET`    | `/api/plugins/installed`    | List only installed plugins                      |
| `GET`    | `/api/plugins/:id`          | Get details for a single plugin                  |
| `POST`   | `/api/plugins/:id/install`  | Install a plugin                                 |
| `DELETE` | `/api/plugins/:id/uninstall`| Uninstall a plugin                               |

#### Example — install `weather-service`

```bash
curl -X POST http://localhost:3000/api/plugins/weather-service/install
```

```json
{
  "success": true,
  "message": "Plugin 'weather-service' installed successfully.",
  "plugin": {
    "id": "weather-service",
    "name": "Weather Service",
    "version": "1.0.0",
    "installed": true,
    "tools": [{ "name": "get_weather", ... }]
  }
}
```

#### Example — uninstall

```bash
curl -X DELETE http://localhost:3000/api/plugins/weather-service/uninstall
```

### `data/marketplace-index.json` Format

The marketplace catalogue is a JSON array of **PluginManifest** objects:

```json
[
  {
    "id": "my-plugin",
    "name": "My Plugin",
    "version": "1.0.0",
    "author": "you",
    "description": "What this plugin does.",
    "category": "Utilities",
    "registryUrl": "local://my-plugin",
    "executeEndpoint": "https://api.example.com/my-plugin/execute",
    "tools": [
      {
        "name": "my_tool",
        "description": "Description of the tool.",
        "parameters": {
          "type": "object",
          "properties": {
            "input": { "type": "string", "description": "Input text." }
          },
          "required": ["input"]
        }
      }
    ]
  }
]
```

### Adding a Custom Plugin

1. Edit `data/marketplace-index.json` and add a new entry following the format above.
2. If your plugin connects to a real external API, set `executeEndpoint` to the HTTP endpoint that accepts `{ toolName, parameters }` POST requests.
3. Install via the REST API or programmatically:

```typescript
const installer = new PluginInstaller(manager, new PluginRegistry());
await installer.install("my-plugin");
```

### Using `executeEndpoint`

When `executeEndpoint` is set, `PluginService` forwards every tool call as an HTTP POST:

```
POST https://api.example.com/my-plugin/execute
Content-Type: application/json

{
  "toolName": "my_tool",
  "parameters": { "input": "hello" }
}
```

The response body is returned as the tool result. If `executeEndpoint` is omitted, a stub result is returned (useful for local development and testing).

### Persistence & Restart Recovery

Installed plugins are persisted to `data/installed-plugins.json`. On the next startup, `PluginInstaller.restoreInstalled()` re-registers all previously installed plugins automatically.

> **Note:** `data/installed-plugins.json` is excluded from git (user state). `data/marketplace-index.json` is committed (shared catalogue).

Override the data directory with the `MYEXTBOT_DATA_DIR` environment variable:

```bash
MYEXTBOT_DATA_DIR=/custom/path npm run dev
```
