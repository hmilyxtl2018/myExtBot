import { useState, useEffect, useCallback, useRef } from "react";
import type { AgentEvent, AgentPlan, AgentStatus, ToolCallRequest } from "../models/events";

interface UseEventStreamOptions {
  onToolCallRequest?: (req: ToolCallRequest) => void;
  onPlanReady?: (plan: AgentPlan) => void;
}

interface UseEventStreamResult {
  events: AgentEvent[];
  agentStatus: AgentStatus;
  sendMessage: (content: string) => Promise<void>;
}

const INITIAL_PLAN_STEPS = [
  { id: "p1", index: 0, description: "获取北京当前天气", status: "pending" as const },
  { id: "p2", index: 1, description: "大模型发展趋势热点分析", status: "pending" as const },
];

/** Stub event sequence injected in browser/dev mode (no Tauri). */
const STUB_EVENTS: Array<[number, AgentEvent]> = [
  // Gap 3: user message shown first so chat has context
  [0,    { type: "ChatMessage", message: { id: "m0", role: "user", content: "帮我查一下北京今天的天气，以及大模型发展的最新趋势", timestamp: new Date(Date.now()).toISOString() } }],
  [100,  { type: "StatusChanged", status: "Thinking" }],
  [300,  { type: "PlanUpdated", steps: INITIAL_PLAN_STEPS }],
  // Gap 10: AuditEntry stub — user message logged
  [350,  { type: "AuditEntry", entry: { id: "a1", session_id: "stub-session", event_type: "chat.message.sent", payload: { role: "user", chars: 21 }, timestamp: new Date(Date.now() + 350).toISOString() } }],
  [700,  { type: "AgentThinking", step: { id: "t1", content: "分析用户需求，制定执行计划：先获取北京实时天气，再进行大模型发展趋势分析。", timestamp: new Date(Date.now() + 700).toISOString() } }],
  [1100, { type: "PlanUpdated", steps: [{ ...INITIAL_PLAN_STEPS[0], status: "running" }, INITIAL_PLAN_STEPS[1]] }],
  [1300, { type: "StatusChanged", status: "RunningTool" }],
  [1400, { type: "ToolCallRequest", request: { id: "tc1", tool: "fetch_weather", params: { city: "北京", unit: "celsius" }, risk: "low", description: "调用天气 API 获取北京实时气温与天气状况", timestamp: new Date(Date.now() + 1400).toISOString() } }],
  [2100, { type: "ToolCallResult", result: { id: "tc1", tool: "fetch_weather", success: true, output: { city: "北京", temp: 22, condition: "晴", humidity: "45%", wind: "东南风 3 级" }, duration_ms: 680, timestamp: new Date(Date.now() + 2100).toISOString() } }],
  // Gap 10: AuditEntry stub — tool call completed
  [2150, { type: "AuditEntry", entry: { id: "a2", session_id: "stub-session", event_type: "tool.call.completed", payload: { tool: "fetch_weather", success: true, duration_ms: 680 }, timestamp: new Date(Date.now() + 2150).toISOString() } }],
  [2400, { type: "PlanUpdated", steps: [{ ...INITIAL_PLAN_STEPS[0], status: "done" }, { ...INITIAL_PLAN_STEPS[1], status: "running" }] }],
  [2600, { type: "AgentThinking", step: { id: "t2", content: "天气数据已获取（北京 22°C 晴）。开始第二步：搜索大模型发展趋势相关资讯，聚焦最新热点。", timestamp: new Date(Date.now() + 2600).toISOString() } }],
  [2900, { type: "StatusChanged", status: "RunningTool" }],
  [3000, { type: "ToolCallRequest", request: { id: "tc2", tool: "web_search", params: { query: "大模型发展趋势 2025 热点", top_k: 5 }, risk: "low", description: "搜索大模型（LLM）2025年发展趋势与热点关键词", timestamp: new Date(Date.now() + 3000).toISOString() } }],
  [3800, { type: "ToolCallResult", result: { id: "tc2", tool: "web_search", success: true, output: { results: ["多模态大模型持续演进", "端侧推理与轻量化模型崛起", "Agents & 工具调用成为主流范式", "RAG 增强检索成标配", "大模型安全与对齐受到广泛关注"] }, duration_ms: 820, timestamp: new Date(Date.now() + 3800).toISOString() } }],
  // Gap 10: AuditEntry stub — second tool call
  [3850, { type: "AuditEntry", entry: { id: "a3", session_id: "stub-session", event_type: "tool.call.completed", payload: { tool: "web_search", success: true, duration_ms: 820 }, timestamp: new Date(Date.now() + 3850).toISOString() } }],
  [4100, { type: "PlanUpdated", steps: [{ ...INITIAL_PLAN_STEPS[0], status: "done" }, { ...INITIAL_PLAN_STEPS[1], status: "done" }] }],
  [4300, { type: "StatusChanged", status: "Thinking" }],
  [4500, { type: "AgentThinking", step: { id: "t3", content: "所有子任务已完成。综合天气信息与大模型趋势数据，生成最终回复。", timestamp: new Date(Date.now() + 4500).toISOString() } }],
  // Gap 4: removed emoji from assistant message content
  [4900, { type: "ChatMessage", message: { id: "m1", role: "assistant", content: "北京今日天气：晴，气温 22°C，湿度 45%，东南风 3 级，适合出行。\n\n大模型 2025 发展热点：\n1. 多模态大模型持续演进，视觉-语言融合成主流；\n2. 端侧推理与轻量化模型崛起，降低部署门槛；\n3. Agents & 工具调用成为主流范式；\n4. RAG 增强检索已成标配；\n5. 大模型安全与对齐受到广泛关注。", timestamp: new Date(Date.now() + 4900).toISOString() } }],
  // Gap 10: AuditEntry stub — reply generated
  [4950, { type: "AuditEntry", entry: { id: "a4", session_id: "stub-session", event_type: "chat.message.sent", payload: { role: "assistant", chars: 145 }, timestamp: new Date(Date.now() + 4950).toISOString() } }],
  [5200, { type: "StatusChanged", status: "Completed" }],
];

