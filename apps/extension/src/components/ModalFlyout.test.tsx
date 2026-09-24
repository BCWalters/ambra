import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModalFlyout } from "./ModalFlyout.js";
import { HelpAboutFlyout } from "./HelpAboutFlyout.js";
import { KeyboardShortcutsDialog } from "./KeyboardShortcutsDialog.js";
import { useShortcutPreferences } from "../shortcuts/ShortcutPreferencesContext.js";

vi.mock("../shortcuts/ShortcutPreferencesContext.js", () => ({ useShortcutPreferences: vi.fn() }));

describe("ModalFlyout with real Fluent focus and Escape handling", () => {
  let container: HTMLDivElement;
  let root: Root;
  let removeDocumentListener: (() => void) | undefined;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("chrome", { runtime: { getManifest: () => ({ version: "1.2.3" }) } });
    vi.mocked(useShortcutPreferences).mockReturnValue({
      preferences: { enabled: true }, platform: "other", ready: true, error: undefined,
      setPreferences: vi.fn().mockResolvedValue(undefined),
    });
    const animate = Element.prototype.animate;
    vi.spyOn(Element.prototype, "animate").mockImplementation(function (this: Element, keyframes, options) {
      const animation = animate.call(this, keyframes, options);
      // Fluent observes finish/cancel events, not Happy DOM's eager rejected promise.
      void animation.finished.catch(() => undefined);
      queueMicrotask(() => animation.finish());
      return animation;
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    removeDocumentListener?.();
    removeDocumentListener = undefined;
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("closes the modal exactly once without closing an underlying document-level pane", async () => {
    const closeModal = vi.fn();
    const closeUnderlyingPane = vi.fn();
    const underlyingEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeUnderlyingPane();
    };
    document.addEventListener("keydown", underlyingEscape);
    removeDocumentListener = () => document.removeEventListener("keydown", underlyingEscape);
    function Harness() {
      const [open, setOpen] = useState(true);
      return <FluentProvider theme={webLightTheme}>
        <ModalFlyout open={open} title="Modal help" backgroundSolid="#fff" onRequestClose={() => {
          closeModal();
          setOpen(false);
        }}>
          <button data-test="modal-content">Modal content</button>
        </ModalFlyout>
      </FluentProvider>;
    }
    await act(async () => root.render(<Harness />));
    const content = document.querySelector<HTMLButtonElement>('[data-test="modal-content"]')!;
    expect(content).not.toBeNull();
    await act(async () => content.focus());
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    await act(async () => content.dispatchEvent(escape));
    expect(closeModal).toHaveBeenCalledOnce();
    expect(escape.defaultPrevented).toBe(true);
    expect(closeUnderlyingPane).not.toHaveBeenCalled();
  });

  it("closes on the first Escape after the Close button has remained focused", async () => {
    const closeModal = vi.fn();
    await act(async () => root.render(<FluentProvider theme={webLightTheme}>
      <ModalFlyout open title="Delayed focus" backgroundSolid="#fff" onRequestClose={closeModal}>
        <button>Content</button>
      </ModalFlyout>
    </FluentProvider>));
    const closeButton = document.querySelector<HTMLButtonElement>('[role="dialog"] button')!;
    await act(async () => {
      closeButton.focus();
      closeButton.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));
      await new Promise((resolve) => setTimeout(resolve, 400));
    });

    expect(closeButton.getAttribute("aria-label")).toBe("Close");
    expect(closeButton.title).toBe("Close");
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    await act(async () => closeButton.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape", bubbles: true, cancelable: true,
    })));
    expect(closeModal).toHaveBeenCalledOnce();
  });

  it("distinguishes a backdrop dismissal from keyboard dismissal", async () => {
    const close = vi.fn();
    const outside = vi.fn();
    await act(async () => root.render(<FluentProvider theme={webLightTheme}>
      <ModalFlyout open title="Reading help" backgroundSolid="#fff"
        onRequestClose={close} onOutsideClick={outside}>
        <button>Content</button>
      </ModalFlyout>
    </FluentProvider>));
    const backdrop = document.querySelector<HTMLElement>(".fui-OverlayDrawer__backdrop")!;
    expect(backdrop).not.toBeNull();
    await act(async () => backdrop.click());
    expect(outside).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
    const button = document.querySelector<HTMLButtonElement>('[role="dialog"] button')!;
    await act(async () => button.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape", bubbles: true, cancelable: true,
    })));
    expect(close).toHaveBeenCalledOnce();
    expect(outside).toHaveBeenCalledOnce();
  });

  it.each([false, true])("retains Fluent modal focus trapping with explicit close ownership (%s)", async (manualRestoration) => {
    await act(async () => root.render(<FluentProvider theme={webLightTheme}>
      <ModalFlyout
        open title="Focus ownership" backgroundSolid="#fff" onRequestClose={vi.fn()}
        onAfterClose={manualRestoration ? vi.fn() : undefined}
      >
        <button>Content</button>
      </ModalFlyout>
    </FluentProvider>));
    const dialog = document.querySelector('[role="dialog"]')!;
    const tabster = JSON.parse(dialog.getAttribute("data-tabster") ?? "{}") as { modalizer?: unknown };
    expect(tabster.modalizer).toBeDefined();
  });

  it("focuses the Help shortcut link after entering only when returning from the nested shortcut view", async () => {
    const render = async (open: boolean, focusShortcutsOnOpen: boolean) => {
      await act(async () => root.render(<FluentProvider theme={webLightTheme}>
        <HelpAboutFlyout
          open={open} focusShortcutsOnOpen={focusShortcutsOnOpen}
          onRequestClose={vi.fn()} onOpenKeyboardShortcuts={vi.fn()}
          backgroundSolid="#fff" accentForeground="#7a3e00"
        />
      </FluentProvider>));
    };
    const shortcutLink = () => [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Show keyboard shortcuts")!;
    await render(false, false);
    await render(true, false);
    expect(shortcutLink()).toBeDefined();
    expect(document.activeElement).not.toBe(shortcutLink());
    await render(false, false);
    await render(true, true);
    expect(document.activeElement).toBe(shortcutLink());
  });

  it("keeps checkbox focus through saving so Escape still dismisses the real modal", async () => {
    let finishSave!: () => void;
    let preferences = { enabled: true };
    const setPreferences = vi.fn((next: { enabled: boolean }) => new Promise<void>((resolve) => {
      finishSave = () => { preferences = next; resolve(); };
    }));
    vi.mocked(useShortcutPreferences).mockImplementation(() => ({
      preferences, platform: "other", ready: true, error: undefined, setPreferences,
    }));
    const closeModal = vi.fn();
    function Harness() {
      const [open, setOpen] = useState(true);
      return <FluentProvider theme={webLightTheme}>
        <KeyboardShortcutsDialog open={open} onRequestClose={() => {
          closeModal();
          setOpen(false);
        }} />
      </FluentProvider>;
    }
    await act(async () => root.render(<Harness />));
    const checkbox = document.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    await act(async () => checkbox.focus());
    await act(async () => checkbox.click());
    expect(document.activeElement).toBe(checkbox);
    expect(checkbox.disabled).toBe(false);
    expect(checkbox.getAttribute("aria-disabled")).toBe("true");
    await act(async () => checkbox.click());
    expect(setPreferences).toHaveBeenCalledOnce();
    await act(async () => finishSave());
    expect(checkbox.checked).toBe(false);
    expect(document.activeElement).toBe(checkbox);
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape", bubbles: true, cancelable: true,
    })));
    expect(closeModal).toHaveBeenCalledOnce();
  });
});
