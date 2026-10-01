import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Button, FluentProvider, useRestoreFocusTarget, webLightTheme } from "@fluentui/react-components";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CenteredDialog } from "./CenteredDialog.js";

describe("Centered reference dialog", () => {
  let root: Root;
  let container: HTMLDivElement;
  const close = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    close.mockReset();
    const animate = Element.prototype.animate;
    vi.spyOn(Element.prototype, "animate").mockImplementation(function (this: Element, keyframes, options) {
      const animation = animate.call(this, keyframes, options);
      vi.spyOn(animation, "cancel").mockImplementation(() => animation.finish());
      queueMicrotask(() => animation.finish());
      return animation;
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  function Example({ afterClose }: { afterClose?: (() => void) | undefined }) {
    const [open, setOpen] = useState(false);
    const target = useRestoreFocusTarget();
    return <>
      <Button {...target} onClick={() => setOpen(true)}>Find books</Button>
      <CenteredDialog title="Find books" open={open} onAfterClose={afterClose}
        onRequestClose={() => { close(); setOpen(false); }}>
        <a href="https://standardebooks.org/ebooks">Standard Ebooks</a>
      </CenteredDialog>
    </>;
  }
  it("owns Escape, closes once and restores the invoker after dismissal", async () => {
    const documentEscape = vi.fn();
    const listener = (event: KeyboardEvent) => { if (event.key === "Escape") documentEscape(); };
    document.addEventListener("keydown", listener);
    try {
      await act(async () => root.render(<FluentProvider theme={webLightTheme}><Example /></FluentProvider>));
      const trigger = container.querySelector("button")!;
      await act(async () => { trigger.focus(); trigger.click(); });
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
      expect(dialog.getAttribute("aria-modal")).toBe("true");
      const dismiss = dialog.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!;
      expect(document.activeElement).toBe(dismiss);
      await act(async () => dismiss.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
      await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });
      expect(close).toHaveBeenCalledOnce();
      expect(documentEscape).not.toHaveBeenCalled();
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(document.activeElement).toBe(trigger);
    } finally { document.removeEventListener("keydown", listener); }
  });

  it("restores the invoker after pointer backdrop dismissal even when pointerdown has cleared dialog focus", async () => {
    await act(async () => root.render(<FluentProvider theme={webLightTheme}><Example /></FluentProvider>));
    const trigger = container.querySelector("button")!;
    await act(async () => { trigger.focus(); trigger.click(); });
    const backdrop = document.querySelector<HTMLElement>(".fui-DialogSurface__backdrop")!;
    await act(async () => {
      backdrop.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      (document.activeElement as HTMLElement).blur();
      backdrop.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      backdrop.click();
    });
    await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });
    expect(close).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("leaves explicit reader restoration with its callback after the modal finishes closing", async () => {
    const readerTarget = document.createElement("button");
    document.body.append(readerTarget);
    const afterClose = vi.fn(() => readerTarget.focus());
    try {
      await act(async () => root.render(<FluentProvider theme={webLightTheme}><Example afterClose={afterClose} /></FluentProvider>));
      const trigger = container.querySelector("button")!;
      await act(async () => { trigger.focus(); trigger.click(); });
      expect(afterClose).not.toHaveBeenCalled();
      await act(async () => document.querySelector<HTMLButtonElement>('[role="dialog"] button[aria-label="Close"]')!.click());
      await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });
      expect(afterClose).toHaveBeenCalledOnce();
      expect(document.activeElement).toBe(readerTarget);
    } finally { readerTarget.remove(); }
  });
});
