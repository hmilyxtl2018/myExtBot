/**
 * Security middleware for the myExtBot management API.
 *
 * This module implements seven security layers that are applied globally to all
 * requests.  See server.ts for where each layer is mounted.
 *
 * Layer 1 — Security HTTP headers   (securityHeaders)
 * Layer 2 — CORS policy             (corsPolicy)
 * Layer 3 — General rate limiter    (rateLimiter)
 * Layer 4 — Write rate limiter      (writeRateLimiter)
 * Layer 5 — API key authentication  (requireApiKey)
 *
 * Configuration (environment variables):
 *   API_KEY          — Bearer / X-API-Key value required on /api/* routes.
 *                      If unset, auth is DISABLED (suitable for local dev only).
 *   CORS_ORIGIN      — Exact origin allowed for cross-origin requests.
 *                      If unset, no cross-origin requests are allowed.
 *   RATE_LIMIT_MAX   — Max requests per 60 s per IP (default: 120).
 *   WRITE_RATE_MAX   — Max mutating requests per 60 s per IP (default: 30).
 *   TRUST_PROXY      — Set to "true" to read client IP from X-Forwarded-For.
 */

import { Request, Response, NextFunction } from "express";

// ── Layer 1: Security HTTP Headers ───────────────────────────────────────────

/**
 * Adds defensive HTTP response headers to every response.
 *
 * - Content-Security-Policy: restricts resource loading to same origin and
 *   allows only inline scripts/styles (required for the embedded SPA).
 * - X-Frame-Options: prevents the page from being embedded in an iframe
 *   (clickjacking protection).
 * - X-Content-Type-Options: prevents MIME-type sniffing attacks.
 * - Referrer-Policy: limits referer header information leakage.
 * - Permissions-Policy: disables unused browser features.
 * - X-Powered-By is removed to avoid advertising the framework.
 */
export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  // Prevent clickjacking
  res.setHeader("X-Frame-Options", "DENY");
  // Prevent MIME-type sniffing
  res.setHeader("X-Content-Type-Options", "nosniff");
  // Limit referer leakage
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  // Disable unused browser features (management UI doesn't need any of these)
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  );
  // Content Security Policy:
  //   default-src 'self'      — default: same origin only
  //   script-src 'self' 'unsafe-inline'  — embedded SPA uses inline scripts
  //   style-src  'self' 'unsafe-inline'  — embedded SPA uses inline styles
  //   img-src    'self' data:            — UI uses data: URIs for icons
  //   connect-src 'self'                 — fetch() only to same origin
  //   frame-ancestors 'none'             — belt-and-suspenders for X-Frame-Options
  //   base-uri   'self'                  — prevent base-tag injection
  //   form-action 'self'                 — restrict form submission targets
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  );
  // Remove framework fingerprinting header
  res.removeHeader("X-Powered-By");
  next();
}

// ── Layer 2: CORS Policy ─────────────────────────────────────────────────────

/**
 * Enforces a strict same-origin CORS policy.
 *
 * By default, all cross-origin requests are denied.  Set the CORS_ORIGIN env
 * var to exactly one trusted origin (e.g. "https://my-dashboard.example.com")
 * to allow requests from that origin.
 *
 * Preflight OPTIONS requests are answered without auth checks.
 */
const ALLOWED_ORIGIN = process.env.CORS_ORIGIN?.trim() ?? "";

export function corsPolicy(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin;

  if (ALLOWED_ORIGIN && origin === ALLOWED_ORIGIN) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-API-Key",
    );
    res.setHeader("Access-Control-Max-Age", "86400");
    res.setHeader("Vary", "Origin");
  }

  // Handle preflight early (no auth needed for OPTIONS).
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  next();
}

// ── Layer 3 & 4: Rate Limiting ───────────────────────────────────────────────

interface RateBucket {
  count: number;
  resetAt: number; // epoch ms
}

const WINDOW_MS = 60_000; // 1 minute window
const READ_LIMIT = parseInt(process.env.RATE_LIMIT_MAX ?? "120", 10);
const WRITE_LIMIT = parseInt(process.env.WRITE_RATE_MAX ?? "30", 10);

const readBuckets = new Map<string, RateBucket>();
const writeBuckets = new Map<string, RateBucket>();

/** Extracts the client IP respecting optional proxy configuration. */
export function getClientIp(req: Request): string {
  if (process.env.TRUST_PROXY === "true") {
    const forwarded = req.headers["x-forwarded-for"];
    if (forwarded) return String(forwarded).split(",")[0].trim();
  }
  return req.socket?.remoteAddress ?? "unknown";
}

