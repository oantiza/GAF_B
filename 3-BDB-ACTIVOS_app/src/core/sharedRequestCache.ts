/** Share identical work and bound active requests. Cancellation removes observers;
 * queued work with no observers is never sent. An already running RPC keeps its
 * slot until it settles because Firebase callables cannot cancel server execution. */
interface Observer<T> {
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  cleanup: () => void;
}

interface Entry<T> {
  key: string;
  load: () => Promise<T>;
  state: "queued" | "running" | "ready";
  observers: Set<Observer<T>>;
  value?: T;
  expires: number;
}

const cancelled = () => new DOMException("La solicitud ya no es necesaria.", "AbortError");

export class SharedRequestCache<T> {
  private entries = new Map<string, Entry<T>>();
  private active = 0;

  private readonly concurrency: number;
  private readonly ttlMs: number;
  private readonly capacity: number;

  constructor(concurrency: number, ttlMs: number, capacity: number) {
    this.concurrency = concurrency;
    this.ttlMs = ttlMs;
    this.capacity = capacity;
  }

  get(key: string, load: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(cancelled());
    let entry = this.entries.get(key);
    if (entry?.state === "ready") {
      if (entry.expires > Date.now()) return Promise.resolve(entry.value as T);
      this.entries.delete(key);
      entry = undefined;
    }
    if (!entry) {
      entry = { key, load, state: "queued", observers: new Set(), expires: 0 };
      this.entries.set(key, entry);
    }
    const request = entry;
    const promise = new Promise<T>((resolve, reject) => {
      const abort = () => {
        observer.cleanup();
        reject(cancelled());
        if (request.state === "queued" && request.observers.size === 0 && this.entries.get(key) === request) {
          this.entries.delete(key);
        }
      };
      const observer: Observer<T> = {
        resolve, reject,
        cleanup: () => { request.observers.delete(observer); signal?.removeEventListener("abort", abort); }
      };
      request.observers.add(observer);
      signal?.addEventListener("abort", abort, { once: true });
    });
    // StrictMode cleanup and several consumers of one screen can coalesce first.
    queueMicrotask(() => this.pump());
    return promise;
  }

  clear(): void {
    for (const entry of this.entries.values()) {
      for (const observer of [...entry.observers]) {
        observer.cleanup();
        observer.reject(cancelled());
      }
    }
    this.entries.clear();
    // Do not free running slots until the actual RPC finishes.
  }

  private pump(): void {
    for (const entry of this.entries.values()) {
      if (this.active >= this.concurrency) return;
      if (entry.state !== "queued" || entry.observers.size === 0) continue;
      entry.state = "running";
      this.active += 1;
      void Promise.resolve().then(() => {
        if (entry.observers.size === 0) throw cancelled();
        return entry.load();
      }).then(
        (value) => {
          entry.state = "ready";
          entry.value = value;
          entry.expires = Date.now() + this.ttlMs;
          for (const observer of [...entry.observers]) { observer.cleanup(); observer.resolve(value); }
        },
        (error: unknown) => {
          if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key);
          for (const observer of [...entry.observers]) { observer.cleanup(); observer.reject(error); }
        }
      ).finally(() => {
        this.active -= 1;
        // Only completed entries may be evicted: otherwise a duplicate RPC could start.
        for (const [key, candidate] of this.entries) {
          if (this.entries.size <= this.capacity) break;
          if (candidate.state === "ready") this.entries.delete(key);
        }
        this.pump();
      });
    }
  }
}
