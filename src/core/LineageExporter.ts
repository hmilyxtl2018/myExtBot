import { LineageGraph, LineageNode } from "./types";

/**
 * LineageExporter — exports a LineageGraph to different formats.
 */
export class LineageExporter {
  /**
   * Export to Mermaid flowchart text (graph LR format).
   *
   * Example output:
   * ```
   * graph LR
   *   user[用户] --> |委托| research-bot[Research Bot]
   *   research-bot[Research Bot] --> |search_web| search_web_tool[🔧 search_web]
   *   search_web_tool[🔧 search_web] --> |✓| research-bot[Research Bot]
   * ```
   *
   * Node styles:
   * - agent nodes: square brackets [label]
   * - tool nodes:  round brackets (label) with 🔧 prefix
   * - failed nodes: ❌ prefix
   */
  toMermaid(graph: LineageGraph): string {
    if (graph.nodes.length === 0) {
      return "graph LR\n  %% empty graph";
    }

    const lines: string[] = ["graph LR"];

    // Build a node-id → safe Mermaid ID map
    const nodeIdMap = new Map<string, string>();
    graph.nodes.forEach((node) => {
      // Mermaid node IDs must not contain colons or spaces
      const safeId = node.id.replace(/[^a-zA-Z0-9_-]/g, "_");
      nodeIdMap.set(node.id, safeId);
    });

    // Node declarations (with display labels)
    for (const node of graph.nodes) {
      const safeId = nodeIdMap.get(node.id)!;
      const displayLabel = this.buildNodeLabel(node);
      lines.push(`  ${safeId}${displayLabel}`);
    }

    // Edges
    for (const edge of graph.edges) {
      const fromSafeId = nodeIdMap.get(edge.from);
      const toSafeId = nodeIdMap.get(edge.to);
      if (!fromSafeId || !toSafeId) continue;

      if (edge.label) {
        lines.push(`  ${fromSafeId} --> |${edge.label}| ${toSafeId}`);
      } else {
        lines.push(`  ${fromSafeId} --> ${toSafeId}`);
      }
    }

    return lines.join("\n");
  }

  /**
   * Export to a formatted JSON string.
   */
  toJSON(graph: LineageGraph): string {
    return JSON.stringify(graph, null, 2);
  }

  /**
   * Export to DOT format (Graphviz).
   *
   * Format:
   * digraph G {
   *   "fromAgent" -> "toAgent" [label="委托"]
   *   "toAgent" -> "toolName" [label="调用"]
   * }
   */
  toDOT(graph: LineageGraph): string {
    const lines: string[] = ["digraph G {"];

    // Node declarations
    for (const node of graph.nodes) {
      const label = this.buildDotLabel(node);
      const shape = node.type === "tool" ? "ellipse" : "box";
      lines.push(`  "${node.id}" [label="${label}" shape="${shape}"]`);
    }

    lines.push("");

    // Edges
    for (const edge of graph.edges) {
      if (edge.label) {
        lines.push(`  "${edge.from}" -> "${edge.to}" [label="${edge.label}"]`);
      } else {
        lines.push(`  "${edge.from}" -> "${edge.to}"`);
      }
    }

    lines.push("}");
    return lines.join("\n");
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private buildNodeLabel(node: LineageNode): string {
    if (node.type === "tool") {
      const prefix = node.success ? "🔧 " : "❌ ";
      return `("${prefix}${node.label}")`;
    }
    const prefix = node.success ? "" : "❌ ";
    return `["${prefix}${node.label}"]`;
  }

  private buildDotLabel(node: LineageNode): string {
    if (node.type === "tool") {
      const prefix = node.success ? "🔧 " : "❌ ";
      return `${prefix}${node.label}`;
    }
    const prefix = node.success ? "" : "❌ ";
    return `${prefix}${node.label}`;
  }
}
