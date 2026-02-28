/**
 * myExtBot Playwright Sidecar
 *
 * WebSocket JSON-RPC 2.0 server exposing browser automation methods.
 * Port: 9001 (override via SIDECAR_PORT env var)
 */

import { WebSocketServer, WebSocket } from "ws";
import { chromium, Browser, Page } from "playwright";

const PORT = parseInt(process.env["SIDECAR_PORT"] ?? "9001", 10);

// ── JSON-RPC types ────────────────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcSuccess {
  jsonrpc: "2.0";
  id: number | string;
  result: unknown;
}

interface JsonRpcError {
  jsonrpc: "2.0";
  id: number | string | null;
  error: { code: number; message: string; data?: unknown };
}

type JsonRpcResponse = JsonRpcSuccess | JsonRpcError;

// ── Browser state ─────────────────────────────────────────────────────────────

let browser: Browser | null = null;
let page: Page | null = null;

// ── Method handlers ───────────────────────────────────────────────────────────

type MethodHandler = (params: Record<string, unknown>) => Promise<unknown>;

const methods: Record<string, MethodHandler> = {
  /** Open a new browser (launches Chromium). */
  "browser.open": async (_params) => {
    if (browser) await browser.close();
    browser = await chromium.launch({ headless: false });
    const ctx = await browser.newContext();
    page = await ctx.newPage();
    return { status: "opened" };
  },

  /** Navigate to a URL. */
  "browser.goto": async (params) => {
    const url = params["url"] as string;
    if (!page) throw new Error("No page open. Call browser.open first.");
    await page.goto(url);
    return { url, title: await page.title() };
  },

  /** Take a screenshot and return base64-encoded PNG. */
  "browser.screenshot": async (_params) => {
    if (!page) throw new Error("No page open.");
    const buf = await page.screenshot({ type: "png" });
    return { image_b64: buf.toString("base64") };
  },

  /** Click an element matching a CSS selector. */
  "browser.click": async (params) => {
    const selector = params["selector"] as string;
    if (!page) throw new Error("No page open.");
    await page.click(selector);
    return { clicked: selector };
  },

  /** Type text into an element. */
  "browser.type": async (params) => {
    const selector = params["selector"] as string;
    const text = params["text"] as string;
    if (!page) throw new Error("No page open.");
    await page.fill(selector, text);
    return { typed: text };
  },

  /** Extract text/HTML from elements matching a selector. */
  "browser.extract": async (params) => {
    const selector = params["selector"] as string;
    const mode = (params["mode"] as string) ?? "text";
    if (!page) throw new Error("No page open.");
    if (mode === "html") {
      const html = await page.innerHTML(selector);
      return { html };
    }
    const text = await page.textContent(selector);
    return { text };
  },

  /** Close the browser. */
  "browser.close": async (_params) => {
    if (browser) {
      await browser.close();
      browser = null;
      page = null;
    }
    return { status: "closed" };
  },
};

// ── Server ────────────────────────────────────────────────────────────────────

function sendResponse(ws: WebSocket, response: JsonRpcResponse): void {
  ws.send(JSON.stringify(response));
}

const wss = new WebSocketServer({ port: PORT });

wss.on("listening", () => {
  console.log(`[sidecar] WebSocket JSON-RPC server listening on ws://127.0.0.1:${PORT}`);
});

wss.on("connection", (ws) => {
  console.log("[sidecar] Client connected");

  ws.on("message", async (raw) => {
    let req: JsonRpcRequest;
    try {
      req = JSON.parse(raw.toString()) as JsonRpcRequest;
    } catch {
      sendResponse(ws, {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      });
      return;
    }

    const handler = methods[req.method];
    if (!handler) {
      sendResponse(ws, {
        jsonrpc: "2.0",
        id: req.id,
        error: { code: -32601, message: `Method not found: ${req.method}` },
      });
      return;
    }

    try {
      const result = await handler(req.params ?? {});
      sendResponse(ws, { jsonrpc: "2.0", id: req.id, result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendResponse(ws, {
        jsonrpc: "2.0",
        id: req.id,
        error: { code: -32000, message },
      });
    }
  });

  ws.on("close", () => console.log("[sidecar] Client disconnected"));
});

process.on("SIGINT", async () => {
  console.log("[sidecar] Shutting down…");
  if (browser) await browser.close();
  wss.close(() => process.exit(0));
});
