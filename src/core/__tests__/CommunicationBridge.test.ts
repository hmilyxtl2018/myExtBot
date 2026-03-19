import { CommunicationBridge } from "../CommunicationBridge";
import type { McpServiceListManager } from "../McpServiceListManager";
import type { AgentProfile, ToolCall, ToolResult } from "../types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAgent(overrides: Partial<AgentProfile> & { id: string; name: string }): AgentProfile {
  return { ...overrides };
}

function makeMockManager(agents: AgentProfile[]): jest.Mocked<Pick<McpServiceListManager, "getAgent" | "dispatchAs">> {
  return {
    getAgent: jest.fn((id: string) => agents.find((a) => a.id === id)),
    dispatchAs: jest.fn().mockResolvedValue({ success: true, output: "ok" }),
  } as unknown as jest.Mocked<Pick<McpServiceListManager, "getAgent" | "dispatchAs">>;
}

const dummyToolCall: ToolCall = { toolName: "do_thing", arguments: { x: 1 } };

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("CommunicationBridge", () => {
  describe("canDelegate", () => {
    it("returns false when fromAgent is unknown", () => {
      const mgr = makeMockManager([]);
      const bridge = new CommunicationBridge(mgr as unknown as McpServiceListManager);
      expect(bridge.canDelegate("ghost", "target")).toBe(false);
    });

    it("returns false when agent has no delegation targets", () => {
      const agent = makeAgent({ id: "a", name: "A" }); // no canDelegateTo or communication
      const mgr = makeMockManager([agent]);
      const bridge = new CommunicationBridge(mgr as unknown as McpServiceListManager);
      expect(bridge.canDelegate("a", "b")).toBe(false);
    });

    it("returns true when toAgent is explicitly in canDelegateTo", () => {
      const agent = makeAgent({ id: "a", name: "A", canDelegateTo: ["b"] });
      const mgr = makeMockManager([agent]);
      const bridge = new CommunicationBridge(mgr as unknown as McpServiceListManager);
      expect(bridge.canDelegate("a", "b")).toBe(true);
    });

    it("returns false when toAgent is not in canDelegateTo list", () => {
      const agent = makeAgent({ id: "a", name: "A", canDelegateTo: ["c"] });
      const mgr = makeMockManager([agent]);
      const bridge = new CommunicationBridge(mgr as unknown as McpServiceListManager);
      expect(bridge.canDelegate("a", "b")).toBe(false);
    });

    it("returns true when canDelegateTo contains wildcard '*'", () => {
      const agent = makeAgent({ id: "a", name: "A", canDelegateTo: ["*"] });
      const mgr = makeMockManager([agent]);
      const bridge = new CommunicationBridge(mgr as unknown as McpServiceListManager);
      expect(bridge.canDelegate("a", "anyone")).toBe(true);
    });

    it("returns true when communication.delegationTargets contains the target", () => {
      const agent = makeAgent({
        id: "a",
        name: "A",
        communication: { delegationTargets: ["b"] },
      });
      const mgr = makeMockManager([agent]);
      const bridge = new CommunicationBridge(mgr as unknown as McpServiceListManager);
      expect(bridge.canDelegate("a", "b")).toBe(true);
    });

    it("returns true when communication.delegationTargets contains '*'", () => {
      const agent = makeAgent({
        id: "a",
        name: "A",
        communication: { delegationTargets: ["*"] },
      });
      const mgr = makeMockManager([agent]);
      const bridge = new CommunicationBridge(mgr as unknown as McpServiceListManager);
      expect(bridge.canDelegate("a", "z")).toBe(true);
    });
  });

  describe("record", () => {
    it("records a message and returns it with id and timestamp", () => {
      const mgr = makeMockManager([]);
      const bridge = new CommunicationBridge(mgr as unknown as McpServiceListManager);
      const msg = bridge.record({
        type: "delegation",
        fromAgentId: "a",
        toAgentId: "b",
        payload: dummyToolCall,
        channel: "in-memory",
      });

      expect(msg.id).toMatch(/^msg-/);
      expect(msg.timestamp).toBeTruthy();
      expect(msg.fromAgentId).toBe("a");
      expect(msg.toAgentId).toBe("b");
    });

    it("persists messages in the log", () => {
      const mgr = makeMockManager([]);
      const bridge = new CommunicationBridge(mgr as unknown as McpServiceListManager);
      bridge.record({ type: "delegation", fromAgentId: "x", toAgentId: "y", payload: {}, channel: "in-memory" });
      bridge.record({ type: "query", fromAgentId: "p", toAgentId: "q", payload: {}, channel: "in-memory" });
      expect(bridge.getLog()).toHaveLength(2);
    });
  });

  describe("send", () => {
    it("returns allowed:false when delegation is not permitted", async () => {
      const agent = makeAgent({ id: "a", name: "A" }); // no targets
      const mgr = makeMockManager([agent]);
      const bridge = new CommunicationBridge(mgr as unknown as McpServiceListManager);
      const result = await bridge.send("a", "b", dummyToolCall);
      expect(result.allowed).toBe(false);
      expect(result.result).toBeUndefined();
    });

    it("returns allowed:true and the dispatch result when permitted", async () => {
      const agent = makeAgent({ id: "a", name: "A", canDelegateTo: ["b"] });
      const mgr = makeMockManager([agent]);
      const bridge = new CommunicationBridge(mgr as unknown as McpServiceListManager);
      const result = await bridge.send("a", "b", dummyToolCall);
      expect(result.allowed).toBe(true);
      expect(result.result?.success).toBe(true);
      expect(result.message).toBeDefined();
    });

    it("records the message in the log after a successful send", async () => {
      const agent = makeAgent({ id: "a", name: "A", canDelegateTo: ["b"] });
      const mgr = makeMockManager([agent]);
      const bridge = new CommunicationBridge(mgr as unknown as McpServiceListManager);
      await bridge.send("a", "b", dummyToolCall);
      const log = bridge.getLog();
      expect(log).toHaveLength(1);
      expect(log[0].fromAgentId).toBe("a");
      expect(log[0].toAgentId).toBe("b");
    });

    it("returns allowed:true with error result when dispatch throws", async () => {
      const agent = makeAgent({ id: "a", name: "A", canDelegateTo: ["b"] });
      const mgr = makeMockManager([agent]);
      (mgr.dispatchAs as jest.Mock).mockRejectedValueOnce(new Error("service down"));
      const bridge = new CommunicationBridge(mgr as unknown as McpServiceListManager);
      const result = await bridge.send("a", "b", dummyToolCall);
      expect(result.allowed).toBe(true);
      expect(result.result?.success).toBe(false);
      expect(result.result?.error).toBe("service down");
    });
  });

  describe("toDelegationLogEntry", () => {
    it("converts a BridgeMessage + ToolResult to a DelegationLogEntry", () => {
      const mgr = makeMockManager([]);
      const bridge = new CommunicationBridge(mgr as unknown as McpServiceListManager);
      const msg = bridge.record({
        type: "delegation",
        fromAgentId: "a",
        toAgentId: "b",
        payload: dummyToolCall,
        channel: "in-memory",
      });
      const toolResult: ToolResult = { success: true, output: "done" };
      const entry = bridge.toDelegationLogEntry(msg, toolResult);

      expect(entry.id).toBe(msg.id);
      expect(entry.fromAgentId).toBe("a");
      expect(entry.toAgentId).toBe("b");
      expect(entry.toolName).toBe("do_thing");
      expect(entry.success).toBe(true);
      expect(entry.output).toBe("done");
    });
  });
});
