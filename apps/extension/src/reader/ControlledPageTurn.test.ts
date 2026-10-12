import { afterEach, expect, it, vi } from "vitest";
import {
  ControlledPageTurn,
  PageTurnGestureCancelled,
  type ControlledPageTurnDiagnostic,
} from "./ControlledPageTurn.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

function pointer(type: string, x: number, time: number, pointerType = "mouse"): PointerEvent {
  const event = new PointerEvent(type, {
    pointerId: 1,
    pointerType,
    buttons: type === "pointerup" || type === "pointercancel" ? 0 : 1,
    screenX: x,
    screenY: 100,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, "timeStamp", { value: time });
  return event;
}

function gesture(
  side: -1 | 1 = 1,
  commitThreshold = 0.4,
  width = 1000,
  pointerType = "mouse",
  diagnostic?: (event: ControlledPageTurnDiagnostic) => void,
) {
  const begin = vi.fn();
  const tap = vi.fn();
  const turn = new ControlledPageTurn(
    pointer("pointerdown", 1000, 0, pointerType),
    document,
    side,
    width,
    begin,
    tap,
    [],
    commitThreshold,
    diagnostic,
  );
  return { turn, begin, tap };
}

it("reports the actual failed release criteria, policy and lifecycle without changing the decision", async () => {
  const events: ControlledPageTurnDiagnostic[] = [];
  const { turn } = gesture(1, 0.4, 1000, "mouse", (event) => events.push(event));
  document.dispatchEvent(pointer("pointermove", 960, 100));
  document.dispatchEvent(pointer("pointerup", 960, 120));
  await expect(turn.play(vi.fn(), undefined, true)).rejects.toBeInstanceOf(
    PageTurnGestureCancelled,
  );
  expect(events.find((event) => event.phase === "down")).toMatchObject({
    widthPx: 1000,
    thresholdPct: 40,
    flickMinPx: 50,
    windowMs: 400,
    graceMs: 250,
    jitterPx: 8,
  });
  expect(events.find((event) => event.phase === "up")).toMatchObject({
    dxPx: -40,
    dyPx: 0,
    progressPct: 4,
    recentPx: 40,
    ageMs: 20,
    started: true,
    tap: false,
  });
  expect(events.find((event) => event.phase === "decision")).toMatchObject({
    slowPass: false,
    distancePass: false,
    releasePass: true,
    flickPass: false,
    cancelled: false,
    commit: false,
  });
  expect(events.find((event) => event.phase === "settled")).toMatchObject({
    commit: false,
    aborted: false,
  });
  expect(events.findIndex((event) => event.phase === "up")).toBeLessThan(
    events.findIndex((event) => event.phase === "prepared"),
  );
});

it("reports idle and reversal resets and identifies cancellation", async () => {
  const events: ControlledPageTurnDiagnostic[] = [];
  const { turn } = gesture(1, 0.4, 1000, "mouse", (event) => events.push(event));
  document.dispatchEvent(pointer("pointermove", 950, 3000));
  document.dispatchEvent(pointer("pointermove", 970, 3100));
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  await expect(turn.play(vi.fn(), undefined, true)).rejects.toBeInstanceOf(
    PageTurnGestureCancelled,
  );
  expect(events.find((event) => event.phase === "reset" && event.reset === "idle")).toBeDefined();
  expect(
    events.find((event) => event.phase === "reset" && event.reset === "reversal"),
  ).toMatchObject({
    resetPx: 20,
    recentPx: 0,
  });
  expect(events.find((event) => event.phase === "cancel")).toMatchObject({
    reason: "escape",
    cancelled: true,
  });
  expect(events.find((event) => event.phase === "decision")).toMatchObject({
    cancelled: true,
    commit: false,
  });
});

it("samples mouse moves without dropping the final release or decision", async () => {
  vi.spyOn(performance, "now").mockReturnValue(0);
  const events: ControlledPageTurnDiagnostic[] = [];
  const { turn } = gesture(1, 0.4, 1000, "mouse", (event) => events.push(event));
  for (let index = 1; index <= 120; index++) {
    document.dispatchEvent(pointer("pointermove", 1000 - index * 0.1, index));
  }
  document.dispatchEvent(pointer("pointerup", 988, 200));
  await expect(turn.play(vi.fn(), undefined, true)).rejects.toBeInstanceOf(
    PageTurnGestureCancelled,
  );
  expect(events.filter((event) => event.phase === "move")).toHaveLength(1);
  expect(events.filter((event) => event.phase === "up")).toHaveLength(1);
  expect(events.filter((event) => event.phase === "decision")).toHaveLength(1);
});

it("does not add mouse diagnostics to touch gestures", async () => {
  const diagnostic = vi.fn();
  const { turn } = gesture(1, 0.4, 1000, "touch", diagnostic);
  document.dispatchEvent(pointer("pointermove", 950, 100, "touch"));
  document.dispatchEvent(pointer("pointerup", 950, 120, "touch"));
  await turn.play(vi.fn(), undefined, true);
  expect(diagnostic).not.toHaveBeenCalled();
});

it.each([
  [0.39, false],
  [0.4, true],
  [0.45, true],
] as const)("slow release at %s commits only at or above 40%", async (fraction, commits) => {
  const { turn, begin } = gesture();
  document.dispatchEvent(pointer("pointermove", 1000 - fraction * 1000, 1000));
  document.dispatchEvent(pointer("pointerup", 1000 - fraction * 1000, 1300));
  expect(begin).toHaveBeenCalledOnce();
  const paint = vi.fn();
  const result = turn.play(paint, undefined, true);
  if (commits) await expect(result).resolves.toBeUndefined();
  else await expect(result).rejects.toBeInstanceOf(PageTurnGestureCancelled);
  expect(paint).not.toHaveBeenCalled();
  expect(document.body.children).toHaveLength(0);
});

it("commits beyond 40% even after a recent backward movement", async () => {
  const { turn } = gesture();
  document.dispatchEvent(pointer("pointermove", 400, 1000));
  document.dispatchEvent(pointer("pointermove", 550, 1010));
  document.dispatchEvent(pointer("pointerup", 550, 1020));
  await expect(turn.play(vi.fn(), undefined, true)).resolves.toBeUndefined();
});

it.each([1, -1] as const)("supports a 25% slow-release threshold (side=%s)", async (side) => {
  for (const [fraction, commits] of [
    [0.249, false],
    [0.25, true],
    [0.39, true],
  ] as const) {
    const { turn } = gesture(side, 0.25);
    const x = 1000 - side * fraction * 1000;
    document.dispatchEvent(pointer("pointermove", x, 1000));
    document.dispatchEvent(pointer("pointerup", x, 1300));
    const result = turn.play(vi.fn(), undefined, true);
    if (commits) await expect(result).resolves.toBeUndefined();
    else await expect(result).rejects.toBeInstanceOf(PageTurnGestureCancelled);
  }
});

it("cancellation overrides the custom threshold", async () => {
  const { turn } = gesture(1, 0.25);
  document.dispatchEvent(pointer("pointermove", 700, 1000));
  document.dispatchEvent(pointer("pointercancel", 700, 1200));
  await expect(turn.play(vi.fn(), undefined, true)).rejects.toBeInstanceOf(
    PageTurnGestureCancelled,
  );
});

it("commits a quick forward flick below 40%", async () => {
  const { turn } = gesture();
  document.dispatchEvent(pointer("pointermove", 800, 100));
  document.dispatchEvent(pointer("pointerup", 800, 110));
  await expect(turn.play(vi.fn(), undefined, true)).resolves.toBeUndefined();
});

it.each([1, -1] as const)(
  "requires a recent 5% swipe for a flick at any width (side=%s)",
  async (side) => {
    for (const width of [500, 1000, 2000]) {
      for (const distance of [width * 0.05 - 1, width * 0.05]) {
        const { turn } = gesture(side, 0.4, width);
        document.dispatchEvent(pointer("pointermove", 1000 - side * distance, 200));
        document.dispatchEvent(pointer("pointerup", 1000 - side * distance, 220));
        const result = turn.play(vi.fn(), undefined, true);
        if (distance >= width * 0.05) await expect(result).resolves.toBeUndefined();
        else await expect(result).rejects.toBeInstanceOf(PageTurnGestureCancelled);
      }
    }
  },
);

it.each([1, -1] as const)(
  "counts a moderate final swipe after holding for several seconds (side=%s)",
  async (side) => {
    const { turn, begin, tap } = gesture(side);
    document.dispatchEvent(pointer("pointermove", 1000 - side * 5, 3000));
    document.dispatchEvent(pointer("pointermove", 1000 - side * 25, 3100));
    document.dispatchEvent(pointer("pointerup", 1000 - side * 50, 3200));
    await expect(turn.play(vi.fn(), undefined, true)).resolves.toBeUndefined();
    expect(begin).toHaveBeenCalledOnce();
    expect(tap).not.toHaveBeenCalled();
  },
);

it.each([1, -1] as const)(
  "counts only the final forward swipe after wandering and holding (side=%s)",
  async (side) => {
    const { turn } = gesture(side);
    document.dispatchEvent(pointer("pointermove", 1000 - side * 120, 100));
    document.dispatchEvent(pointer("pointermove", 1000 + side * 100, 300));
    document.dispatchEvent(pointer("pointermove", 1000 + side * 75, 3300));
    document.dispatchEvent(pointer("pointerup", 1000 + side * 50, 3500));
    await expect(turn.play(vi.fn(), undefined, true)).resolves.toBeUndefined();
  },
);

it("starts a final forward swipe even after earlier backward travel", async () => {
  const { turn, begin, tap } = gesture();
  document.dispatchEvent(pointer("pointermove", 1100, 100));
  document.dispatchEvent(pointer("pointerup", 1050, 3100));
  await expect(turn.play(vi.fn(), undefined, true)).resolves.toBeUndefined();
  expect(begin).toHaveBeenCalledOnce();
  expect(tap).not.toHaveBeenCalled();
});

it.each([1, -1] as const)("does not flick for a continuous slow swipe (side=%s)", async (side) => {
  const { turn } = gesture(side);
  for (let step = 1; step <= 10; step++) {
    document.dispatchEvent(pointer("pointermove", 1000 - side * step * 6, step * 50));
  }
  document.dispatchEvent(pointer("pointerup", 1000 - side * 60, 520));
  await expect(turn.play(vi.fn(), undefined, true)).rejects.toBeInstanceOf(
    PageTurnGestureCancelled,
  );
});

it.each([
  ["mouse", 400, true],
  ["mouse", 401, false],
  ["touch", 250, true],
  ["touch", 251, false],
] as const)("%s flick timing boundary at %sms", async (pointerType, duration, commits) => {
  const { turn } = gesture(1, 0.4, 1000, pointerType);
  for (let step = 1; step <= 10; step++) {
    document.dispatchEvent(
      pointer("pointermove", 1000 - step * 5, (duration * step) / 10, pointerType),
    );
  }
  document.dispatchEvent(pointer("pointerup", 950, duration + 20, pointerType));
  const result = turn.play(vi.fn(), undefined, true);
  if (commits) await expect(result).resolves.toBeUndefined();
  else await expect(result).rejects.toBeInstanceOf(PageTurnGestureCancelled);
});

it("does not accumulate forward travel across direction reversals", async () => {
  const { turn } = gesture();
  document.dispatchEvent(pointer("pointermove", 970, 100));
  document.dispatchEvent(pointer("pointermove", 980, 150));
  document.dispatchEvent(pointer("pointermove", 950, 200));
  document.dispatchEvent(pointer("pointerup", 950, 220));
  await expect(turn.play(vi.fn(), undefined, true)).rejects.toBeInstanceOf(
    PageTurnGestureCancelled,
  );
});

it.each([
  ["mouse", 250, true],
  ["mouse", 251, false],
  ["touch", 100, true],
  ["touch", 101, false],
] as const)("%s release grace boundary at %sms", async (pointerType, pause, commits) => {
  const { turn } = gesture(1, 0.4, 1000, pointerType);
  document.dispatchEvent(pointer("pointermove", 950, 200, pointerType));
  document.dispatchEvent(pointer("pointerup", 950, 200 + pause, pointerType));
  const result = turn.play(vi.fn(), undefined, true);
  if (commits) await expect(result).resolves.toBeUndefined();
  else await expect(result).rejects.toBeInstanceOf(PageTurnGestureCancelled);
});

it.each([1, -1] as const)(
  "retains the forward swipe through minor mouse-release jitter (side=%s)",
  async (side) => {
    const { turn } = gesture(side);
    document.dispatchEvent(pointer("pointermove", 1000 - side * 50, 200));
    document.dispatchEvent(pointer("pointermove", 1000 - side * 47, 250));
    document.dispatchEvent(pointer("pointermove", 1000 - side * 49, 300));
    document.dispatchEvent(pointer("pointerup", 1000 - side * 42, 450));
    await expect(turn.play(vi.fn(), undefined, true)).resolves.toBeUndefined();
  },
);

it.each([1, -1] as const)(
  "a deliberate reversal still cancels mouse flick intent (side=%s)",
  async (side) => {
    const { turn } = gesture(side);
    document.dispatchEvent(pointer("pointermove", 1000 - side * 50, 200));
    document.dispatchEvent(pointer("pointermove", 1000 - side * 45, 220));
    document.dispatchEvent(pointer("pointerup", 1000 - side * 41, 250));
    await expect(turn.play(vi.fn(), undefined, true)).rejects.toBeInstanceOf(
      PageTurnGestureCancelled,
    );
  },
);

it("does not extend mouse flick eligibility with stationary or jittering movement", async () => {
  const { turn } = gesture();
  document.dispatchEvent(pointer("pointermove", 950, 200));
  document.dispatchEvent(pointer("pointermove", 951, 400));
  document.dispatchEvent(pointer("pointermove", 950, 440));
  document.dispatchEvent(pointer("pointerup", 950, 451));
  await expect(turn.play(vi.fn(), undefined, true)).rejects.toBeInstanceOf(
    PageTurnGestureCancelled,
  );
});

it("keeps touch reversals strict", async () => {
  const { turn } = gesture(1, 0.4, 1000, "touch");
  document.dispatchEvent(pointer("pointermove", 950, 200, "touch"));
  document.dispatchEvent(pointer("pointerup", 951, 220, "touch"));
  await expect(turn.play(vi.fn(), undefined, true)).rejects.toBeInstanceOf(
    PageTurnGestureCancelled,
  );
});

it("uses the release position when the last pointermove did not reach the threshold", async () => {
  const { turn } = gesture();
  document.dispatchEvent(pointer("pointermove", 992, 1000));
  document.dispatchEvent(pointer("pointerup", 500, 2000));
  await expect(turn.play(vi.fn(), undefined, true)).resolves.toBeUndefined();
});

it("returns when reversing below 40% and mirrors left-edge travel", async () => {
  const { turn } = gesture(-1);
  document.dispatchEvent(pointer("pointermove", 1500, 1000));
  document.dispatchEvent(pointer("pointermove", 1250, 1010));
  document.dispatchEvent(pointer("pointerup", 1250, 1020));
  await expect(turn.play(vi.fn(), undefined, true)).rejects.toBeInstanceOf(
    PageTurnGestureCancelled,
  );
});

it.each(["pointercancel", "Escape"])("cancels on %s without adopting a turn", async (action) => {
  const { turn } = gesture();
  document.dispatchEvent(pointer("pointermove", 500, 1000));
  const result = turn.play(vi.fn(), undefined, true);
  const assertion = expect(result).rejects.toBeInstanceOf(PageTurnGestureCancelled);
  document.dispatchEvent(
    action === "Escape"
      ? new KeyboardEvent("keydown", { key: "Escape" })
      : pointer(action, 500, 1100),
  );
  await assertion;
  expect(document.body.children).toHaveLength(0);
});

it("waits for release under reduced motion and cleans up on abort", async () => {
  const { turn } = gesture();
  const abort = new AbortController();
  const completed = vi.fn();
  const result = turn.play(vi.fn(), abort.signal, true).then(completed);
  await Promise.resolve();
  expect(completed).not.toHaveBeenCalled();
  abort.abort();
  await result;
  expect(document.body.children).toHaveLength(0);
});

it("preserves taps without starting a turn", () => {
  const { turn, begin, tap } = gesture();
  document.dispatchEvent(pointer("pointerup", 1000, 200));
  expect(tap).toHaveBeenCalledOnce();
  expect(begin).not.toHaveBeenCalled();
  expect(document.body.children).toHaveLength(0);
  turn.dispose();
});

it.each([1, -1] as const)(
  "starts at 8px of forward travel, preserving smaller taps (side=%s)",
  (side) => {
    const { turn, begin, tap } = gesture(side);
    document.dispatchEvent(pointer("pointermove", 1000 - side * 7, 100));
    expect(begin).not.toHaveBeenCalled();
    document.dispatchEvent(pointer("pointermove", 1000 - side * 8, 200));
    expect(begin).toHaveBeenCalledOnce();
    document.dispatchEvent(pointer("pointerup", 1000 - side * 8, 400));
    expect(tap).not.toHaveBeenCalled();
    turn.dispose();
  },
);

it("previews movement before preparation and restores it before the renderer starts", async () => {
  const { turn } = gesture();
  const preview = vi.fn();
  const restore = vi.fn();
  turn.previewWhilePreparing(preview, restore);
  document.dispatchEvent(pointer("pointermove", 992, 100));
  expect(preview).toHaveBeenLastCalledWith(0.008);
  const paint = vi.fn();
  const result = turn.play(paint, undefined, true);
  expect(restore).toHaveBeenCalledOnce();
  document.dispatchEvent(pointer("pointermove", 550, 1000));
  document.dispatchEvent(pointer("pointerup", 550, 1200));
  await result;
  expect(preview).toHaveBeenCalledOnce();
  expect(paint).not.toHaveBeenCalled();
});

it("restores preparation preview when an interrupted drag is cancelled", () => {
  const { turn } = gesture();
  const restore = vi.fn();
  turn.previewWhilePreparing(vi.fn(), restore);
  document.dispatchEvent(pointer("pointermove", 992, 100));
  document.dispatchEvent(pointer("pointercancel", 992, 200));
  expect(restore).toHaveBeenCalledOnce();
  turn.stopPreparationPreview();
  expect(restore).toHaveBeenCalledOnce();
});

it("drops an interrupted tap on browser focus loss and releases its input shield", () => {
  const { turn, tap } = gesture();
  vi.spyOn(document, "hasFocus").mockReturnValue(false);
  window.dispatchEvent(new Event("blur"));
  expect(document.querySelector("[data-ambra-page-turn-input]")).toBeNull();
  document.dispatchEvent(pointer("pointerup", 1000, 200));
  expect(tap).not.toHaveBeenCalled();
  turn.dispose();
});

it("does not cancel when focus remains inside the reader window", () => {
  const { turn, tap } = gesture();
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  window.dispatchEvent(new Event("blur"));
  expect(document.querySelector("[data-ambra-page-turn-input]")).not.toBeNull();
  document.dispatchEvent(pointer("pointerup", 1000, 200));
  expect(tap).toHaveBeenCalledOnce();
  turn.dispose();
});

it("returns an active drag on browser focus loss", async () => {
  const { turn } = gesture();
  document.dispatchEvent(pointer("pointermove", 500, 1000));
  const result = turn.play(vi.fn(), undefined, true);
  const assertion = expect(result).rejects.toBeInstanceOf(PageTurnGestureCancelled);
  vi.spyOn(document, "hasFocus").mockReturnValue(false);
  window.dispatchEvent(new Event("blur"));
  await assertion;
  expect(document.querySelector("[data-ambra-page-turn-input]")).toBeNull();
});

it("releases a stale mouse shield when movement resumes with no button held", () => {
  const { turn, tap } = gesture();
  document.dispatchEvent(
    new PointerEvent("pointermove", {
      pointerId: 1,
      pointerType: "mouse",
      buttons: 0,
      screenX: 1000,
    }),
  );
  expect(document.querySelector("[data-ambra-page-turn-input]")).toBeNull();
  document.dispatchEvent(pointer("pointerup", 1000, 200));
  expect(tap).not.toHaveBeenCalled();
  turn.dispose();
});

it.each([1, -1] as const)(
  "settles an active flick when a buttons-cleared move precedes pointerup (side=%s)",
  async (side) => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const events: ControlledPageTurnDiagnostic[] = [];
    const { turn, tap } = gesture(side, 0.4, 1000, "mouse", (event) => events.push(event));
    document.dispatchEvent(pointer("pointermove", 1000 - side * 60, 200));
    const release = pointer("pointermove", 1000 - side * 80, 220);
    Object.defineProperty(release, "buttons", { value: 0 });
    document.dispatchEvent(release);
    document.dispatchEvent(pointer("pointerup", 1000 - side * 80, 230));
    await expect(turn.play(vi.fn(), undefined, true)).resolves.toBeUndefined();
    expect(tap).not.toHaveBeenCalled();
    expect(events.filter((event) => event.phase === "up")).toHaveLength(1);
    expect(events.find((event) => event.phase === "up")).toMatchObject({
      release: "buttons-cleared",
      recentPx: 60,
      ageMs: 20,
    });
    expect(events.find((event) => event.phase === "decision")).toMatchObject({
      distancePass: true,
      releasePass: true,
      flickPass: true,
      cancelled: false,
      commit: true,
    });
    expect(document.querySelector("[data-ambra-page-turn-input]")).toBeNull();
  },
);

