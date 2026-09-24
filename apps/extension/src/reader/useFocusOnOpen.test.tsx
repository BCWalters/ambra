import { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFocusOnOpen } from "./useFocusOnOpen.js";

function Panel({ open, requestId = 0 }: { open: boolean; requestId?: number }) {
  const ref = useRef<HTMLElement | null>(null);
  useFocusOnOpen(ref, open, requestId);
  return (
    <aside ref={ref} tabIndex={-1}>
      <button>Open modal</button>
    </aside>
  );
}

describe("useFocusOnOpen", () => {
  let root: Root;
  let container: HTMLDivElement;
  let outside: HTMLButtonElement;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    outside = document.createElement("button");
    document.body.append(container, outside);
    root = createRoot(container);
    act(() => root.render(<Panel open={false} />));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    outside.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function open() {
    act(() => root.render(<Panel open />));
    return container.querySelector("aside")!;
  }

  it("does not retry after successfully focusing the panel", () => {
    const panel = open();
    expect(document.activeElement).toBe(panel);
    const focus = vi.spyOn(panel, "focus");
    outside.focus();
    panel.dispatchEvent(new Event("transitionend"));
    vi.advanceTimersByTime(400);
    expect(focus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(outside);
  });

  it.each(["transitionend", "timeout"])("retries an initially rejected focus on %s", (retry) => {
    const panel = container.querySelector("aside")!;
    const focus = vi.spyOn(panel, "focus").mockImplementationOnce(() => undefined);
    open();
    expect(document.activeElement).not.toBe(panel);
    if (retry === "transitionend") panel.dispatchEvent(new Event("transitionend"));
    else vi.advanceTimersByTime(350);
    expect(document.activeElement).toBe(panel);
    expect(focus).toHaveBeenCalledTimes(2);
    outside.focus();
    vi.advanceTimersByTime(400);
    expect(document.activeElement).toBe(outside);
  });

  it.each(["child", "outside"])(
    "cancels a pending retry when focus moves to a %s control",
    (target) => {
      const panel = container.querySelector("aside")!;
      const focus = vi.spyOn(panel, "focus").mockImplementationOnce(() => undefined);
      open();
      const next = target === "child" ? panel.querySelector("button")! : outside;
      next.focus();
      panel.dispatchEvent(new Event("transitionend"));
      vi.advanceTimersByTime(400);
      expect(focus).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(next);
    },
  );

  it("cancels retries when the panel closes", () => {
    const panel = container.querySelector("aside")!;
    const focus = vi.spyOn(panel, "focus").mockImplementationOnce(() => undefined);
    open();
    act(() => root.render(<Panel open={false} />));
    panel.dispatchEvent(new Event("transitionend"));
    vi.advanceTimersByTime(400);
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it("accepts a new focus request while the panel is already open", () => {
    const panel = open();
    outside.focus();
    act(() => root.render(<Panel open requestId={1} />));
    expect(document.activeElement).toBe(panel);
    outside.focus();
    vi.advanceTimersByTime(400);
    expect(document.activeElement).toBe(outside);
  });
});
