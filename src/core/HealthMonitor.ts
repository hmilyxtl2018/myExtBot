/**
 * src/core/HealthMonitor.ts
 *
 * HealthMonitor — maintains real-time health records for all registered Services.
 *
 * State transition rules:
 * - Successful call: consecutiveFailures = 0, health = "healthy"
 * - Failure (non-429):
 *   - consecutiveFailures >= 5 → "down"
 *   - consecutiveFailures >= 3 → "degraded"
 *   - consecutiveFailures < 3  → keep "healthy" (transient failures do not degrade)
 * - Failure with error containing "429" or "rate limit" (case-insensitive):
 *   - health = "rate-limited"
 *   - parse retryAfterSeconds and compute rateLimitResetAt
 */

import { ServiceHealth, ServiceHealthRecord } from "./types";

/** Number of consecutive failures before entering "degraded" state. */
const DEGRADED_THRESHOLD = 3;

/** Number of consecutive failures before entering "down" state. */
const DOWN_THRESHOLD = 5;

/** Default Retry-After seconds when none is provided on a 429. */
const DEFAULT_RETRY_AFTER_SECONDS = 60;

/**
 * Determines whether an error message represents a rate-limit (HTTP 429).
 */
function isRateLimitError(error: string): boolean {
  const lower = error.toLowerCase();
  return lower.includes("429") || lower.includes("rate limit");
}

export class HealthMonitor {
  private records = new Map<string, ServiceHealthRecord>();

  /** Ensure a health record exists for the named service (initial state: "unknown"). */
  init(serviceName: string): void {
    if (!this.records.has(serviceName)) {
      this.records.set(serviceName, {
        serviceName,
        health: "unknown",
        lastCheckedAt: new Date().toISOString(),
        consecutiveFailures: 0,
        totalCalls: 0,
        totalSuccesses: 0,
        successRate: 0,
      });
    }
  }

  /** Record a successful call. */
  recordSuccess(serviceName: string): void {
    this.init(serviceName);
    const record = this.records.get(serviceName)!;

    record.consecutiveFailures = 0;
    record.health = "healthy";
    record.lastCheckedAt = new Date().toISOString();
    record.totalCalls += 1;
    record.totalSuccesses += 1;
    record.successRate = record.totalSuccesses / record.totalCalls;
    // Clear rate-limit reset time on recovery
    delete record.rateLimitResetAt;
    delete record.lastError;
  }

  /**
   * Record a failed call.
   * @param error Error message string.
   * @param retryAfterSeconds Retry-After seconds from a 429 response (optional).
   */
  recordFailure(
    serviceName: string,
    error: string,
    retryAfterSeconds?: number
  ): void {
    this.init(serviceName);
    const record = this.records.get(serviceName)!;

    record.lastCheckedAt = new Date().toISOString();
    record.lastError = error;
    record.totalCalls += 1;
    record.successRate =
      record.totalCalls > 0 ? record.totalSuccesses / record.totalCalls : 0;

    if (isRateLimitError(error)) {
      record.health = "rate-limited";
      const delay =
        retryAfterSeconds !== undefined && retryAfterSeconds > 0
          ? retryAfterSeconds
          : DEFAULT_RETRY_AFTER_SECONDS;
      const resetAt = new Date(Date.now() + delay * 1000);
      record.rateLimitResetAt = resetAt.toISOString();
      // Do NOT increment consecutiveFailures for rate-limit — it is transient.
    } else {
      record.consecutiveFailures += 1;
      this.updateHealthFromFailures(record);
    }
  }

  /** Derive health status from the consecutive failure count (non-rate-limit). */
  private updateHealthFromFailures(record: ServiceHealthRecord): void {
    const f = record.consecutiveFailures;
    if (f >= DOWN_THRESHOLD) {
      record.health = "down";
    } else if (f >= DEGRADED_THRESHOLD) {
      record.health = "degraded";
    } else {
      // Fewer than DEGRADED_THRESHOLD failures — keep existing health unless unknown.
      if (record.health === "unknown") {
        record.health = "healthy";
      }
    }
  }

  /** Get the health record for a named service. */
  getRecord(serviceName: string): ServiceHealthRecord {
    this.init(serviceName);
    return { ...this.records.get(serviceName)! };
  }

  /** Get health records for all registered services. */
  getAllRecords(): ServiceHealthRecord[] {
    return Array.from(this.records.values()).map((r) => ({ ...r }));
  }

  /**
   * Check whether a service can accept calls.
   * "healthy" | "degraded" → true  (degraded: lower confidence but still callable)
   * "down" | "rate-limited" → false
   * "unknown" → true  (give a new service its first chance)
   */
  isCallable(serviceName: string): boolean {
    this.init(serviceName);
    const { health } = this.records.get(serviceName)!;
    return health !== "down" && health !== "rate-limited";
  }

  /**
   * Check whether a rate-limited service has recovered.
   * If rateLimitResetAt is in the past, automatically restore health to "healthy".
   */
  checkRateLimitRecovery(serviceName: string): void {
    this.init(serviceName);
    const record = this.records.get(serviceName)!;
    if (record.health !== "rate-limited") return;
    if (!record.rateLimitResetAt) return;

    const resetAt = new Date(record.rateLimitResetAt).getTime();
    if (Date.now() >= resetAt) {
      record.health = "healthy";
      record.consecutiveFailures = 0;
      delete record.rateLimitResetAt;
      record.lastCheckedAt = new Date().toISOString();
    }
  }

  /**
   * Manually reset a service's health record to "healthy" (ops use).
   */
  resetToHealthy(serviceName: string): void {
    this.init(serviceName);
    const record = this.records.get(serviceName)!;
    record.health = "healthy";
    record.consecutiveFailures = 0;
    delete record.rateLimitResetAt;
    delete record.lastError;
    record.lastCheckedAt = new Date().toISOString();
  }
}