/** Simple UUID fallback for non-secure contexts (e.g. file:// in dev mode). */
function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

/** Returns true when running inside a Tauri webview. */
function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}


/**
 * Subscribes to the Tauri event bus for agent events.
 * Falls back to stub data in browser/dev mode when Tauri is unavailable.
 */
export function useEventStream(
  options: UseEventStreamOptions = {}
): UseEventStreamResult {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [agentStatus, setAgentStatus] = useState<AgentStatus>("Idle");

  // Keep the callback in a ref so it never causes pushEvent to be recreated.
  const onToolCallRequestRef = useRef(options.onToolCallRequest);
  onToolCallRequestRef.current = options.onToolCallRequest;

  const onPlanReadyRef = useRef(options.onPlanReady);
  onPlanReadyRef.current = options.onPlanReady;

  // Guard so the dev-mode stub is injected only once even under React StrictMode
  // which intentionally mounts → unmounts → mounts again in development.
  const stubInjectedRef = useRef(false);

  // Tracks whether we are replaying stub events (no Tauri back-end).
  // In stub mode, ToolCallRequest events are shown in the log but must NOT
  // open the approval modal because nobody can respond to it in demo/dev mode.
  const stubModeRef = useRef(false);

  // Stable callback – no deps needed because callbacks are accessed via ref.
  const pushEvent = useCallback((event: AgentEvent) => {
    setEvents((prev) => [...prev, event]);
    if (event.type === "StatusChanged") {
      setAgentStatus(event.status);
    }
    if (
      event.type === "ToolCallRequest" &&
      onToolCallRequestRef.current &&
      !stubModeRef.current
    ) {
      onToolCallRequestRef.current(event.request);
    }
    if (
      event.type === "PlanReady" &&
      onPlanReadyRef.current &&
      !stubModeRef.current
    ) {
      onPlanReadyRef.current(event.plan);
    }
  }, []); // intentionally no deps – stable for the lifetime of the component

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    async function subscribe() {
      try {
        // Dynamic import so the module resolves only inside Tauri
        const { listen } = await import("@tauri-apps/api/event");
        const unlistenFn = await listen<AgentEvent>("agent-event", (e) => {
          pushEvent(e.payload);
        });
        unlisten = unlistenFn;
      } catch {
        // Running in browser/dev mode – replay stub events sequentially.
        // The ref guard prevents a second injection during React StrictMode's
        // intentional double-mount in development.
        if (!stubInjectedRef.current) {
          stubInjectedRef.current = true;
          stubModeRef.current = true;
          for (const [delay, event] of STUB_EVENTS) {
            setTimeout(() => pushEvent(event), delay);
          }
        }
      }
    }

    subscribe();
    return () => {
      unlisten?.();
    };
  }, [pushEvent]); // pushEvent is stable – this effect runs exactly once

  const sendMessage = useCallback(async (content: string): Promise<void> => {
    if (isTauri()) {
      // Running inside Tauri: forward to Rust backend.
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("send_message", { content });
    } else {
      // Dev/browser mode: push a local user ChatMessage so the chat panel updates.
      pushEvent({
        type: "ChatMessage",
        message: {
          id: generateId(),
          role: "user",
          content,
          timestamp: new Date().toISOString(),
        },
      });
    }
  }, [pushEvent]);

  return { events, agentStatus, sendMessage };
}


