/**
 * src/api/openapi.ts
 *
 * OpenAPI 3.0 spec generation for myExtBot API.
 *
 * Usage (as Express middleware):
 *   import { swaggerSpec, setupSwagger } from "./api/openapi";
 *   setupSwagger(app);
 *
 * Usage (standalone — generate docs/openapi.json):
 *   npm run docs:api
 */

import swaggerJsdoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import type { Express } from "express";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const pkg = JSON.parse(
  readFileSync(resolve(__dirname, "../../package.json"), "utf8")
) as { version: string };

const swaggerOptions: swaggerJsdoc.Options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "myExtBot API",
      version: pkg.version,
      description:
        "REST API for myExtBot — an extensible multi-agent orchestration platform.\n\n" +
        "All endpoints under `/api/*` require an `x-api-key` header (set `MYEXTBOT_API_KEY` env var, default: `dev-key`).\n\n" +
        "Interactive docs: `/api-docs` · Raw spec: `/api-docs/json`",
    },
    servers: [{ url: "http://localhost:3000", description: "Local development" }],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: "apiKey",
          in: "header",
          name: "x-api-key",
        },
      },
      schemas: {
        Error: {
          type: "object",
          properties: {
            ok: { type: "boolean", example: false },
            error: { type: "string" },
          },
        },
        SuccessOk: {
          type: "object",
          properties: {
            ok: { type: "boolean", example: true },
          },
        },
      },
    },
    security: [{ ApiKeyAuth: [] }],
    tags: [
      { name: "Health", description: "System and service health" },
      { name: "Services", description: "Manage MCP services" },
      { name: "Tools", description: "Tool definitions and dispatch" },
      { name: "Scenes", description: "Scene management" },
      { name: "Scene Triggers", description: "Automatic scene detection" },
      { name: "Agents", description: "Agent registration and routing" },
      { name: "Delegation", description: "Inter-agent delegation and logs" },
      { name: "Plugins", description: "Plugin marketplace" },
      { name: "Pipelines", description: "Agent pipeline orchestration" },
      { name: "Costs", description: "Cost tracking and reporting" },
      { name: "Lineage", description: "Execution lineage graph" },
      { name: "Contracts", description: "Agent SLA contracts" },
      { name: "Lifecycle", description: "Agent lifecycle management" },
      { name: "Security", description: "Audit log" },
    ],
  },
  apis: [
    resolve(__dirname, "./healthRoutes.ts"),
    resolve(__dirname, "./lifecycleRoutes.ts"),
    resolve(__dirname, "./pipelineRoutes.ts"),
    resolve(__dirname, "./costRoutes.ts"),
    resolve(__dirname, "./lineageRoutes.ts"),
    resolve(__dirname, "./contractRoutes.ts"),
    resolve(__dirname, "./pluginRoutes.ts"),
    resolve(__dirname, "./sceneTriggerRoutes.ts"),
    resolve(__dirname, "../server.ts"),
    // compiled JS paths (for production builds)
    resolve(__dirname, "./healthRoutes.js"),
    resolve(__dirname, "./lifecycleRoutes.js"),
    resolve(__dirname, "./pipelineRoutes.js"),
    resolve(__dirname, "./costRoutes.js"),
    resolve(__dirname, "./lineageRoutes.js"),
    resolve(__dirname, "./contractRoutes.js"),
    resolve(__dirname, "./pluginRoutes.js"),
    resolve(__dirname, "./sceneTriggerRoutes.js"),
    resolve(__dirname, "../server.js"),
  ],
};

export const swaggerSpec = swaggerJsdoc(swaggerOptions);

/**
 * Mount Swagger UI at /api-docs and expose raw JSON at /api-docs/json.
 */
export function setupSwagger(app: Express): void {
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  app.get("/api-docs/json", (_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.send(swaggerSpec);
  });
}

// ── Standalone: generate docs/openapi.json ────────────────────────────────────

// When run directly with: tsx src/api/openapi.ts [--output path]
const isMain = process.argv[1]?.endsWith("openapi.ts") || process.argv[1]?.endsWith("openapi.js");
if (isMain) {
  const { writeFileSync, mkdirSync } = await import("fs");
  const { resolve: r } = await import("path");
  const idx = process.argv.indexOf("--output");
  const outPath = idx !== -1 && process.argv[idx + 1]
    ? r(process.argv[idx + 1])
    : r(__dirname, "../../docs/openapi.json");
  mkdirSync(r(outPath, ".."), { recursive: true });
  writeFileSync(outPath, JSON.stringify(swaggerSpec, null, 2));
  console.log(`OpenAPI spec written to ${outPath}`);
}
