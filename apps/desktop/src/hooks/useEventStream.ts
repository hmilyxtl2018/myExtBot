import { useState, useEffect, useCallback, useRef } from "react";
import type { AgentEvent, AgentStatus, ToolCallRequest } from "../models/events";

interface UseEventStreamOptions {
  onToolCallRequest?: (req: ToolCallRequest) => void;
}

interface UseEventStreamResult {
  events: AgentEvent[];
  agentStatus: AgentStatus;
}

/** Default plan shown until the backend sends its own PlanUpdated event */
const DEFAULT_PLAN_EVENT: AgentEvent = {
  type: "PlanUpdated",
  steps: [
    {
      id: "default-plan-1",
      index: 0,
      description: "获取天气",
      status: "pending",
    },
    {
      id: "default-plan-2",
      index: 1,
      description: "大模型发展趋势热点分析",
      status: "pending",
    },
  ],
};

/**
 * Subscribes to the Tauri event bus for agent events.
 * Falls back to stub data in browser/dev mode when Tauri is unavailable.
 */
export function useEventStream(
  options: UseEventStreamOptions = {}
): UseEventStreamResult {
  const [events, setEvents] = useState<AgentEvent[]>([DEFAULT_PLAN_EVENT]);
  const [agentStatus, setAgentStatus] = useState<AgentStatus>("Idle");

  // Keep the callback in a ref so it never causes pushEvent to be recreated.
  const onToolCallRequestRef = useRef(options.onToolCallRequest);
  onToolCallRequestRef.current = options.onToolCallRequest;

  // Guard so the dev-mode stub is injected only once even under React StrictMode
  // which intentionally mounts → unmounts → mounts again in development.
  const stubInjectedRef = useRef(false);

  // Stable callback – no deps needed because callbacks are accessed via ref.
  const pushEvent = useCallback((event: AgentEvent) => {
    setEvents((prev) => [...prev, event]);
    if (event.type === "StatusChanged") {
      setAgentStatus(event.status);
    }
    if (event.type === "ToolCallRequest" && onToolCallRequestRef.current) {
      onToolCallRequestRef.current(event.request);
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
        // Running in browser/dev mode – inject a single stub event.
        // The ref guard prevents a second injection during React StrictMode's
        // intentional double-mount in development.
        if (!stubInjectedRef.current) {
          stubInjectedRef.current = true;
          pushEvent({
            type: "ChatMessage",
            message: {
              id: crypto.randomUUID(),
              role: "assistant",
              content: "myExtBot is ready. (stub mode – Tauri not detected)",
              timestamp: new Date().toISOString(),
            },
          });
        }
      }
    }

    subscribe();
    return () => {
      unlisten?.();
    };
  }, [pushEvent]); // pushEvent is stable – this effect runs exactly once

  return { events, agentStatus };
}
