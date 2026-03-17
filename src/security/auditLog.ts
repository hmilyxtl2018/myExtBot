/**
 * Security audit log for the myExtBot management API.
 *
 * Every mutating operation (POST, PATCH, DELETE) is recorded here so operators
 * can review what changes were made, when, and by whom.
 *
 * Implementation notes:
 * - Stored in-memory (resets on server restart) — suitable for development
 *   and single-process deployments.  For production, pipe to a persistent
 *   store by replacing `appendEntry()`.
 * - Capped at MAX_ENTRIES to prevent unbounded memory growth.
 * - The log is exposed via GET /api/security/audit-log (requires API key if
 *   authentication is enabled).
 */

import { Request } from "express";
import { getClientIp } from "./middleware";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AuditEntry {
  /** ISO 8601 timestamp of the operation. */
  timestamp: string;
  /** HTTP method (POST, PATCH, DELETE, etc.). */
  method: string;
  /** URL path of the request (e.g. "/api/agents/research-bot"). */
  path: string;
  /** Client IP address.  May be "unknown" if unavailable. */
  ip: string;
  /**
   * HTTP status code that was returned.
   * Populated after the response is sent.
   */
  status: number;
  /**
   * Optional structured detail — the resource ID affected, error message, or
   * any other context that helps an auditor understand the change.
   */
  detail?: string;
}

// ── Storage ───────────────────────────────────────────────────────────────────

/** Maximum number of audit entries kept in memory. */
const MAX_ENTRIES = 1000;

const entries: AuditEntry[] = [];

// ── Internal helpers ──────────────────────────────────────────────────────────

function appendEntry(entry: AuditEntry): void {
  // Newest entries at the front for convenient display.
  entries.unshift(entry);
  if (entries.length > MAX_ENTRIES) entries.pop();
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Records a completed mutating API operation in the audit log.
 *
 * @param req    The Express Request object (for method, path, IP).
 * @param status The HTTP status code that was returned to the client.
 * @param detail Optional extra context (resource ID, error message, etc.).
 */
export function recordAudit(req: Request, status: number, detail?: string): void {
  appendEntry({
    timestamp: new Date().toISOString(),
    method: req.method,
    path: req.path,
    ip: getClientIp(req),
    status,
    detail,
  });
}

/** Returns a copy of all audit entries, newest first. */
export function getAuditLog(): AuditEntry[] {
  return [...entries];
}

/** Returns the total number of stored audit entries. */
export function getAuditLogSize(): number {
  return entries.length;
}
