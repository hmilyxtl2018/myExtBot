/**
 * src/core/McpServiceListManager.ts
 *
 * Central registry and dispatcher for all MCP Services.
 * Integrates with HealthMonitor (M4) to provide:
 *   - Automatic health tracking on every execute()
 *   - Fallback routing when a service is "down" or "rate-limited"
 *   - Health query APIs
 */

import { McpService, ServiceResult, ServiceHealthRecord } from "./types";
import { HealthMonitor } from "./HealthMonitor";
import { BaseService } from "../services/BaseService";

/** Options passed to dispatch() or dispatchAs(). */
export interface DispatchOptions {
  /** If true, skip health checks (e.g. health-check pings themselves) */
  skipHealthCheck?: boolean;
}

export class McpServiceListManager {
  private services = new Map<string, McpService>();
  private healthMonitor = new HealthMonitor();

  // ── Registration ────────────────────────────────────────────────────────────

  /** Register a service and initialise its health record. */
  register(service: McpService): void {
    if (this.services.has(service.name)) {
      throw new Error(
        `Service "${service.name}" is already registered. Use a unique name.`
      );
    }
    this.services.set(service.name, service);
    this.healthMonitor.init(service.name);
  }

  /** Retrieve a registered service by name. */
  getService(name: string): McpService | undefined {
    return this.services.get(name);
  }

  /** List all registered service names. */
  listServices(): string[] {
    return Array.from(this.services.keys());
  }

  // ── Dispatch ─────────────────────────────────────────────────────────────────

  /**
   * Dispatch a call to the named service.
   * Health checks are performed before execution:
   *   1. checkRateLimitRecovery — auto-recover from expired rate-limit
   *   2. isCallable — if false, route to fallback or return error
   * Results are recorded in HealthMonitor after execution.
   */
  async dispatch(
    serviceName: string,
    payload: unknown,
    options: DispatchOptions = {}
  ): Promise<ServiceResult> {
    const service = this.services.get(serviceName);
    if (!service) {
      return { success: false, error: `Service "${serviceName}" not found.` };
    }

    if (!options.skipHealthCheck) {
      // 1. Check if rate-limit window has passed
      this.healthMonitor.checkRateLimitRecovery(serviceName);

      // 2. Check if service is callable
      if (!this.healthMonitor.isCallable(serviceName)) {
        const record = this.healthMonitor.getRecord(serviceName);
        const fallbackName = (service as BaseService).fallbackServiceName;

        if (fallbackName) {
          console.warn(
            `[HealthMonitor] Service "${serviceName}" is ${record.health}. ` +
              `Routing to fallback "${fallbackName}".`
          );
          return this.dispatch(fallbackName, payload, options);
        }

        return {
          success: false,
          error: `Service "${serviceName}" is ${record.health}, no fallback available.`,
        };
      }
    }

    // 3. Execute
    let result: ServiceResult;
    try {
      result = await service.execute(payload);
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : String(err);
      this.healthMonitor.recordFailure(serviceName, errorMessage);
      return { success: false, error: errorMessage };
    }

    // 4. Record health outcome
    if (result.success) {
      this.healthMonitor.recordSuccess(serviceName);
    } else {
      const errorMsg = result.error ?? "Unknown error";
      this.healthMonitor.recordFailure(
        serviceName,
        errorMsg,
        result.retryAfterSeconds
      );
    }

    return result;
  }

  /**
   * Dispatch a call on behalf of (as) a specific agent identity.
   * Delegates to dispatch() after logging the agent context.
   */
  async dispatchAs(
    agentId: string,
    serviceName: string,
    payload: unknown,
    options: DispatchOptions = {}
  ): Promise<ServiceResult> {
    console.log(
      `[McpServiceListManager] Agent "${agentId}" dispatching to "${serviceName}"`
    );
    return this.dispatch(serviceName, payload, options);
  }

  // ── Health API ───────────────────────────────────────────────────────────────

  /** Get the health record for a specific service. */
  getServiceHealth(serviceName: string): ServiceHealthRecord {
    return this.healthMonitor.getRecord(serviceName);
  }

  /** Get health records for all registered services. */
  getAllServiceHealths(): ServiceHealthRecord[] {
    return this.healthMonitor.getAllRecords();
  }

  /**
   * Manually reset a service's health to "healthy" (ops / admin use).
   * Returns the updated record.
   */
  resetServiceHealth(serviceName: string): ServiceHealthRecord {
    this.healthMonitor.resetToHealthy(serviceName);
    return this.healthMonitor.getRecord(serviceName);
  }
}
