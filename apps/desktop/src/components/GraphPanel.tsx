import { useMemo, useState, useCallback } from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  type Node,
  type Edge,
  type Connection,
  type NodeTypes,
  Handle,
  Position,
} from "reactflow";
import "reactflow/dist/style.css";
import type { AgentEvent, RunNode, RunEdge } from "../models/events";

// ── Custom node renderer ──────────────────────────────────────────────────────

function RunNodeCard({ data }: { data: RunNode & { selected?: boolean } }) {
  const statusColor: Record<string, string> = {
    pending: "#6b7280",
    running: "#3b82f6",
    completed: "#22c55e",
    failed: "#ef4444",
    blocked: "#f59e0b",
  };
  const kindIcon: Record<string, string> = {
    tool_call: "⚙",
    screenshot: "📷",
    verifier: "✔",
    user_message: "👤",
    agent_message: "🤖",
  };
  const color = statusColor[data.status] ?? "#6b7280";
  const icon = kindIcon[data.kind] ?? "●";

  return (
    <div
      style={{
        background: "#1e1e2e",
        border: `2px solid ${color}`,
        borderRadius: 8,
        padding: "6px 10px",
        minWidth: 140,
        fontSize: 12,
        color: "#e2e8f0",
        boxShadow: data.selected ? `0 0 0 3px ${color}55` : undefined,
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: color }} />
      <div style={{ fontWeight: 700, marginBottom: 2 }}>
        {icon} {data.tool ?? data.kind}
      </div>
      <div style={{ color, fontSize: 10 }}>{data.status}</div>
      {data.confidence !== undefined && (
        <div style={{ color: "#94a3b8", fontSize: 10 }}>
          conf {(data.confidence * 100).toFixed(0)}%
        </div>
      )}
      <Handle type="source" position={Position.Right} style={{ background: color }} />
    </div>
  );
}

const nodeTypes: NodeTypes = { runNode: RunNodeCard };

// ── Helpers ───────────────────────────────────────────────────────────────────

function toFlowNode(rn: RunNode, index: number): Node<RunNode> {
  return {
    id: rn.id,
    type: "runNode",
    position: { x: index * 200, y: 40 },
    data: rn,
  };
}

function toFlowEdge(re: RunEdge): Edge {
  const edgeColor = re.blocked ? "#f59e0b" : re.kind === "data" ? "#a78bfa" : "#64748b";
  return {
    id: re.id,
    source: re.src,
    target: re.dst,
    animated: re.kind === "verification",
    style: { stroke: edgeColor, strokeDasharray: re.blocked ? "6 3" : undefined },
    label: re.blocked ? "blocked" : re.kind === "data" ? "data" : undefined,
  };
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  events: AgentEvent[];
}

// Stub nodes/edges shown in dev mode before any real events arrive
const STUB_NODES: RunNode[] = [
  { id: "n1", session_id: "stub", kind: "user_message", status: "completed", timestamp: new Date().toISOString() },
  { id: "n2", session_id: "stub", kind: "tool_call", tool: "fetch_weather", status: "completed", confidence: 0.9, timestamp: new Date().toISOString() },
  { id: "n3", session_id: "stub", kind: "verifier", tool: "verify.screen_changed", status: "completed", confidence: 0.8, timestamp: new Date().toISOString() },
  { id: "n4", session_id: "stub", kind: "tool_call", tool: "web_search", status: "completed", confidence: 0.85, timestamp: new Date().toISOString() },
  { id: "n5", session_id: "stub", kind: "agent_message", status: "completed", timestamp: new Date().toISOString() },
];

const STUB_EDGES: RunEdge[] = [
  { id: "e1", session_id: "stub", src: "n1", dst: "n2", kind: "control", blocked: false, timestamp: new Date().toISOString() },
  { id: "e2", session_id: "stub", src: "n2", dst: "n3", kind: "verification", blocked: false, timestamp: new Date().toISOString() },
  { id: "e3", session_id: "stub", src: "n3", dst: "n4", kind: "control", blocked: false, timestamp: new Date().toISOString() },
  { id: "e4", session_id: "stub", src: "n4", dst: "n5", kind: "data", blocked: false, timestamp: new Date().toISOString() },
];

// Lineage view adds an extra "data" node to demonstrate artifact-centric view
const STUB_LINEAGE_NODES: RunNode[] = [
  { id: "a1", session_id: "stub", kind: "tool_call", tool: "fetch_weather", status: "completed", confidence: 0.9, timestamp: new Date().toISOString() },
  { id: "a2", session_id: "stub", kind: "screenshot", tool: "desktop.screenshot", status: "completed", timestamp: new Date().toISOString() },
  { id: "a3", session_id: "stub", kind: "verifier", tool: "verify.screen_changed", status: "completed", confidence: 0.8, timestamp: new Date().toISOString() },
  { id: "a4", session_id: "stub", kind: "agent_message", status: "completed", timestamp: new Date().toISOString() },
];

