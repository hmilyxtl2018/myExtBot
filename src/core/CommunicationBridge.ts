import type { McpServiceListManager } from "./McpServiceListManager";
import type { CommunicationConfig, DelegationLogEntry, MessageType, ToolCall, ToolResult } from "./types";

export interface BridgeMessage {
  id: string;
  type: MessageType;
  fromAgentId: string;
  toAgentId: string;
  payload: unknown;
  timestamp: string;
  channel: "in-memory" | "sqlite" | "both";
}

export class CommunicationBridge {
  private messageLog: BridgeMessage[] = [];
  private static readonly MAX_LOG = 100;

  constructor(private readonly manager: McpServiceListManager) {}

  /** Check whether fromAgent is allowed to delegate to toAgent.
   * Checks both `communication.delegationTargets` (Pillar 7) and legacy `canDelegateTo`
   * so that agents configured with either field are handled correctly.
   */
  canDelegate(fromAgentId: string, toAgentId: string): boolean {
    const agent = this.manager.getAgent(fromAgentId);
    if (!agent) return false;
    // Union of Pillar-7 targets and legacy canDelegateTo
    const communicationTargets = agent.communication?.delegationTargets ?? [];
    const legacyTargets = agent.canDelegateTo ?? [];
    const allTargets = [...new Set([...communicationTargets, ...legacyTargets])];
    if (allTargets.length === 0) return false;
    return allTargets.includes("*") || allTargets.includes(toAgentId);
  }

  /** Record a message in the bridge log. */
  record(message: Omit<BridgeMessage, "id" | "timestamp">): BridgeMessage {
    const entry: BridgeMessage = {
      ...message,
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
    };
    this.messageLog.push(entry);
    if (this.messageLog.length > CommunicationBridge.MAX_LOG) {
      this.messageLog.shift();
    }
    return entry;
  }

  /**
   * Send a delegation from one agent to another, validating permissions.
   */
  async send(
    fromAgentId: string,
    toAgentId: string,
    toolCall: ToolCall,
    messageType: MessageType = "delegation"
  ): Promise<{ allowed: boolean; result?: ToolResult; message?: BridgeMessage }> {
    if (!this.canDelegate(fromAgentId, toAgentId)) {
      return { allowed: false };
    }

    const fromAgent = this.manager.getAgent(fromAgentId);
    const config: CommunicationConfig = fromAgent?.communication ?? {};
    const channel = config.channel ?? "in-memory";

    const bridgeMessage = this.record({
      type: messageType,
      fromAgentId,
      toAgentId,
      payload: toolCall,
      channel,
    });

    const result = await this.manager.dispatchAs(toAgentId, toolCall).catch(
      (err: unknown): ToolResult => ({
        success: false,
        error: (err as Error).message ?? String(err),
      })
    );
    return { allowed: true, result, message: bridgeMessage };
  }

  /** Convert a BridgeMessage to a DelegationLogEntry format. */
  toDelegationLogEntry(msg: BridgeMessage, result: ToolResult): DelegationLogEntry {
    const tc = msg.payload as ToolCall;
    return {
      id: msg.id,
      timestamp: msg.timestamp,
      fromAgentId: msg.fromAgentId,
      toAgentId: msg.toAgentId,
      toolName: tc?.toolName ?? "unknown",
      arguments: tc?.arguments ?? {},
      success: result.success,
      output: result.output,
      error: result.error,
    };
  }

  getLog(): BridgeMessage[] {
    return [...this.messageLog];
  }
}
