import { ReaderOperation } from "./ReaderOperation.js";

interface Prefetched<T> {
  operation: ReaderOperation;
  value?: T;
}

/** Two speculative candidates, prepared serially without claiming reader state. */
export class PageTurnPrefetch<T> {
  private source: object | undefined;
  private key: string | undefined;
  private generation = 0;
  private cancelIdle: (() => void) | undefined;
  private readonly entries = new Map<1 | -1, Prefetched<T>>();

  public constructor(private readonly reportError: (error: unknown, direction: 1 | -1) => void) {}

  public schedule(
    source: object,
    key: string,
    prepare: (direction: 1 | -1, operation: ReaderOperation) => Promise<T | undefined>,
  ): void {
    if (this.source === source && this.key === key) return;
    this.clear();
    this.source = source;
    this.key = key;
    const generation = this.generation;
    const queue: (1 | -1)[] = [1, -1];
    const next = () => {
      if (this.generation !== generation) return;
      const direction = queue.shift();
      if (direction === undefined) return;
      const run = () => {
        if (this.generation !== generation) return;
        this.cancelIdle = undefined;
        const entry: Prefetched<T> = { operation: new ReaderOperation() };
        this.entries.set(direction, entry);
        void prepare(direction, entry.operation)
          .then((value) => {
            entry.operation.check();
            entry.value = value;
            if (value === undefined) entry.operation.cancel();
          })
          .catch((error) => {
            if (!entry.operation.signal.aborted) this.reportError(error, direction);
            entry.operation.cancel();
            if (this.entries.get(direction) === entry) this.entries.delete(direction);
          })
          .finally(next);
      };
      if (typeof window.requestIdleCallback === "function") {
        const id = window.requestIdleCallback(run);
        this.cancelIdle = () => window.cancelIdleCallback(id);
      } else {
        const id = setTimeout(run, 200);
        this.cancelIdle = () => clearTimeout(id);
      }
    };
    next();
  }

  public take(
    source: object,
    key: string,
    direction: 1 | -1,
    operation: ReaderOperation,
    matches: (value: T) => boolean = () => true,
  ): T | undefined {
    if (this.source !== source || this.key !== key) {
      this.clear();
      return undefined;
    }
    const entry = this.entries.get(direction);
    if (!entry || entry.value === undefined || !matches(entry.value)) {
      this.clear();
      return undefined;
    }
    operation.check();
    this.entries.delete(direction);
    operation.own(() => entry.operation.cancel());
    this.clear();
    return entry.value;
  }

  public clear(): void {
    this.generation++;
    this.cancelIdle?.();
    this.cancelIdle = undefined;
    this.source = undefined;
    this.key = undefined;
    for (const entry of this.entries.values()) entry.operation.cancel();
    this.entries.clear();
  }
}