const STUB_LINEAGE_EDGES: RunEdge[] = [
  { id: "l1", session_id: "stub", src: "a1", dst: "a4", kind: "data", blocked: false, timestamp: new Date().toISOString() },
  { id: "l2", session_id: "stub", src: "a2", dst: "a3", kind: "verification", blocked: false, timestamp: new Date().toISOString() },
  { id: "l3", session_id: "stub", src: "a3", dst: "a4", kind: "data", blocked: false, timestamp: new Date().toISOString() },
];

export default function GraphPanel({ events }: Props) {
  const [activeTab, setActiveTab] = useState<"trace" | "lineage">("trace");
  const [selectedNode, setSelectedNode] = useState<RunNode | null>(null);

  // Accumulate nodes/edges from events
  const { liveNodes, liveEdges } = useMemo(() => {
    const nodeMap = new Map<string, RunNode>();
    const edgeMap = new Map<string, RunEdge>();
    for (const ev of events) {
      if (ev.type === "GraphNodeAdded" || ev.type === "GraphNodeUpdated") {
        nodeMap.set(ev.node.id, ev.node);
      } else if (ev.type === "GraphEdgeAdded") {
        edgeMap.set(ev.edge.id, ev.edge);
      }
    }
    return { liveNodes: [...nodeMap.values()], liveEdges: [...edgeMap.values()] };
  }, [events]);

  const hasLiveData = liveNodes.length > 0;

  const traceNodes = hasLiveData ? liveNodes : STUB_NODES;
  const traceEdges = hasLiveData ? liveEdges : STUB_EDGES;
  const lineageNodes = hasLiveData
    ? liveNodes.filter((n) => n.kind === "tool_call" || n.kind === "verifier" || n.kind === "screenshot" || n.kind === "agent_message")
    : STUB_LINEAGE_NODES;
  const lineageEdges = hasLiveData
    ? liveEdges.filter((e) => e.kind === "data" || e.kind === "verification")
    : STUB_LINEAGE_EDGES;

  const srcNodes = activeTab === "trace" ? traceNodes : lineageNodes;
  const srcEdges = activeTab === "trace" ? traceEdges : lineageEdges;

  const [, , onNodesChange] = useNodesState(
    srcNodes.map((n, i) => toFlowNode(n, i))
  );
  const [, setEdges, onEdgesChange] = useEdgesState(srcEdges.map(toFlowEdge));

  // Re-sync when tab or data changes
  const flowNodes = useMemo(
    () => srcNodes.map((n, i) => toFlowNode(n, i)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeTab, srcNodes.length]
  );
  const flowEdges = useMemo(
    () => srcEdges.map(toFlowEdge),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeTab, srcEdges.length]
  );

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node<RunNode>) => setSelectedNode(node.data),
    []
  );

  return (
    <div className="graph-panel">
      <div className="graph-tabs">
        <button
          className={`graph-tab${activeTab === "trace" ? " active" : ""}`}
          onClick={() => setActiveTab("trace")}
        >
          执行追踪
        </button>
        <button
          className={`graph-tab${activeTab === "lineage" ? " active" : ""}`}
          onClick={() => setActiveTab("lineage")}
        >
          数据溯源
        </button>
      </div>

      <div className="graph-canvas">
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          nodeTypes={nodeTypes}
          fitView
        >
          <Background gap={16} color="#334155" />
          <Controls />
          <MiniMap nodeColor={(n) => {
            const status = (n.data as RunNode)?.status;
            if (status === "failed") return "#ef4444";
            if (status === "completed") return "#22c55e";
            if (status === "blocked") return "#f59e0b";
            return "#3b82f6";
          }} />
        </ReactFlow>
      </div>

      {selectedNode && (
        <div className="graph-inspector">
          <div className="inspector-title">
            {selectedNode.tool ?? selectedNode.kind}
          </div>
          <dl className="inspector-dl">
            <dt>状态</dt><dd>{selectedNode.status}</dd>
            {selectedNode.confidence !== undefined && (
              <><dt>置信度</dt><dd>{(selectedNode.confidence * 100).toFixed(0)}%</dd></>
            )}
            {selectedNode.inputs != null && (
              <><dt>输入</dt><dd><pre>{JSON.stringify(selectedNode.inputs, null, 2)}</pre></dd></>
            )}
            {selectedNode.outputs != null && (
              <><dt>输出</dt><dd><pre>{JSON.stringify(selectedNode.outputs, null, 2)}</pre></dd></>
            )}
          </dl>
          <button className="inspector-close" onClick={() => setSelectedNode(null)}>关闭</button>
        </div>
      )}

      {!hasLiveData && (
        <div className="graph-stub-badge">演示数据</div>
      )}
    </div>
  );
}
