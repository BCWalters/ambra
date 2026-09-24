import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureFocusReturn, useHelpDialogs } from "./useHelpDialogs.js";

describe("help dialog focus", () => {
  let root: Root;
  let container: HTMLDivElement;
  let opener: HTMLButtonElement;
  let help: ReturnType<typeof useHelpDialogs>;
  const restoreReading = vi.fn();
  function Harness() {
    help = useHelpDialogs(restoreReading);
    return null;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    restoreReading.mockClear();
    container = document.createElement("div");
    opener = document.createElement("button");
    document.body.append(container, opener);
    root = createRoot(container);
    act(() => root.render(<Harness />));
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    opener.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("restores the original opener only after the last modal finishes closing", () => {
    opener.focus();
    act(() => help.openHelp());
    expect(help.view).toBe("about");
    expect(help.focusShortcutsOnOpen).toBe(false);
    act(() => help.openShortcutsFromHelp());
    expect(help.view).toBe("shortcuts");
    const focus = vi.spyOn(opener, "focus");
    act(() => help.afterClose());
    expect(focus).not.toHaveBeenCalled();
    act(() => help.close());
    expect(help.view).toBe("about");
    expect(help.focusShortcutsOnOpen).toBe(true);
    act(() => help.afterClose());
    expect(focus).not.toHaveBeenCalled();
    act(() => help.close());
    expect(help.view).toBeUndefined();
    expect(help.focusShortcutsOnOpen).toBe(false);
    expect(focus).not.toHaveBeenCalled();
    act(() => help.afterClose());
    expect(focus).not.toHaveBeenCalled();
    act(() => vi.advanceTimersToNextFrame());
    expect(focus).toHaveBeenCalledOnce();
    act(() => help.afterClose());
    expect(focus).toHaveBeenCalledOnce();
  });

  it("returns direct shortcut help to native reading focus, not the iframe element", () => {
    const iframe = document.createElement("iframe");
    container.append(iframe);
    iframe.focus();
    act(() => help.openShortcuts());
    act(() => help.close());
    act(() => help.afterClose());
    act(() => vi.advanceTimersToNextFrame());
    expect(restoreReading).toHaveBeenCalledOnce();
  });

  it("uses the provided Settings trigger instead of a disappearing menu item", () => {
    act(() => help.openHelp(opener));
    const focus = vi.spyOn(opener, "focus");
    act(() => help.close());
    act(() => help.afterClose());
    act(() => vi.advanceTimersToNextFrame());
    expect(focus).toHaveBeenCalledOnce();
    expect(restoreReading).not.toHaveBeenCalled();
  });

  it("returns an outside dismissal to reading without reopening nested Help or its toolbar trigger", () => {
    act(() => help.openHelp(opener));
    act(() => help.openShortcutsFromHelp());
    const focus = vi.spyOn(opener, "focus");
    act(() => help.closeToContent());
    expect(help.view).toBeUndefined();
    act(() => help.afterClose());
    expect(restoreReading).not.toHaveBeenCalled();
    act(() => vi.advanceTimersToNextFrame());
    expect(restoreReading).toHaveBeenCalledOnce();
    expect(focus).not.toHaveBeenCalled();
  });

  it.each(["removed", "hidden"])("uses reading focus when the opener is %s", (state) => {
    opener.focus();
    const restore = captureFocusReturn(restoreReading);
    if (state === "removed") opener.remove();
    else opener.style.visibility = "hidden";
    restore();
    expect(restoreReading).toHaveBeenCalledOnce();
  });

  it("does not restore into a panel that has begun its closing transition", () => {
    const panel = document.createElement("aside");
    container.append(panel);
    panel.append(opener);
    opener.focus();
    const restore = captureFocusReturn(restoreReading);
    panel.style.visibility = "hidden";
    const transitionalStyle = document.createElement("div").style;
    transitionalStyle.visibility = "visible";
    vi.spyOn(window, "getComputedStyle").mockReturnValue(transitionalStyle);
    restore();
    expect(restoreReading).toHaveBeenCalledOnce();
  });

  it("cancels a queued return if another dialog is opened", () => {
    opener.focus();
    act(() => help.openHelp());
    const focus = vi.spyOn(opener, "focus");
    act(() => help.close());
    act(() => help.afterClose());
    act(() => help.openShortcuts());
    act(() => vi.advanceTimersToNextFrame());
    expect(focus).not.toHaveBeenCalled();
  });

  it("restores the opener while Fluent is releasing its temporary aria-hidden scope", () => {
    container.append(opener);
    opener.focus();
    const restore = captureFocusReturn(restoreReading);
    opener.blur();
    container.setAttribute("aria-hidden", "true");
    restore();
    expect(document.activeElement).toBe(opener);
    expect(restoreReading).not.toHaveBeenCalled();
  });
});
