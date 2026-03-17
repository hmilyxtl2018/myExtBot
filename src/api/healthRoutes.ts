/**
 * src/api/healthRoutes.ts
 *
 * Express-style route handlers for Service Health REST API (M4).
 *
 * Routes:
 *   GET  /api/health               → list all ServiceHealthRecord[]
 *   GET  /api/health/:serviceName  → single ServiceHealthRecord
 *   POST /api/health/:serviceName/reset → reset health to "healthy"
 *
 * These handlers are framework-agnostic: they accept a minimal
 * { params, body } request object and return a plain response descriptor,
 * making them easy to mount on Express, Fastify, or any other HTTP framework.
 */

import { McpServiceListManager } from "../core/McpServiceListManager";
import { ServiceHealthRecord } from "../core/types";

export interface HealthRequest {
  params?: Record<string, string>;
}

export interface HealthResponse<T> {
  status: number;
  body: T;
}

/** Mount all health routes onto an Express-compatible router. */
export function createHealthRoutes(manager: McpServiceListManager) {
  /**
   * GET /api/health
   * Returns all ServiceHealthRecord[]
   */
  function getAllHealth(
    _req: HealthRequest
  ): HealthResponse<ServiceHealthRecord[]> {
    return { status: 200, body: manager.getAllServiceHealths() };
  }

  /**
   * GET /api/health/:serviceName
   * Returns a single ServiceHealthRecord or 404.
   */
  function getServiceHealth(
    req: HealthRequest
  ): HealthResponse<ServiceHealthRecord | { error: string }> {
    const serviceName = req.params?.serviceName ?? "";
    if (!serviceName) {
      return { status: 400, body: { error: "serviceName param is required" } };
    }
    const knownServices = manager.listServices();
    if (!knownServices.includes(serviceName)) {
      return {
        status: 404,
        body: { error: `Service "${serviceName}" not found` },
      };
    }
    return { status: 200, body: manager.getServiceHealth(serviceName) };
  }

  /**
   * POST /api/health/:serviceName/reset
   * Manually reset a service's health to "healthy" (ops use).
   */
  function resetServiceHealth(
    req: HealthRequest
  ): HealthResponse<{ success: true; record: ServiceHealthRecord } | { error: string }> {
    const serviceName = req.params?.serviceName ?? "";
    if (!serviceName) {
      return { status: 400, body: { error: "serviceName param is required" } };
    }
    const knownServices = manager.listServices();
    if (!knownServices.includes(serviceName)) {
      return {
        status: 404,
        body: { error: `Service "${serviceName}" not found` },
      };
    }
    const record = manager.resetServiceHealth(serviceName);
    return { status: 200, body: { success: true, record } };
  }

  return { getAllHealth, getServiceHealth, resetServiceHealth };
}

/**
 * Helper: mount routes on an Express app instance.
 *
 * Usage:
 *   import express from "express";
 *   import { mountHealthRoutes } from "./api/healthRoutes";
 *   const app = express();
 *   mountHealthRoutes(app, manager);
 */
export function mountHealthRoutes(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app: any,
  manager: McpServiceListManager
): void {
  const routes = createHealthRoutes(manager);

  app.get("/api/health", (_req: unknown, res: { json: (v: unknown) => void; status: (c: number) => { json: (v: unknown) => void } }) => {
    const { status, body } = routes.getAllHealth({});
    res.status(status).json(body);
  });

  app.get(
    "/api/health/:serviceName",
    (req: { params: Record<string, string> }, res: { json: (v: unknown) => void; status: (c: number) => { json: (v: unknown) => void } }) => {
      const { status, body } = routes.getServiceHealth({ params: req.params });
      res.status(status).json(body);
    }
  );

  app.post(
    "/api/health/:serviceName/reset",
    (req: { params: Record<string, string> }, res: { json: (v: unknown) => void; status: (c: number) => { json: (v: unknown) => void } }) => {
      const { status, body } = routes.resetServiceHealth({ params: req.params });
      res.status(status).json(body);
    }
  );
 * Express Router for Service Health REST API (M4).
 *
 * Routes:
 *   GET  /api/health               → ServiceHealthRecord[]
 *   GET  /api/health/:serviceName  → ServiceHealthRecord | 404
 *   POST /api/health/:serviceName/reset → reset to "healthy"
 */

import { Router, Request, Response } from "express";
import { McpServiceListManager } from "../core/McpServiceListManager";

export function createHealthRoutes(manager: McpServiceListManager): Router {
  const router = Router();

  // GET /api/health
  router.get("/health", (_req: Request, res: Response) => {
    res.json(manager.getAllServiceHealths());
  });

  // GET /api/health/:serviceName
  router.get("/health/:serviceName", (req: Request, res: Response) => {
    const name = req.params["serviceName"] as string;
    const services = manager.listServices();
    if (!services.some((s) => s.name === name)) {
      res.status(404).json({ ok: false, error: `Service "${name}" not found.` });
      return;
    }
    res.json(manager.getServiceHealth(name));
  });

  // POST /api/health/:serviceName/reset
  router.post("/health/:serviceName/reset", (req: Request, res: Response) => {
    const name = req.params["serviceName"] as string;
    const services = manager.listServices();
    if (!services.some((s) => s.name === name)) {
      res.status(404).json({ ok: false, error: `Service "${name}" not found.` });
      return;
    }
    const record = manager.resetServiceHealth(name);
    res.json({ success: true, record });
  });

  return router;
}
