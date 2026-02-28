import { useState, useEffect, useCallback } from "react";
import type { AgentEvent, AgentStatus, ToolCallRequest } from "../models/events";

interface UseEventStreamOptions {
  onToolCallRequest?: (req: ToolCallRequest) => void;
}

interface UseEventStreamResult {
  events: AgentEvent[];
  agentStatus: AgentStatus;
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

  const pushEvent = useCallback(
    (event: AgentEvent) => {
      setEvents((prev) => [...prev, event]);
      if (event.type === "StatusChanged") {
        setAgentStatus(event.status);
      }
      if (event.type === "ToolCallRequest" && options.onToolCallRequest) {
        options.onToolCallRequest(event.request);
      }
    },
    [options]
  );

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
        // Running in browser/dev mode – inject stub events
        const stub: AgentEvent = {
          type: "ChatMessage",
          message: {
            id: "stub-1",
            role: "assistant",
            content: "myExtBot is ready. (stub mode – Tauri not detected)",
            timestamp: new Date().toISOString(),
          },
        };
        pushEvent(stub);
      }
    }

    subscribe();
    return () => {
      unlisten?.();
    };
  }, [pushEvent]);

  return { events, agentStatus };
}
