import { afterEach, describe, expect, it, vi } from "vitest";
import { SharedRequestCache } from "../src/core/sharedRequestCache";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
afterEach(() => vi.useRealTimers());

describe("shared analysis requests", () => {
  it("bounds active work and drops obsolete queued edits before sending them", async () => {
    const cache = new SharedRequestCache<number>(2, 1000, 16);
    const a = deferred<number>(), b = deferred<number>();
    const first = cache.get("A", () => a.promise), second = cache.get("B", () => b.promise);
    const controller = new AbortController();
    const obsolete = vi.fn(async () => 3), latest = vi.fn(async () => 4);
    const stale = cache.get("C", obsolete, controller.signal).catch((e: Error) => e.name);
    const current = cache.get("D", latest);
    await flush();
    expect(obsolete).not.toHaveBeenCalled();
    expect(latest).not.toHaveBeenCalled();
    controller.abort(); a.resolve(1);
    expect(await stale).toBe("AbortError");
    expect(await first).toBe(1);
    expect(await current).toBe(4);
    expect(obsolete).not.toHaveBeenCalled();
    b.resolve(2); expect(await second).toBe(2);
  });

  it("one unmounted consumer does not cancel another consumer of the same analysis", async () => {
    const cache = new SharedRequestCache<number>(2, 1000, 16), work = deferred<number>();
    const load = vi.fn(() => work.promise), controller = new AbortController();
    const first = cache.get("A", load, controller.signal).catch((e: Error) => e.name);
    const second = cache.get("A", load);
    await flush(); controller.abort(); work.resolve(7);
    expect(await first).toBe("AbortError"); expect(await second).toBe(7);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("does not expire or evict an unfinished RPC and starts the TTL on completion", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const cache = new SharedRequestCache<number>(2, 1000, 1), work = deferred<number>();
    const load = vi.fn(() => work.promise);
    const first = cache.get("A", load); await flush();
    vi.setSystemTime(Date.now() + 2000);
    const second = cache.get("A", load);
    work.resolve(1); expect(await first).toBe(1); expect(await second).toBe(1); await flush();
    expect(await cache.get("A", load)).toBe(1); expect(load).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 1001);
    expect(await cache.get("A", async () => 2)).toBe(2);
  });

  it("clears queued work on logout without pretending running server work stopped", async () => {
    const cache = new SharedRequestCache<number>(1, 1000, 16), old = deferred<number>();
    const a = cache.get("old", () => old.promise).catch((e: Error) => e.name);
    const queued = vi.fn(async () => 2);
    const b = cache.get("queued", queued).catch((e: Error) => e.name);
    await flush(); cache.clear();
    const fresh = vi.fn(async () => 3), next = cache.get("new-session", fresh);
    await flush(); expect(fresh).not.toHaveBeenCalled();
    expect(await a).toBe("AbortError"); expect(await b).toBe("AbortError");
    old.resolve(1); expect(await next).toBe(3); expect(queued).not.toHaveBeenCalled();
  });

  it("evicts errors so an explicit retry can succeed", async () => {
    const cache = new SharedRequestCache<number>(1, 1000, 16);
    await expect(cache.get("A", async () => { throw new Error("network"); })).rejects.toThrow("network");
    expect(await cache.get("A", async () => 9)).toBe(9);
  });

  it("does not send work cancelled before its first microtask", async () => {
    const cache = new SharedRequestCache<number>(1, 1000, 16), load = vi.fn(async () => 1);
    const controller = new AbortController();
    const result = cache.get("A", load, controller.signal).catch((e: Error) => e.name);
    controller.abort(); expect(await result).toBe("AbortError"); await flush();
    expect(load).not.toHaveBeenCalled();
  });
});
