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

const DEGRADED_THRESHOLD = 3;
const DOWN_THRESHOLD = 5;
const DEFAULT_RETRY_AFTER_SECONDS = 60;

function isRateLimitError(error: string): boolean {
  const lower = error.toLowerCase();
  return lower.includes("429") || lower.includes("rate limit");
}

export class HealthMonitor {
  private records = new Map<string, ServiceHealthRecord>();

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

  recordSuccess(serviceName: string): void {
    this.init(serviceName);
    const record = this.records.get(serviceName)!;
    record.consecutiveFailures = 0;
    record.health = "healthy";
    record.lastCheckedAt = new Date().toISOString();
    record.totalCalls += 1;
    record.totalSuccesses += 1;
    record.successRate = record.totalSuccesses / record.totalCalls;
    delete record.rateLimitResetAt;
    delete record.lastError;
  }

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
      record.rateLimitResetAt = new Date(Date.now() + delay * 1000).toISOString();
    } else {
      record.consecutiveFailures += 1;
      const f = record.consecutiveFailures;
      if (f >= DOWN_THRESHOLD) {
        record.health = "down";
      } else if (f >= DEGRADED_THRESHOLD) {
        record.health = "degraded";
      } else {
        if (record.health === "unknown") {
          record.health = "healthy";
        }
      }
    }
  }

  getRecord(serviceName: string): ServiceHealthRecord {
    this.init(serviceName);
    return { ...this.records.get(serviceName)! };
  }

  getAllRecords(): ServiceHealthRecord[] {
    return Array.from(this.records.values()).map((r) => ({ ...r }));
  }

  isCallable(serviceName: string): boolean {
    this.init(serviceName);
    const { health } = this.records.get(serviceName)!;
    return health !== "down" && health !== "rate-limited";
  }

  checkRateLimitRecovery(serviceName: string): void {
    this.init(serviceName);
    const record = this.records.get(serviceName)!;
    if (record.health !== "rate-limited") return;
    if (!record.rateLimitResetAt) return;
    if (Date.now() >= new Date(record.rateLimitResetAt).getTime()) {
      record.health = "healthy";
      record.consecutiveFailures = 0;
      delete record.rateLimitResetAt;
      record.lastCheckedAt = new Date().toISOString();
    }
  }

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
