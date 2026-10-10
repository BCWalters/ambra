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

  it.each(["blocking", "navigationFailed", "actionFailed"] as const)("does not auto-dismiss %s errors", (severity) => {
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

  it.each(["info", "transient", "actionFailed", "blocking", "navigationFailed"] as const)(
    "offers optional advanced inspection without dismissing a %s notification itself", severity => {
      const inspect = vi.fn();
      render({ severity, onOpenInspector: inspect });
      const button = [...container.querySelectorAll("button")].find(element => element.textContent === "EPUB Inspector (advanced)")!;
      expect(button).toBeDefined();
      act(() => button.click());
      expect(inspect).toHaveBeenCalledOnce();
      expect(onDismiss).not.toHaveBeenCalled();
      render({ severity });
      expect(container.textContent).not.toContain("EPUB Inspector (advanced)");
    },
  );

  it("keeps blocking technical details readable but smaller than the specific headline", () => {
    render({ severity: "blocking", headline: "Not a valid EPUB", message: "ZIP diagnostic" });
    const paragraphs = container.querySelectorAll("p");
    expect(paragraphs[0]?.textContent).toBe("Not a valid EPUB");
    expect(paragraphs[1]?.textContent).toBe("ZIP diagnostic");
    expect(paragraphs[1]?.style.fontSize).toBe("12px");
    expect(paragraphs[1]?.style.overflowWrap).toBe("anywhere");
    expect(container.querySelector('[tabindex="-1"]')).toBe(document.activeElement);
  });

  it("offers a direct library link on blocking errors while preserving diagnostics and initial focus", () => {
    render({ severity: "blocking", libraryHref: "chrome-extension://ambra/src/library/index.html?view=tab" });
    const link = container.querySelector("a");
    expect(link?.textContent).toBe("Open library");
    expect(link?.getAttribute("href")).toBe("chrome-extension://ambra/src/library/index.html?view=tab");
    expect(link?.getAttribute("target")).toBeNull();
    expect(container.querySelector("button")?.textContent).toBe("Copy diagnostics");
    expect(container.querySelector('[tabindex="-1"]')).toBe(document.activeElement);
  });

  it("keeps navigation errors centered below reader chrome with library and dismissal recovery", () => {
    render({ severity: "navigationFailed", libraryHref: "chrome-extension://ambra/src/library/index.html?view=tab" });
    const alert = container.querySelector<HTMLElement>('[role="alert"]')!;
    expect(alert.style.inset).toBe("0");
    expect(alert.style.zIndex).toBe("5");
    expect(alert.textContent).toContain("snickerdoodles");
    expect(alert.querySelector("a")?.textContent).toBe("Open library");
    const dismiss = [...alert.querySelectorAll("button")].find(button => button.textContent === "Dismiss")!;
    act(() => dismiss.click());
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it.each(["transient", "actionFailed", "info"] as const)("does not add a library action to %s notifications", severity => {
    render({ severity, libraryHref: "chrome-extension://ambra/src/library/index.html?view=tab" });
    expect(container.querySelector("a")).toBeNull();
  });
});
