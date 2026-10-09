import { describe, expect, it, vi } from "vitest";
import { ReaderController } from "./ReaderController.js";
import type { NarrationState } from "./MediaOverlayNarration.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function setup() {
  const controller: ReaderController = Object.create(ReaderController.prototype);
  const state: NarrationState = {
    available: true, status: "error", following: true, rate: 1,
    hasTarget: true, hasPrevious: true, hasNext: true, playbackRequested: false,
  };
  const element = document.createElement("p");
  const position = { spineIndex: 1, element };
  const location = { spineIndex: 1, cfi: "destination" };
  const narration = {
    snapshot: state, target: { spineIndex: 1 },
    syncReadingPosition: vi.fn(async () => {}),
    resume: vi.fn(async () => {}),
    next: vi.fn(async () => {}),
    previous: vi.fn(async () => {}),
    pause: vi.fn(() => { state.status = "paused"; state.playbackRequested = false; }),
  };
  const readingPosition = vi.fn(async () => position);
  Object.assign(controller, {
    narration, narrationCommand: 0, narrationNavigationPending: false,
    navigationListeners: new Set(), operations: { disposed: false },
    narrationReading: { currentReadingLocation: () => location, readingPosition },
    recordDiagnosticEvent: vi.fn(), cancelNarrationNavigation: vi.fn(),
    dismissNarrationNotice: vi.fn(), reportTransientError: vi.fn(),
  });
  const navigate = () => Reflect.get(controller, "notifyNavigation").call(controller);
  const pending = () => Reflect.get(controller, "narrationNavigationPending");
  return { controller, narration, state, position, location, readingPosition, navigate, pending };
}

describe("navigation-led narration transports", () => {
  it.each(["start", "next", "previous"] as const)(
    "%s uses an established errored cursor instead of re-cueing the visible page",
    async action => {
      const { controller, narration, readingPosition } = setup();
      await controller.performNarrationAction(action);
      expect(readingPosition).not.toHaveBeenCalled();
      expect(narration.syncReadingPosition).not.toHaveBeenCalled();
      expect(action === "start" ? narration.resume : narration[action]).toHaveBeenCalledOnce();
    },
  );

  it("reconciles the successful destination on Play after Pause interrupts position capture", async () => {
    const { controller, narration, state, position, readingPosition, navigate, pending } = setup();
    const captured = deferred<typeof position>();
    readingPosition.mockReturnValueOnce(captured.promise);
    state.status = "playing";
    state.playbackRequested = true;
    navigate();
    expect(pending()).toBe(true);
    await controller.performNarrationAction("toggle");
    expect(narration.pause).toHaveBeenCalledOnce();
    captured.resolve(position);
    await Promise.resolve();
    expect(narration.syncReadingPosition).not.toHaveBeenCalled();
    expect(pending()).toBe(true);
    await controller.performNarrationAction("start");
    expect(narration.syncReadingPosition).toHaveBeenCalledExactlyOnceWith(position.spineIndex, position.element);
    expect(narration.resume).toHaveBeenCalledOnce();
    expect(pending()).toBe(false);
  });

  it("does not let older same-command position capture override a later scroll destination", async () => {
    const { narration, position, location, readingPosition, navigate, pending } = setup();
    const first = deferred<typeof position>();
    const second = deferred<typeof position>();
    readingPosition.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    navigate();
    location.cfi = "later-destination";
    navigate();
    first.resolve({ ...position, spineIndex: 0 });
    await Promise.resolve();
    expect(narration.syncReadingPosition).not.toHaveBeenCalled();
    expect(pending()).toBe(true);
    second.resolve(position);
    await vi.waitFor(() => expect(pending()).toBe(false));
    expect(narration.syncReadingPosition).toHaveBeenCalledExactlyOnceWith(position.spineIndex, position.element);
  });

  it("finishes a failed destination cue so Next can recover from its established cursor", async () => {
    const { controller, narration, navigate, pending } = setup();
    navigate();
    await vi.waitFor(() => expect(pending()).toBe(false));
    await controller.performNarrationAction("next");
    expect(narration.syncReadingPosition).toHaveBeenCalledOnce();
    expect(narration.next).toHaveBeenCalledOnce();
  });
});
