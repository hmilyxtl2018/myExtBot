import axios from "axios";
import { SearchService } from "../SearchService";
import type { ToolCall } from "../../core/types";

jest.mock("axios");
const mockedPost = jest.mocked(axios.post);

const DEFAULT_TIMEOUT_MS = 10_000;

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCall(query: string, maxResults?: number): ToolCall {
  return {
    toolName: "search_web",
    arguments: maxResults !== undefined ? { query, maxResults } : { query },
  };
}

function makePerplexityResponse(
  content: string,
  citations: string[] = [],
): { data: object } {
  return {
    data: {
      choices: [{ message: { role: "assistant", content } }],
      citations,
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("SearchService", () => {
  let service: SearchService;

  beforeEach(() => {
    service = new SearchService();
    jest.resetAllMocks();
    delete process.env["PERPLEXITY_API_KEY"];
  });

  // ── Unknown tool ────────────────────────────────────────────────────────────

  describe("unknown tool", () => {
    it("returns success:false for an unknown tool name", async () => {
      const call: ToolCall = { toolName: "unknown_tool", arguments: {} };
      const result = await service.execute(call);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Unknown tool/);
    });
  });

  // ── Fallback (no API key) ───────────────────────────────────────────────────

  describe("stub fallback — no API key", () => {
    it("returns stub results when PERPLEXITY_API_KEY is not set", async () => {
      const result = await service.execute(makeCall("typescript"));
      expect(result.success).toBe(true);
      const output = result.output as { query: string; results: unknown[] };
      expect(output.query).toBe("typescript");
      expect(output.results).toHaveLength(5);
    });

    it("respects maxResults in stub mode", async () => {
      const result = await service.execute(makeCall("hello", 3));
      const output = result.output as { results: unknown[] };
      expect(output.results).toHaveLength(3);
    });

    it("caps stub results at 5", async () => {
      const result = await service.execute(makeCall("hello", 10));
      const output = result.output as { results: unknown[] };
      expect(output.results).toHaveLength(5);
    });

    it("stub results have the expected shape", async () => {
      const result = await service.execute(makeCall("cats"));
      const output = result.output as {
        results: Array<{ title: string; url: string; snippet: string }>;
      };
      expect(output.results[0]).toMatchObject({
        title: 'Result 1 for "cats"',
        url: "https://example.com/result-1",
        snippet: 'This is a stub result about "cats".',
      });
    });

    it("does not call axios when no API key is set", async () => {
      await service.execute(makeCall("test"));
      expect(mockedPost).not.toHaveBeenCalled();
    });
  });

  // ── Real API path ───────────────────────────────────────────────────────────

  describe("real API path — PERPLEXITY_API_KEY is set", () => {
    beforeEach(() => {
      process.env["PERPLEXITY_API_KEY"] = "test-key-123";
    });

    it("calls the Perplexity API with the correct URL and auth header", async () => {
      mockedPost.mockResolvedValueOnce(
        makePerplexityResponse("Some result", ["https://example.com/a"]),
      );

      await service.execute(makeCall("openai"));

      expect(mockedPost).toHaveBeenCalledWith(
        "https://api.perplexity.ai/chat/completions",
        expect.objectContaining({ model: "sonar" }),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-key-123",
          }),
        }),
      );
    });

    it("returns normalised results with citations as URLs", async () => {
      mockedPost.mockResolvedValueOnce(
        makePerplexityResponse("First result\nSecond result", [
          "https://site.com/1",
          "https://site.com/2",
        ]),
      );

      const result = await service.execute(makeCall("node.js", 2));
      expect(result.success).toBe(true);
      const output = result.output as {
        results: Array<{ title: string; url: string; snippet: string }>;
      };
      expect(output.results).toHaveLength(2);
      expect(output.results[0].url).toBe("https://site.com/1");
      expect(output.results[1].url).toBe("https://site.com/2");
    });

    it("caps results at maxResults even when API returns more citations", async () => {
      mockedPost.mockResolvedValueOnce(
        makePerplexityResponse("a\nb\nc", [
          "https://a.com",
          "https://b.com",
          "https://c.com",
        ]),
      );

      const result = await service.execute(makeCall("test", 2));
      const output = result.output as { results: unknown[] };
      expect(output.results).toHaveLength(2);
    });

    it("uses content lines as snippets when normalising results", async () => {
      mockedPost.mockResolvedValueOnce(
        makePerplexityResponse("1. Great snippet here", ["https://example.com/r"]),
      );

      const result = await service.execute(makeCall("snippet test", 1));
      const output = result.output as {
        results: Array<{ snippet: string }>;
      };
      expect(output.results[0].snippet).toBe("Great snippet here");
    });

    it("returns success:true with real results when API succeeds", async () => {
      mockedPost.mockResolvedValueOnce(
        makePerplexityResponse("answer", ["https://ref.com"]),
      );
      const result = await service.execute(makeCall("query"));
      expect(result.success).toBe(true);
    });
  });

  // ── Error scenarios ─────────────────────────────────────────────────────────

  describe("error handling — falls back to stub", () => {
    beforeEach(() => {
      process.env["PERPLEXITY_API_KEY"] = "test-key";
    });

    it("falls back to stub on network error", async () => {
      mockedPost.mockRejectedValueOnce(new Error("ECONNREFUSED"));

      const result = await service.execute(makeCall("network-test"));
      expect(result.success).toBe(true);
      const output = result.output as { results: unknown[] };
      expect(output.results.length).toBeGreaterThan(0);
    });

    it("falls back to stub on HTTP 429 (rate limit)", async () => {
      const err = Object.assign(new Error("rate limited"), {
        response: { status: 429 },
      });
      mockedPost.mockRejectedValueOnce(err);

      const result = await service.execute(makeCall("rate-limit-test"));
      expect(result.success).toBe(true);
      const output = result.output as {
        results: Array<{ snippet: string }>;
      };
      expect(output.results[0].snippet).toMatch(/stub/);
    });

    it("falls back to stub on HTTP 401 (invalid key)", async () => {
      const err = Object.assign(new Error("unauthorized"), {
        response: { status: 401 },
      });
      mockedPost.mockRejectedValueOnce(err);

      const result = await service.execute(makeCall("auth-test"));
      expect(result.success).toBe(true);
      const output = result.output as {
        results: Array<{ snippet: string }>;
      };
      expect(output.results[0].snippet).toMatch(/stub/);
    });

    it("never throws — always returns a valid ToolResult", async () => {
      mockedPost.mockRejectedValueOnce(new Error("unexpected failure"));
      await expect(service.execute(makeCall("safe-test"))).resolves.toMatchObject({
        success: true,
      });
    });
  });

  // ── Retry behaviour ─────────────────────────────────────────────────────────

  describe("retry behaviour", () => {
    beforeEach(() => {
      process.env["PERPLEXITY_API_KEY"] = "key";
    });

    it("with maxAttempts=1 (default) makes exactly one API call on failure", async () => {
      mockedPost.mockRejectedValue(new Error("timeout"));
      await service.execute(makeCall("retry-test"));
      expect(mockedPost).toHaveBeenCalledTimes(1);
    });

    it("with maxAttempts=2 retries once on network failure", async () => {
      const svc = new SearchService(DEFAULT_TIMEOUT_MS, 2);
      mockedPost
        .mockRejectedValueOnce(new Error("first fail"))
        .mockResolvedValueOnce(
          makePerplexityResponse("ok", ["https://success.com"]),
        );

      const result = await svc.execute(makeCall("retry-ok"));
      expect(result.success).toBe(true);
      expect(mockedPost).toHaveBeenCalledTimes(2);
    });

    it("does not retry on 429", async () => {
      const svc = new SearchService(DEFAULT_TIMEOUT_MS, 3);
      const err = Object.assign(new Error("rate limited"), {
        response: { status: 429 },
      });
      mockedPost.mockRejectedValue(err);

      await svc.execute(makeCall("no-retry-429"));
      expect(mockedPost).toHaveBeenCalledTimes(1);
    });

    it("does not retry on 401", async () => {
      const svc = new SearchService(DEFAULT_TIMEOUT_MS, 3);
      const err = Object.assign(new Error("unauthorized"), {
        response: { status: 401 },
      });
      mockedPost.mockRejectedValue(err);

      await svc.execute(makeCall("no-retry-401"));
      expect(mockedPost).toHaveBeenCalledTimes(1);
    });
  });
});
