import type { KnowledgeDbStore } from "./KnowledgeDbStore";

/**
 * MemoryRetireSweeper runs a periodic background sweep that:
 * 1. Soft-deletes expired knowledge entries (`deleteExpired()`) for all agents.
 * 2. Permanently purges entries that have been retired for more than
 *    `purgeRetiredOlderThanDays` days (`purgeRetired()`).
 *
 * Use `start()` to begin the sweep and `stop()` to halt it.
 * The default interval is 60 000 ms (1 minute).
 */
export class MemoryRetireSweeper {
  private intervalHandle: ReturnType<typeof setInterval> | undefined;

  /**
   * @param store                    The SQLite-backed KnowledgeDbStore to sweep.
   * @param intervalMs               Sweep interval in milliseconds (default: 60 000).
   * @param purgeRetiredOlderThanDays Permanently remove retired entries older than
   *                                 this many days (default: 7).
   */
  constructor(
    private readonly store: KnowledgeDbStore,
    private readonly intervalMs: number = 60_000,
    private readonly purgeRetiredOlderThanDays: number = 7,
  ) {}

  /**
   * Start the periodic sweep.  Calling `start()` while already running first
   * stops the existing timer before creating a new one.
   */
  start(): this {
    this.stop();
    this.intervalHandle = setInterval(() => {
      this.store.deleteExpired();
      this.store.purgeRetired(this.purgeRetiredOlderThanDays);
    }, this.intervalMs);
    // Allow the Node.js process to exit even if the interval is still active.
    this.intervalHandle.unref();
    return this;
  }

  /** Stop the periodic sweep.  Safe to call even if not yet started. */
  stop(): void {
    if (this.intervalHandle !== undefined) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
    }
  }
}
