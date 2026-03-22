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
   * @openapi
   * /api/lineage:
   *   get:
   *     tags: [Lineage]
   *     summary: Get the execution lineage graph
   *     description: Returns the full lineage graph. Use the `format` parameter to get Mermaid or DOT output.
   *     parameters:
   *       - in: query
   *         name: startTime
   *         schema:
   *           type: string
   *           format: date-time
   *         description: Filter start time (ISO 8601)
   *       - in: query
   *         name: endTime
   *         schema:
   *           type: string
   *           format: date-time
   *         description: Filter end time (ISO 8601)
   *       - in: query
   *         name: format
   *         schema:
   *           type: string
   *           enum: [json, mermaid, dot]
   *           default: json
   *         description: Output format
   *     responses:
   *       200:
   *         description: Lineage graph in the requested format
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *           text/plain:
   *             schema:
   *               type: string
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
   * @openapi
   * /api/lineage/mermaid:
   *   get:
   *     tags: [Lineage]
   *     summary: Get lineage graph as Mermaid flowchart text
   *     parameters:
   *       - in: query
   *         name: startTime
   *         schema:
   *           type: string
   *           format: date-time
   *       - in: query
   *         name: endTime
   *         schema:
   *           type: string
   *           format: date-time
   *     responses:
   *       200:
   *         description: Mermaid flowchart text
   *         content:
   *           text/plain:
   *             schema:
   *               type: string
   */
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
   * @openapi
   * /api/lineage/summary:
   *   get:
   *     tags: [Lineage]
   *     summary: Get summary statistics for the lineage graph
   *     responses:
   *       200:
   *         description: Summary statistics
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 totalNodes:
   *                   type: integer
   *                 totalEdges:
   *                   type: integer
   *                 agentNodes:
   *                   type: integer
   *                 toolNodes:
   *                   type: integer
   *                 successRate:
   *                   type: number
   *                 timeRange:
   *                   type: object
   */
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