it("does not count free movement after release toward flick or slow-release thresholds", async () => {
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  const { turn } = gesture();
  document.dispatchEvent(pointer("pointermove", 990, 200));
  const release = pointer("pointermove", 400, 220);
  Object.defineProperty(release, "buttons", { value: 0 });
  document.dispatchEvent(release);
  await expect(turn.play(vi.fn(), undefined, true)).rejects.toBeInstanceOf(
    PageTurnGestureCancelled,
  );
});

it("still commits a slow qualifying drag after a long hold with no final pointerup", async () => {
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  const { turn } = gesture();
  document.dispatchEvent(pointer("pointermove", 550, 200));
  const release = pointer("pointermove", 550, 3000);
  Object.defineProperty(release, "buttons", { value: 0 });
  document.dispatchEvent(release);
  await expect(turn.play(vi.fn(), undefined, true)).resolves.toBeUndefined();
});

it("still rejects an expired flick when only a buttons-cleared move arrives", async () => {
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  const { turn } = gesture();
  document.dispatchEvent(pointer("pointermove", 940, 200));
  const release = pointer("pointermove", 940, 451);
  Object.defineProperty(release, "buttons", { value: 0 });
  document.dispatchEvent(release);
  await expect(turn.play(vi.fn(), undefined, true)).rejects.toBeInstanceOf(
    PageTurnGestureCancelled,
  );
});

