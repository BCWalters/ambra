import { afterEach, expect, it, vi } from "vitest";
import { PageTurnPrefetch } from "./PageTurnPrefetch.js";
import { ReaderOperation } from "./ReaderOperation.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("transfers a ready candidate whose value is zero", async () => {
  vi.useFakeTimers();
  const cache = new PageTurnPrefetch<number>(vi.fn());
  const source = {};
  const dispose = vi.fn();
  cache.schedule(source, "layout", async (_direction, operation) => {
    operation.own(dispose);
    return 0;
  });
  await vi.runAllTimersAsync();
  const turn = new ReaderOperation();
  expect(cache.take(source, "layout", 1, turn)).toBe(0);
  expect(dispose).toHaveBeenCalledOnce();
  turn.cancel();
  expect(dispose).toHaveBeenCalledTimes(2);
});

it("ignores an expired idle callback without losing the new generation's cancellation", () => {
  const callbacks: IdleRequestCallback[] = [];
  const cancel = vi.fn();
  vi.stubGlobal("requestIdleCallback", (callback: IdleRequestCallback) => callbacks.push(callback));
  vi.stubGlobal("cancelIdleCallback", cancel);
  const cache = new PageTurnPrefetch<number>(vi.fn());
  const source = {};
  const prepare = vi.fn(async () => 1);
  cache.schedule(source, "old", prepare);
  cache.schedule(source, "new", prepare);
  callbacks[0]!({ didTimeout: false, timeRemaining: () => 50 });
  expect(prepare).not.toHaveBeenCalled();
  cache.clear();
  expect(cancel.mock.calls).toEqual([[1], [2]]);
});

it("prepares next then previous and transfers a ready candidate to its consuming operation", async () => {
  vi.useFakeTimers();
  const errors = vi.fn();
  const cache = new PageTurnPrefetch<number>(errors);
  const source = {};
  const disposed: number[] = [];
  const prepared: number[] = [];
  cache.schedule(source, "layout", async (direction, operation) => {
    prepared.push(direction);
    operation.own(() => disposed.push(direction));
    return direction;
  });
  await vi.runAllTimersAsync();
  expect(prepared).toEqual([1, -1]);
  const turn = new ReaderOperation();
  expect(cache.take(source, "layout", 1, turn)).toBe(1);
  expect(disposed).toEqual([-1]);
  turn.cancel();
  expect(disposed).toEqual([-1, 1]);
  expect(errors).not.toHaveBeenCalled();
});

it("does not let a cancelled generation enqueue previous after the same source is rescheduled", async () => {
  vi.useFakeTimers();
  const cache = new PageTurnPrefetch<number>(vi.fn());
  const source = {};
  let release!: () => void;
  const first = vi.fn(async (_direction: 1 | -1, operation: ReaderOperation) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    operation.check();
    return 1;
  });
  cache.schedule(source, "layout", first);
  await vi.advanceTimersByTimeAsync(200);
  cache.clear();
  const next = vi.fn(async (direction: 1 | -1) => direction);
  cache.schedule(source, "layout", next);
  release();
  await vi.runAllTimersAsync();
  expect(first).toHaveBeenCalledOnce();
  expect(next.mock.calls.map(([direction]) => direction)).toEqual([1, -1]);
  cache.clear();
});

it("cancels a pending preload rather than making foreground input wait for it", async () => {
  vi.useFakeTimers();
  const cache = new PageTurnPrefetch<number>(vi.fn());
  const source = {};
  let pending!: ReaderOperation;
  cache.schedule(source, "layout", async (_direction, operation) => {
    pending = operation;
    await new Promise<void>((resolve) =>
      operation.signal.addEventListener("abort", () => resolve(), { once: true }),
    );
    operation.check();
    return 1;
  });
  await vi.advanceTimersByTimeAsync(200);
  expect(cache.take(source, "layout", 1, new ReaderOperation())).toBeUndefined();
  expect(pending.signal.aborted).toBe(true);
  await vi.runAllTimersAsync();
});

it("invalidates both candidates on a changed layout or reading host", async () => {
  vi.useFakeTimers();
  const cache = new PageTurnPrefetch<number>(vi.fn());
  const source = {};
  const dispose = vi.fn();
  cache.schedule(source, "old", async (direction, operation) => {
    operation.own(dispose);
    return direction;
  });
  await vi.runAllTimersAsync();
  expect(cache.take(source, "new", 1, new ReaderOperation())).toBeUndefined();
  expect(dispose).toHaveBeenCalledTimes(2);
  cache.schedule(source, "new", async (direction) => direction);
  await vi.runAllTimersAsync();
  expect(cache.take({}, "new", 1, new ReaderOperation())).toBeUndefined();
});

it("reports preparation failures and still prepares the opposite direction", async () => {
  vi.useFakeTimers();
  const report = vi.fn();
  const cache = new PageTurnPrefetch<number>(report);
  const source = {};
  const failure = new Error("load failed");
  cache.schedule(source, "layout", async (direction) => {
    if (direction === 1) throw failure;
    return -1;
  });
  await vi.runAllTimersAsync();
  expect(report).toHaveBeenCalledWith(failure, 1);
  const turn = new ReaderOperation();
  expect(cache.take(source, "layout", -1, turn)).toBe(-1);
  turn.cancel();
});
