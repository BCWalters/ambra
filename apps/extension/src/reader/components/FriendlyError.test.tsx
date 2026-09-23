import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FriendlyError } from "./FriendlyError.js";
import type { FriendlyErrorProps } from "./FriendlyError.js";

describe("FriendlyError notification lifetime", () => {
  let root: Root;
  let container: HTMLDivElement;
  const onDismiss = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    onDismiss.mockClear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function render(props: Partial<FriendlyErrorProps> = {}) {
    act(() => root.render(
      <FriendlyError message="First" severity="info" onDismiss={onDismiss} getDiagnosticsText={() => undefined} {...props} />,
    ));
  }

  it.each(["info", "transient"] as const)("gives a replacement %s message its full lifetime", (severity) => {
    render({ severity });
    act(() => vi.advanceTimersByTime(7000));
    render({ severity, message: "Replacement" });
    act(() => vi.advanceTimersByTime(7999));
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("restarts for an identical message with a new notification identity", () => {
    render({ notificationId: 1 });
    act(() => vi.advanceTimersByTime(7000));
    render({ notificationId: 2 });
    act(() => vi.advanceTimersByTime(7999));
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("uses the latest callback without extending the same notification's lifetime", () => {
    render();
    act(() => vi.advanceTimersByTime(7000));
    const latestDismiss = vi.fn();
    render({ onDismiss: latestDismiss });
    act(() => vi.advanceTimersByTime(1000));
    expect(latestDismiss).toHaveBeenCalledOnce();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it.each(["blocking", "actionFailed"] as const)("does not auto-dismiss %s errors", (severity) => {
    render();
    render({ severity });
    act(() => vi.advanceTimersByTime(16000));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("cancels the pending dismissal on unmount", () => {
    render();
    act(() => root.render(null));
    act(() => vi.advanceTimersByTime(8000));
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
