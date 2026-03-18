import { Router, Request, Response } from "express";
import { McpServiceListManager } from "../core/McpServiceListManager";
import { LineageExporter } from "../core/LineageExporter";

/**
 * lineageRoutes — Express router providing REST API endpoints for lineage graph data.
 *
 * Endpoints:
 *   GET /api/lineage          - full graph (JSON, Mermaid, or DOT based on ?format=)
 *   GET /api/lineage/mermaid  - Mermaid text (text/plain)
 *   GET /api/lineage/summary  - summary statistics
 */
export function createLineageRoutes(manager: McpServiceListManager): Router {
  const router = Router();
  const exporter = new LineageExporter();

  /**
   * GET /api/lineage
   * Query params:
   *   startTime?: ISO 8601
   *   endTime?:   ISO 8601
   *   format?:    "json" | "mermaid" | "dot"  (default: "json")
   */
  router.get("/", (req: Request, res: Response) => {
    const { startTime, endTime, format = "json" } = req.query as Record<string, string | undefined>;
    const options = startTime && endTime ? { startTime, endTime } : undefined;

    switch (format) {
      case "mermaid": {
        const text = manager.exportLineageMermaid(options);
        res.type("text/plain").send(text);
        break;
      }
      case "dot": {
        const text = manager.exportLineageDOT(options);
        res.type("text/plain").send(text);
        break;
      }
      default: {
        const graph = manager.buildLineageGraph(options);
        res.json(graph);
        break;
      }
    }
  });

  /**
   * GET /api/lineage/mermaid
   * Query params:
   *   startTime?: ISO 8601
   *   endTime?:   ISO 8601
   * Response: text/plain — Mermaid flowchart text
   */
  router.get("/mermaid", (req: Request, res: Response) => {
    const { startTime, endTime } = req.query as Record<string, string | undefined>;
    const options = startTime && endTime ? { startTime, endTime } : undefined;
    const graph = manager.buildLineageGraph(options);
    const mermaid = exporter.toMermaid(graph);
    res.type("text/plain").send(mermaid);
  });

  /**
   * GET /api/lineage/summary
   * Response: { totalNodes, totalEdges, agentNodes, toolNodes, successRate, timeRange }
   */
  router.get("/summary", (_req: Request, res: Response) => {
    const summary = manager.getLineageSummary();
    res.json(summary);
  });

  return router;
}
