import { DelegationLogEntry, LineageEdge, LineageGraph, LineageNode } from "./types";

/**
 * LineageGraphBuilder — builds a LineageGraph from DelegationLogEntry[].
 *
 * Build rules for each DelegationLogEntry:
 * 1. Create a fromAgent node  (type: "agent", label: fromAgentId)
 * 2. Create a toAgent node    (type: "agent", label: toAgentId)
 * 3. Create a tool node       (type: "tool",  label: toolName)
 * 4. Add edge: fromAgent → toAgent  (type: "delegation", label: "委托")
 * 5. Add edge: toAgent → tool       (type: "tool-call",  label: toolName)
 * 6. If success, add return edge: tool → fromAgent (type: "return", label: "✓")
 *    If failure, add return edge: tool → fromAgent (type: "return", label: "✗ " + error)
 *
 * De-duplication rules:
 * - Agent nodes with the same agentId are created only once (Map-based dedup)
 * - Tool nodes with the same toolName are created only once
 * - Edges are NOT de-duplicated (same agent pair may delegate the same tool multiple times)
 */
export class LineageGraphBuilder {
  /**
   * Build a lineage graph from an array of DelegationLogEntry.
   */
  build(entries: DelegationLogEntry[]): LineageGraph {
    if (entries.length === 0) {
      return {
        nodes: [],
        edges: [],
        startedAt: new Date().toISOString(),
        nodeCount: 0,
        edgeCount: 0,
        successRate: 0,
      };
    }

    const agentNodes = new Map<string, LineageNode>();
    const toolNodes = new Map<string, LineageNode>();
    const edges: LineageEdge[] = [];
    let edgeCounter = 0;

    const getOrCreateAgentNode = (agentId: string, entry: DelegationLogEntry): LineageNode => {
      if (!agentNodes.has(agentId)) {
        agentNodes.set(agentId, {
          id: `agent:${agentId}`,
          type: "agent",
          label: agentId,
          agentId,
          success: entry.success,
          timestamp: entry.timestamp,
        });
      }
      return agentNodes.get(agentId)!;
    };

    const getOrCreateToolNode = (toolName: string, entry: DelegationLogEntry): LineageNode => {
      if (!toolNodes.has(toolName)) {
        toolNodes.set(toolName, {
          id: `tool:${toolName}`,
          type: "tool",
          label: toolName,
          toolName,
          success: entry.success,
          durationMs: entry.durationMs,
          timestamp: entry.timestamp,
        });
      } else {
        // Update success/duration with the latest entry
        const existing = toolNodes.get(toolName)!;
        existing.success = entry.success;
        if (entry.durationMs !== undefined) {
          existing.durationMs = entry.durationMs;
        }
      }
      return toolNodes.get(toolName)!;
    };

    for (const entry of entries) {
      const fromNode = getOrCreateAgentNode(entry.fromAgentId, entry);
      const toNode = getOrCreateAgentNode(entry.toAgentId, entry);
      const toolNode = getOrCreateToolNode(entry.toolName, entry);

      // Edge 1: fromAgent → toAgent (delegation)
      edges.push({
        id: `edge:${edgeCounter++}`,
        from: fromNode.id,
        to: toNode.id,
        label: "委托",
        type: "delegation",
      });

      // Edge 2: toAgent → tool (tool-call)
      edges.push({
        id: `edge:${edgeCounter++}`,
        from: toNode.id,
        to: toolNode.id,
        label: entry.toolName,
        type: "tool-call",
      });

      // Edge 3: tool → fromAgent (return)
      const returnLabel = entry.success
        ? "✓"
        : `✗ ${entry.error ?? "error"}`;
      edges.push({
        id: `edge:${edgeCounter++}`,
        from: toolNode.id,
        to: fromNode.id,
        label: returnLabel,
        type: "return",
      });
    }

    const allNodes: LineageNode[] = [
      ...agentNodes.values(),
      ...toolNodes.values(),
    ];

    const timestamps = entries.map((e) => e.timestamp).sort();
    const startedAt = timestamps[0];
    const endedAt = timestamps[timestamps.length - 1];

    const toolNodeList = [...toolNodes.values()];
    const successfulTools = toolNodeList.filter((n) => n.success).length;
    const successRate =
      toolNodeList.length > 0 ? successfulTools / toolNodeList.length : 0;

    return {
      nodes: allNodes,
      edges,
      startedAt,
      endedAt,
      nodeCount: allNodes.length,
      edgeCount: edges.length,
      successRate,
    };
  }

  /**
   * Filter entries by time range, then build the graph.
   */
  buildForTimeRange(
    entries: DelegationLogEntry[],
    startTime: string,
    endTime: string
  ): LineageGraph {
    const start = new Date(startTime).getTime();
    const end = new Date(endTime).getTime();
    const filtered = entries.filter((e) => {
      const t = new Date(e.timestamp).getTime();
      return t >= start && t <= end;
    });
    return this.build(filtered);
  }
}
