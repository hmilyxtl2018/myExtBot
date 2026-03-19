import { PluginService } from "../PluginService";
import { PluginManifest, ToolCall } from "../../core/types";

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: "test-plugin",
    name: "Test Plugin",
    version: "1.0.0",
    author: "tester",
    description: "A test plugin",
    category: "test",
    registryUrl: "https://registry.example.com/test-plugin",
    tools: [
      {
        name: "do-something",
        description: "Does something",
        parameters: { type: "object", properties: {}, required: [] },
      },
    ],
    ...overrides,
  };
}

const call: ToolCall = {
  toolName: "do-something",
  arguments: { key: "value" },
};

// ── Mock global fetch ──────────────────────────────────────────────────────────

let mockFetch: jest.Mock;

beforeEach(() => {
  jest.useFakeTimers();
  mockFetch = jest.fn();
  global.fetch = mockFetch;
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("PluginService — stub fallback (no endpoint)", () => {
  it("returns a stub result with [stub] prefix when executeEndpoint is absent", async () => {
    const svc = new PluginService(makeManifest());
    const result = await svc.execute(call);
    expect(result.success).toBe(true);
    expect((result.output as Record<string, unknown>).note).toContain("[stub]");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns error for unknown tool names even with no endpoint", async () => {
    const svc = new PluginService(makeManifest());
    const result = await svc.execute({ toolName: "nonexistent", arguments: {} });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Unknown tool/);
  });
});

describe("PluginService — URL validation", () => {
  it("rejects non-http(s) endpoint URLs (e.g. file://)", async () => {
    const svc = new PluginService(
      makeManifest({ executeEndpoint: "file:///etc/passwd" })
    );
    const result = await svc.execute(call);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/http.*https/i);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects completely invalid URLs", async () => {
    const svc = new PluginService(
      makeManifest({ executeEndpoint: "not-a-url" })
    );
    const result = await svc.execute(call);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid plugin endpoint URL/i);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("PluginService — successful HTTP call", () => {
  it("POSTs to endpoint and returns parsed JSON on 200", async () => {
    const responseBody = { answer: 42 };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => responseBody,
    });

    const svc = new PluginService(
      makeManifest({ executeEndpoint: "https://api.example.com/execute" })
    );
    const result = await svc.execute(call);

    expect(result.success).toBe(true);
    expect(result.output).toEqual(responseBody);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.example.com/execute");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body as string)).toMatchObject({
      toolName: call.toolName,
      arguments: call.arguments,
    });
  });
});

describe("PluginService — HTTP 4xx (no retry)", () => {
  it("returns error immediately on 400 without retrying", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({}),
    });

    const svc = new PluginService(
      makeManifest({
        executeEndpoint: "https://api.example.com/execute",
        retryConfig: { maxRetries: 3, backoffMs: 10 },
      })
    );
    const result = await svc.execute(call);

    expect(result.success).toBe(false);
    expect(result.error).toContain("400");
    expect((result.output as Record<string, unknown>).errorType).toBe("http_4xx");
    // fetch should have been called only once (no retries)
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe("PluginService — HTTP 5xx with retry", () => {
  it("retries on 500 and succeeds on 2nd attempt", async () => {
    const responseBody = { ok: true };
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => responseBody });

    const svc = new PluginService(
      makeManifest({
        executeEndpoint: "https://api.example.com/execute",
        retryConfig: { maxRetries: 3, backoffMs: 10 },
      })
    );

    // Run execute concurrently and advance fake timers to resolve backoff delays
    const resultPromise = svc.execute(call);
    // Advance timers to skip the 10 ms backoff
    await jest.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.success).toBe(true);
    expect(result.output).toEqual(responseBody);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("exhausts all retries and returns structured error when every attempt returns 500", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    const svc = new PluginService(
      makeManifest({
        executeEndpoint: "https://api.example.com/execute",
        retryConfig: { maxRetries: 2, backoffMs: 10 },
      })
    );

    const resultPromise = svc.execute(call);
    await jest.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.success).toBe(false);
    expect(result.error).toContain("500");
    const output = result.output as Record<string, unknown>;
    expect(output.errorType).toBe("http_5xx");
    expect(output.retryCount).toBe(2);
    // 1 initial + 2 retries = 3 total fetch calls
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
});

describe("PluginService — network error with retry exhaustion", () => {
  it("retries on network error and returns structured error after all attempts", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

    const svc = new PluginService(
      makeManifest({
        executeEndpoint: "https://api.example.com/execute",
        retryConfig: { maxRetries: 2, backoffMs: 10 },
      })
    );

    const resultPromise = svc.execute(call);
    await jest.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.success).toBe(false);
    expect(result.error).toContain("ECONNREFUSED");
    const output = result.output as Record<string, unknown>;
    expect(output.errorType).toBe("network");
    expect(output.retryCount).toBe(2);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
});

describe("PluginService — timeout", () => {
  it("aborts request and returns timeout error", async () => {
    // fetch never resolves (simulates a hang); AbortController will cancel it
    mockFetch.mockImplementation(
      (_url: string, opts: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          opts.signal?.addEventListener("abort", () => {
            const err = new Error("The user aborted a request.");
            err.name = "AbortError";
            reject(err);
          });
        })
    );

    const svc = new PluginService(
      makeManifest({
        executeEndpoint: "https://api.example.com/execute",
        timeout: 100,
        retryConfig: { maxRetries: 0, backoffMs: 10 },
      })
    );

    const resultPromise = svc.execute(call);
    // Advance timers to trigger the AbortController timeout
    await jest.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/timed out/i);
  });
});

describe("PluginService — marketplace re-export", () => {
  it("re-exports the same PluginService class from src/marketplace/PluginService", async () => {
    const { PluginService: MarketplacePS } = await import("../../marketplace/PluginService");
    const svc = new MarketplacePS(makeManifest());
    const result = await svc.execute(call);
    expect(result.success).toBe(true);
    expect((result.output as Record<string, unknown>).note).toContain("[stub]");
  });
});
