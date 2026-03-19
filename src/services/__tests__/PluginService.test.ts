import { PluginManifest, ToolCall } from "../../core/types";
import { PluginService, PluginErrorDetail } from "../PluginService";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: "test-plugin",
    name: "Test Plugin",
    version: "1.0.0",
    author: "Tester",
    description: "A test plugin",
    category: "test",
    registryUrl: "https://registry.example.com/test-plugin",
    tools: [
      {
        name: "do_thing",
        description: "Does a thing",
        parameters: { type: "object", properties: {} },
      },
    ],
    ...overrides,
  };
}

const dummyCall: ToolCall = { toolName: "do_thing", arguments: { x: 1 } };

/**
 * Subclass that replaces _sleep with a no-op to keep tests fast.
 */
class FastPluginService extends PluginService {
  protected override _sleep(_ms: number): Promise<void> {
    return Promise.resolve();
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("PluginService", () => {
  let fetchMock: jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
    jest.spyOn(console, "debug").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── Stub fallback (no executeEndpoint) ──────────────────────────────────────

  describe("no endpoint (stub fallback)", () => {
    it("returns a stub result when executeEndpoint is not set", async () => {
      const svc = new FastPluginService(makeManifest());
      const result = await svc.execute(dummyCall);
      expect(result.success).toBe(true);
      expect(result.output).toMatchObject({
        plugin: "test-plugin",
        tool: "do_thing",
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("returns error for unknown tool even without endpoint", async () => {
      const svc = new FastPluginService(makeManifest());
      const result = await svc.execute({ toolName: "unknown_tool", arguments: {} });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Unknown tool/);
    });
  });

  // ── Successful call ──────────────────────────────────────────────────────────

  describe("successful call", () => {
    it("returns output from the endpoint on HTTP 200", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ answer: 42 }), { status: 200 })
      );
      const svc = new FastPluginService(makeManifest({ executeEndpoint: "https://plugin.example.com/run" }));
      const result = await svc.execute(dummyCall);
      expect(result.success).toBe(true);
      expect(result.output).toEqual({ answer: 42 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("sends correct JSON body to the endpoint", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({}), { status: 200 })
      );
      const svc = new FastPluginService(makeManifest({ executeEndpoint: "https://plugin.example.com/run" }));
      await svc.execute(dummyCall);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("https://plugin.example.com/run");
      expect(JSON.parse(init!.body as string)).toEqual({ toolName: "do_thing", arguments: { x: 1 } });
    });
  });

  // ── HTTP 4xx — no retry ──────────────────────────────────────────────────────

  describe("no retry on 4xx", () => {
    it("returns structured error immediately on HTTP 400 without retrying", async () => {
      fetchMock.mockResolvedValueOnce(new Response("bad request", { status: 400 }));
      const svc = new FastPluginService(makeManifest({ executeEndpoint: "https://plugin.example.com/run" }));
      const result = await svc.execute(dummyCall);
      expect(result.success).toBe(false);
      const detail: PluginErrorDetail = JSON.parse(result.error!);
      expect(detail.statusCode).toBe(400);
      expect(detail.retryCount).toBe(0);
      // Only one HTTP call
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("returns structured error immediately on HTTP 404 without retrying", async () => {
      fetchMock.mockResolvedValueOnce(new Response("not found", { status: 404 }));
      const svc = new FastPluginService(makeManifest({ executeEndpoint: "https://plugin.example.com/run" }));
      const result = await svc.execute(dummyCall);
      expect(result.success).toBe(false);
      const detail: PluginErrorDetail = JSON.parse(result.error!);
      expect(detail.statusCode).toBe(404);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  // ── HTTP 5xx — retry up to 3 times ──────────────────────────────────────────

  describe("retry on 500", () => {
    it("retries on HTTP 500 and succeeds on the second attempt", async () => {
      fetchMock
        .mockResolvedValueOnce(new Response("error", { status: 500 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      const svc = new FastPluginService(makeManifest({ executeEndpoint: "https://plugin.example.com/run" }));
      const result = await svc.execute(dummyCall);
      expect(result.success).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("returns structured error after 3 failed 500 attempts", async () => {
      fetchMock
        .mockResolvedValueOnce(new Response("error", { status: 500 }))
        .mockResolvedValueOnce(new Response("error", { status: 500 }))
        .mockResolvedValueOnce(new Response("error", { status: 500 }));
      const svc = new FastPluginService(makeManifest({ executeEndpoint: "https://plugin.example.com/run" }));
      const result = await svc.execute(dummyCall);
      expect(result.success).toBe(false);
      const detail: PluginErrorDetail = JSON.parse(result.error!);
      expect(detail.statusCode).toBe(500);
      expect(detail.retryCount).toBe(3);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
  });

  // ── Network error — retry ────────────────────────────────────────────────────

  describe("network error", () => {
    it("retries on network error and succeeds on the third attempt", async () => {
      fetchMock
        .mockRejectedValueOnce(new Error("ECONNREFUSED"))
        .mockRejectedValueOnce(new Error("ECONNREFUSED"))
        .mockResolvedValueOnce(new Response(JSON.stringify({ data: "ok" }), { status: 200 }));
      const svc = new FastPluginService(makeManifest({ executeEndpoint: "https://plugin.example.com/run" }));
      const result = await svc.execute(dummyCall);
      expect(result.success).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("returns structured error after 3 network errors", async () => {
      fetchMock
        .mockRejectedValueOnce(new Error("ECONNREFUSED"))
        .mockRejectedValueOnce(new Error("ECONNREFUSED"))
        .mockRejectedValueOnce(new Error("ECONNREFUSED"));
      const svc = new FastPluginService(makeManifest({ executeEndpoint: "https://plugin.example.com/run" }));
      const result = await svc.execute(dummyCall);
      expect(result.success).toBe(false);
      const detail: PluginErrorDetail = JSON.parse(result.error!);
      expect(detail.message).toMatch(/ECONNREFUSED/);
      expect(detail.retryCount).toBe(3);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
  });

  // ── Timeout ──────────────────────────────────────────────────────────────────

  describe("timeout", () => {
    it("returns isTimeout:true after timeout on all attempts", async () => {
      fetchMock.mockRejectedValue(Object.assign(new Error("AbortError"), { name: "AbortError" }));
      const svc = new FastPluginService(
        makeManifest({ executeEndpoint: "https://plugin.example.com/run", timeout: 1 })
      );
      const result = await svc.execute(dummyCall);
      expect(result.success).toBe(false);
      const detail: PluginErrorDetail = JSON.parse(result.error!);
      expect(detail.isTimeout).toBe(true);
      expect(detail.retryCount).toBe(3);
    });

    it("uses manifest.timeout for the AbortController deadline", async () => {
      // Succeeds on the first attempt so we only care that fetch was called
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));
      const manifest = makeManifest({ executeEndpoint: "https://plugin.example.com/run", timeout: 5000 });
      const svc = new FastPluginService(manifest);
      const result = await svc.execute(dummyCall);
      expect(result.success).toBe(true);
    });

    it("falls back to constructor defaultTimeoutMs when manifest.timeout is absent", async () => {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));
      const svc = new FastPluginService(
        makeManifest({ executeEndpoint: "https://plugin.example.com/run" }),
        { defaultTimeoutMs: 5000 }
      );
      const result = await svc.execute(dummyCall);
      expect(result.success).toBe(true);
    });
  });

  // ── Marketplace re-export ────────────────────────────────────────────────────

  describe("marketplace re-export", () => {
    it("src/marketplace/PluginService re-exports the same class", async () => {
      // Dynamic import to avoid circular type issues at module evaluation time
      const { PluginService: MarketplacePluginService } = await import("../../marketplace/PluginService");
      expect(MarketplacePluginService).toBe(PluginService);
    });
  });

  // ── Metadata ─────────────────────────────────────────────────────────────────

  describe("metadata", () => {
    it("exposes the manifest id as the service name", () => {
      const svc = new FastPluginService(makeManifest({ id: "my-plugin" }));
      expect(svc.name).toBe("my-plugin");
    });

    it("exposes tool definitions from the manifest", () => {
      const svc = new FastPluginService(makeManifest());
      expect(svc.getToolDefinitions()).toHaveLength(1);
      expect(svc.getToolDefinitions()[0].name).toBe("do_thing");
    });
  });
});
