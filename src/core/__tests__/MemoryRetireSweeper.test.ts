import { KnowledgeDbStore } from "../KnowledgeDbStore";
import { MemoryRetireSweeper } from "../MemoryRetireSweeper";
import type { KnowledgeEntry } from "../MemoryAdapter";

function makeExpiredEntry(agentId: string, id: string): KnowledgeEntry {
  return {
    id,
    agentId,
    content: "expired content",
    confidence: 0.9,
    createdAt: new Date(Date.now() - 10_000).toISOString(),
    expiresAt: new Date(Date.now() - 5_000).toISOString(), // already expired
  };
}

describe("MemoryRetireSweeper", () => {
  let store: KnowledgeDbStore;

  beforeEach(() => {
    store = new KnowledgeDbStore();
    store.init(":memory:");
    jest.useFakeTimers();
  });

  afterEach(() => {
    store.close();
    jest.useRealTimers();
  });

  it("calls deleteExpired() on each tick", () => {
    const deleteExpiredSpy = jest.spyOn(store, "deleteExpired");
    const sweeper = new MemoryRetireSweeper(store, 1000);
    sweeper.start();

    expect(deleteExpiredSpy).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1000);
    expect(deleteExpiredSpy).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(2000);
    expect(deleteExpiredSpy).toHaveBeenCalledTimes(3);

    sweeper.stop();
  });

  it("calls purgeRetired() on each tick", () => {
    const purgeRetiredSpy = jest.spyOn(store, "purgeRetired");
    const sweeper = new MemoryRetireSweeper(store, 1000);
    sweeper.start();

    jest.advanceTimersByTime(1000);
    expect(purgeRetiredSpy).toHaveBeenCalledTimes(1);

    sweeper.stop();
  });

  it("passes purgeRetiredOlderThanDays to purgeRetired()", () => {
    const purgeRetiredSpy = jest.spyOn(store, "purgeRetired");
    const sweeper = new MemoryRetireSweeper(store, 1000, 14);
    sweeper.start();

    jest.advanceTimersByTime(1000);
    expect(purgeRetiredSpy).toHaveBeenCalledWith(14);

    sweeper.stop();
  });

  it("does not call deleteExpired() after stop()", () => {
    const deleteExpiredSpy = jest.spyOn(store, "deleteExpired");
    const sweeper = new MemoryRetireSweeper(store, 1000);
    sweeper.start();

    jest.advanceTimersByTime(1000);
    expect(deleteExpiredSpy).toHaveBeenCalledTimes(1);

    sweeper.stop();

    jest.advanceTimersByTime(5000);
    expect(deleteExpiredSpy).toHaveBeenCalledTimes(1); // no new calls
  });

  it("stop() is safe to call before start()", () => {
    const sweeper = new MemoryRetireSweeper(store, 1000);
    expect(() => sweeper.stop()).not.toThrow();
  });

  it("start() restarts the timer if called while already running", () => {
    const deleteExpiredSpy = jest.spyOn(store, "deleteExpired");
    const sweeper = new MemoryRetireSweeper(store, 1000);
    sweeper.start();
    sweeper.start(); // restart — should not double-fire

    jest.advanceTimersByTime(1000);
    expect(deleteExpiredSpy).toHaveBeenCalledTimes(1); // only once per interval

    sweeper.stop();
  });

  it("actually soft-deletes expired entries in the store on each tick", () => {
    const entry = makeExpiredEntry("agent1", "retire-me-1");
    store.insert("agent1", entry);

    expect(store.list("agent1")).toHaveLength(1);

    const sweeper = new MemoryRetireSweeper(store, 1000);
    sweeper.start();

    jest.advanceTimersByTime(1000);

    // Entry is soft-deleted (retired), so list() (active only) returns empty.
    expect(store.list("agent1")).toHaveLength(0);
    expect(store.listRetired("agent1")).toHaveLength(1);

    sweeper.stop();
  });

  it("actually purges retired entries older than the threshold on each tick", () => {
    const entry = makeExpiredEntry("agent1", "retire-me-2");
    store.insert("agent1", entry);
    store.deleteExpired("agent1"); // manually retire

    // Entry should be retired now
    expect(store.listRetired("agent1")).toHaveLength(1);

    // Sweeper with olderThanDays=0 purges all retired entries immediately
    const sweeper = new MemoryRetireSweeper(store, 1000, 0);
    sweeper.start();

    jest.advanceTimersByTime(1000);

    expect(store.listRetired("agent1")).toHaveLength(0);

    sweeper.stop();
  });

  it("uses 7 days as the default purge threshold", () => {
    const purgeRetiredSpy = jest.spyOn(store, "purgeRetired");
    const sweeper = new MemoryRetireSweeper(store, 1000); // no explicit threshold
    sweeper.start();

    jest.advanceTimersByTime(1000);
    expect(purgeRetiredSpy).toHaveBeenCalledWith(7);

    sweeper.stop();
  });
});