function checkBucket(
  map: Map<string, RateBucket>,
  key: string,
  max: number,
): boolean {
  const now = Date.now();
  let bucket = map.get(key);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + WINDOW_MS };
    map.set(key, bucket);
  }
  bucket.count++;
  return bucket.count <= max;
}

/**
 * General rate limiter: max `RATE_LIMIT_MAX` requests per 60 s per IP.
 * Applied to all /api/* routes.
 */
export function rateLimiter(req: Request, res: Response, next: NextFunction): void {
  const ip = getClientIp(req);
  if (!checkBucket(readBuckets, ip, READ_LIMIT)) {
    res.setHeader("Retry-After", "60");
    res
      .status(429)
      .json({ ok: false, error: "Too many requests — please wait a minute and try again." });
    return;
  }
  next();
}

/**
 * Write rate limiter: max `WRITE_RATE_MAX` mutating requests per 60 s per IP.
 * Applied only to POST, PATCH, PUT, DELETE.
 */
export function writeRateLimiter(req: Request, res: Response, next: NextFunction): void {
  if (!["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) {
    next();
    return;
  }
  const ip = getClientIp(req);
  if (!checkBucket(writeBuckets, ip, WRITE_LIMIT)) {
    res.setHeader("Retry-After", "60");
    res.status(429).json({
      ok: false,
      error: "Too many write operations — please wait a minute and try again.",
    });
    return;
  }
  next();
}

// Periodic cleanup — purge expired buckets to prevent memory leaks from
// long-running servers with many distinct IPs.
const CLEANUP_INTERVAL = 10 * 60_000; // every 10 minutes
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [k, b] of readBuckets) {
    if (now >= b.resetAt) readBuckets.delete(k);
  }
  for (const [k, b] of writeBuckets) {
    if (now >= b.resetAt) writeBuckets.delete(k);
  }
}, CLEANUP_INTERVAL);
// Allow Node.js to exit even if this timer is still active.
cleanupTimer.unref();

// ── Layer 5: API Key Authentication ─────────────────────────────────────────

/**
 * Optional Bearer / X-API-Key authentication for all /api/* routes.
 *
 * When API_KEY is set:
 *   - Every request to /api/* must include either:
 *       Authorization: Bearer <key>
 *     or:
 *       X-API-Key: <key>
 *   - Requests without a valid key receive a 401 Unauthorized response.
 *
 * When API_KEY is not set (default):
 *   - Authentication is disabled.  Suitable for local development only.
 *   - A warning is printed to the console at startup.
 */
const API_KEY = process.env.API_KEY?.trim() ?? "";

export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  // Auth is disabled when no API_KEY is configured.
  if (!API_KEY) {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  const xApiKey = req.headers["x-api-key"];

  const provided =
    (typeof authHeader === "string" && authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : "") || (typeof xApiKey === "string" ? xApiKey : "");

  if (!provided || provided !== API_KEY) {
    res.status(401).json({
      ok: false,
      error:
        "Unauthorized — include a valid key in `Authorization: Bearer <key>` or `X-API-Key: <key>`.",
    });
    return;
  }

  next();
}

// ── Startup banner ────────────────────────────────────────────────────────────

/**
 * Prints the security configuration summary at server startup.
 * Call this once after the server begins listening.
 */
export function printSecurityStatus(): void {
  console.log("─────────────────────────────────────────────");
  console.log("🔒 Security configuration:");
  if (API_KEY) {
    console.log("   ✅ API key authentication  ENABLED");
  } else {
    console.log("   ⚠️  API key authentication  DISABLED  (set API_KEY env var to enable)");
  }
  if (ALLOWED_ORIGIN) {
    console.log(`   ✅ CORS origin             ${ALLOWED_ORIGIN}`);
  } else {
    console.log("   ℹ️  CORS                    same-origin only (set CORS_ORIGIN to allow cross-origin)");
  }
  console.log(`   ✅ Rate limit (read)        ${READ_LIMIT} req / 60 s per IP`);
  console.log(`   ✅ Rate limit (write)       ${WRITE_LIMIT} req / 60 s per IP`);
  console.log("   ✅ Security headers         enabled (CSP, X-Frame-Options, …)");
  console.log("   ✅ Audit log                enabled  →  GET /api/security/audit-log");
  console.log("─────────────────────────────────────────────");
}
