import { randomUUID } from "crypto";
import {
  DelegationLogEntry,
  LineageGraph,
  LineageGraphSummary,
  ToolCall,
  ToolDefinition,
  ToolResult,
} from "./types";
import { LineageExporter } from "./LineageExporter";
import { LineageGraphBuilder } from "./LineageGraphBuilder";

/**
 * BaseService — abstract base for all MCP services.
 */
export abstract class BaseService {
  abstract readonly name: string;
  abstract getToolDefinitions(): ToolDefinition[];
  abstract execute(call: ToolCall): Promise<ToolResult>;
}

/**
 * McpServiceListManager — manages a collection of BaseService instances,
 * handles agent delegation, logs every delegation, and provides lineage graph
 * building/exporting capabilities.
 */
export class McpServiceListManager {
  private services = new Map<string, BaseService>();
  private delegationLog: DelegationLogEntry[] = [];

  private lineageBuilder = new LineageGraphBuilder();
  private lineageExporter = new LineageExporter();

  // ── Service registration ─────────────────────────────────────────────────

  register(service: BaseService): void {
    this.services.set(service.name, service);
  }

  getService(name: string): BaseService | undefined {
    return this.services.get(name);
  }

  listServices(): string[] {
    return [...this.services.keys()];
  }

  // ── Agent delegation ─────────────────────────────────────────────────────

  /**
   * Delegate a tool call from fromAgentId to toAgentId.
   * The result and metadata are automatically logged to delegationLog.
   */
  async delegateAs(
    fromAgentId: string,
    toAgentId: string,
    call: ToolCall
  ): Promise<ToolResult> {
    const service = this.services.get(toAgentId);

    const start = Date.now();
    let result: ToolResult;

    if (!service) {
      result = { success: false, error: `Service not found: ${toAgentId}` };
    } else {
      try {
        result = await service.execute(call);
      } catch (err) {
        result = { success: false, error: (err as Error).message };
      }
    }

    const durationMs = Date.now() - start;

    const entry: DelegationLogEntry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      fromAgentId,
      toAgentId,
      toolName: call.toolName,
      arguments: call.arguments,
      success: result.success,
      error: result.error,
      durationMs,
    };

    this.delegationLog.push(entry);
    return result;
  }

  // ── Delegation log access ────────────────────────────────────────────────

  getDelegationLog(): readonly DelegationLogEntry[] {
    return this.delegationLog;
  }

  clearDelegationLog(): void {
    this.delegationLog = [];
  }

  // ── Lineage graph ────────────────────────────────────────────────────────

  /**
   * Build a lineage graph from the in-memory delegation log.
   * Optionally filter by time range.
   */
  buildLineageGraph(options?: { startTime?: string; endTime?: string }): LineageGraph {
    if (options?.startTime && options?.endTime) {
      return this.lineageBuilder.buildForTimeRange(
        this.delegationLog,
        options.startTime,
        options.endTime
      );
    }
    return this.lineageBuilder.build(this.delegationLog);
  }

  /**
   * Export the lineage graph in Mermaid format.
   */
  exportLineageMermaid(options?: { startTime?: string; endTime?: string }): string {
    const graph = this.buildLineageGraph(options);
    return this.lineageExporter.toMermaid(graph);
  }

  /**
   * Export the lineage graph in JSON format.
   */
  exportLineageJSON(options?: { startTime?: string; endTime?: string }): string {
    const graph = this.buildLineageGraph(options);
    return this.lineageExporter.toJSON(graph);
  }

  /**
   * Export the lineage graph in DOT format.
   */
  exportLineageDOT(options?: { startTime?: string; endTime?: string }): string {
    const graph = this.buildLineageGraph(options);
    return this.lineageExporter.toDOT(graph);
  }

  /**
   * Get a summary of the lineage graph.
   */
  getLineageSummary(): LineageGraphSummary {
    const graph = this.buildLineageGraph();
    const agentNodes = graph.nodes
      .filter((n) => n.type === "agent")
      .map((n) => n.agentId ?? n.label);
    const toolNodes = graph.nodes
      .filter((n) => n.type === "tool")
      .map((n) => n.toolName ?? n.label);

    const timestamps = this.delegationLog.map((e) => e.timestamp).sort();
    const earliest = timestamps[0] ?? new Date().toISOString();
    const latest = timestamps[timestamps.length - 1] ?? new Date().toISOString();

    return {
      totalNodes: graph.nodeCount,
      totalEdges: graph.edgeCount,
      agentNodes,
      toolNodes,
      successRate: graph.successRate,
      timeRange: { earliest, latest },
    };
  }
}
