import { describe, expect, it, vi } from "vitest";
import { ReaderOperations } from "./ReaderOperation.js";

describe("ReaderOperations", () => {
  it("a navigation cancels the previous turn and releases only its uncommitted resources", () => {
    const lifetime = new ReaderOperations();
    const turn = lifetime.begin();
    const disposeCandidate = vi.fn();
    const disposeAdopted = vi.fn();
    turn.own(disposeCandidate);
    const adopt = turn.own(disposeAdopted);
    adopt();
    const navigation = lifetime.begin();
    expect(turn.signal.aborted).toBe(true);
    expect(disposeCandidate).toHaveBeenCalledOnce();
    expect(disposeAdopted).not.toHaveBeenCalled();
    lifetime.finish(turn);
    expect(lifetime.owns(navigation)).toBe(true);
  });

  it("disposal is terminal and settles cancellation only once", () => {
    const lifetime = new ReaderOperations();
    const operation = lifetime.begin();
    const cleanup = vi.fn();
    operation.own(cleanup);
    lifetime.dispose();
    lifetime.dispose();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(() => operation.check()).toThrow();
    expect(() => operation.own(vi.fn())).toThrow();
    expect(() => lifetime.begin()).toThrow();
    expect(lifetime.owns(operation)).toBe(false);
  });
});
