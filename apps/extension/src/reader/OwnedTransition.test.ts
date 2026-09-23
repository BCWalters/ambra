import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runOwnedTransition } from "./OwnedTransition.js";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("transition completion clears both timer and queued RAF", async () => {
  const element = document.createElement("div");
  const apply = vi.fn();
  const finished = runOwnedTransition(element, apply, 600);
  const end = (propertyName: string) => {
    const event = new Event("transitionend");
    Object.defineProperty(event, "propertyName", { value: propertyName });
    element.dispatchEvent(event);
  };
  end("opacity");
  expect(vi.getTimerCount()).toBeGreaterThan(0);
  end("transform");
  await finished;
  await vi.runAllTimersAsync();
  expect(apply).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it("timeout completion prevents even a delayed frame callback from mutating content", async () => {
  let queued: FrameRequestCallback | undefined;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    queued = callback;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const apply = vi.fn();
  const finished = runOwnedTransition(document.createElement("div"), apply, 600);
  await vi.advanceTimersByTimeAsync(600);
  await finished;
  queued?.(1000);
  expect(apply).not.toHaveBeenCalled();
});

it("abort settles promptly without painting or leaving scheduled work", async () => {
  const abort = new AbortController();
  const apply = vi.fn();
  const finished = runOwnedTransition(document.createElement("div"), apply, 600, abort.signal);
  abort.abort();
  await finished;
  await vi.runAllTimersAsync();
  expect(apply).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it("reports errors from the RAF callback and still cleans up", async () => {
  const failure = new Error("paint failed");
  const finished = runOwnedTransition(
    undefined,
    () => {
      throw failure;
    },
    600,
  );
  const assertion = expect(finished).rejects.toBe(failure);
  await vi.runAllTimersAsync();
  await assertion;
  expect(vi.getTimerCount()).toBe(0);
});