it("does not commit a buttons-cleared move while the reader is unfocused", async () => {
  vi.spyOn(document, "hasFocus").mockReturnValue(false);
  const { turn } = gesture();
  document.dispatchEvent(pointer("pointermove", 500, 200));
  const release = pointer("pointermove", 500, 220);
  Object.defineProperty(release, "buttons", { value: 0 });
  document.dispatchEvent(release);
  await expect(turn.play(vi.fn(), undefined, true)).rejects.toBeInstanceOf(
    PageTurnGestureCancelled,
  );
});

it("propagates a pointer-preview paint failure through the turn promise", async () => {
  const { turn } = gesture();
  const error = new Error("preview paint failed");
  const paint = vi
    .fn()
    .mockImplementationOnce(() => {})
    .mockImplementation(() => {
      throw error;
    });
  const failed = turn.play(paint);
  const assertion = expect(failed).rejects.toBe(error);
  document.dispatchEvent(pointer("pointermove", 700, 1000));
  await assertion;
  expect(document.body.children).toHaveLength(0);
});

it("rejects a settling paint failure rather than leaving the promise pending", async () => {
  const { turn } = gesture();
  document.dispatchEvent(pointer("pointermove", 550, 1000));
  document.dispatchEvent(pointer("pointerup", 550, 1200));
  let frame: FrameRequestCallback | undefined;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frame = callback;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const error = new Error("settling paint failed");
  const paint = vi
    .fn()
    .mockImplementationOnce(() => {})
    .mockImplementation(() => {
      throw error;
    });
  const result = turn.play(paint);
  const assertion = expect(result).rejects.toBe(error);
  frame!(performance.now() + 1000);
  await assertion;
  expect(document.body.children).toHaveLength(0);
});
