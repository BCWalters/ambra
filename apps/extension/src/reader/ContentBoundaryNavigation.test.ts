// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { isReaderOwnedContent, NavPoint } from "@ambra/engine";
import type { PackageDocument } from "@ambra/engine";
import { getTranslate } from "../i18n/translate.js";
import { attachContentBoundary, contentBoundary, setContentBoundaryShortcut } from "./ContentBoundaryNavigation.js";

const pkg = {
  spine: [
    { manifestItem: { path: "one.xhtml" } },
    { manifestItem: { path: "two.xhtml" }, linear: false },
  ],
} as unknown as Pick<PackageDocument, "spine">;
const translate = getTranslate("en");
const toc = [new NavPoint("Second chapter", "two.xhtml", undefined, [])];

describe("contentBoundary", () => {
  it("names only the actual destination and follows the existing non-linear spine convention", () => {
    expect(contentBoundary(0, false, pkg, toc, translate)).toEqual({
      label: "Next chapter: Second chapter", nextSpineIndex: 1,
    });
    expect(contentBoundary(0, false, pkg, [new NavPoint("Earlier", "one.xhtml", undefined, [])], translate))
      .toEqual({ label: "Next section", nextSpineIndex: 1 });
    expect(contentBoundary(0, false, pkg, [new NavPoint("Later section", "two.xhtml", "later", [])], translate))
      .toEqual({ label: "Next section", nextSpineIndex: 1 });
  });

  it("finds nested document titles, translates labels, and uses pages for FXL", () => {
    const nested = [new NavPoint("Part", undefined, undefined, toc)];
    expect(contentBoundary(0, false, pkg, nested, getTranslate("fr")).label)
      .toBe("Chapitre suivant : Second chapter");
    expect(contentBoundary(0, true, pkg, nested, translate))
      .toEqual({ label: "Next page", nextSpineIndex: 1 });
  });

  it("has an end message without a destination at the final spine item", () => {
    expect(contentBoundary(1, false, pkg, toc, translate)).toEqual({ label: "End of book" });
    expect(contentBoundary(1, true, pkg, toc, translate)).toEqual({ label: "End of book" });
  });
});

describe("attachContentBoundary", () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
    Reflect.deleteProperty(HTMLElement.prototype, "showPopover");
  });

  function attach(nextSpineIndex: number | undefined = 1, activate = vi.fn(async () => {}),
    revealOverlay?: () => () => void) {
    // happy-dom has no top-layer implementation; real behavior is covered in E2E.
    const show = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "showPopover", { configurable: true, value: show });
    document.body.innerHTML = "<p>Publication text.</p>";
    const dispose = attachContentBoundary(
      { document, spineIndex: 0, physicalSide: "single", revealOverlay },
      nextSpineIndex === -1 ? { label: "End of book" } : { label: "Next section", nextSpineIndex },
      "Continue reading",
      activate,
      "en",
    );
    const root = document.body.lastElementChild!;
    return { root, nav: root.shadowRoot!.querySelector("nav")!, dispose, activate, show };
  }

  it("appends a native navigation landmark without changing publication text or moving focus", () => {
    const before = document.activeElement;
    const { root, nav, activate, show, dispose } = attach();
    expect(document.body.textContent).toBe("Publication text.");
    expect(isReaderOwnedContent(root)).toBe(true);
    expect(nav.getAttribute("aria-label")).toBe("Continue reading");
    expect(nav.getAttribute("popover")).toBe("manual");
    expect(nav.lang).toBe("en");
    expect(nav.querySelector("button")?.textContent).toBe("Next section");
    expect(document.activeElement).toBe(before);
    expect(show).toHaveBeenCalledOnce();
    expect(activate).not.toHaveBeenCalled();
    dispose();
    expect(document.body.children).toHaveLength(1);
  });

  it("updates and clears ARIA shortcut hints without replacing the boundary button", () => {
    const { nav, dispose } = attach();
    const button = nav.querySelector("button")!;
    setContentBoundaryShortcut(document, "Alt+PageDown");
    expect(button.getAttribute("aria-keyshortcuts")).toBe("Alt+PageDown");
    setContentBoundaryShortcut(document, "Control+B");
    expect(nav.querySelector("button")).toBe(button);
    expect(button.getAttribute("aria-keyshortcuts")).toBe("Control+B");
    setContentBoundaryShortcut(document, undefined);
    expect(button.hasAttribute("aria-keyshortcuts")).toBe(false);
    dispose();
    setContentBoundaryShortcut(document, "Alt+PageDown");
    expect(button.hasAttribute("aria-keyshortcuts")).toBe(false);
  });

  it("ignores repeated activation while pending and detached stale callbacks", async () => {
    let finish!: () => void;
    const activate = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const { nav, dispose } = attach(1, activate);
    const button = nav.querySelector("button")!;
    button.click();
    button.click();
    expect(activate).toHaveBeenCalledExactlyOnceWith(1);
    finish();
    await Promise.resolve();
    button.click();
    expect(activate).toHaveBeenCalledTimes(2);
    dispose();
    finish();
    await Promise.resolve();
    button.click();
    expect(activate).toHaveBeenCalledTimes(2);
  });

  it("stops retargeted content shortcuts and gestures, preserving native button defaults", () => {
    const { nav } = attach();
    const listener = vi.fn();
    document.addEventListener("keydown", listener);
    const key = new KeyboardEvent("keydown", { key: " ", bubbles: true, composed: true, cancelable: true });
    nav.querySelector("button")!.dispatchEvent(key);
    expect(listener).not.toHaveBeenCalled();
    expect(key.defaultPrevented).toBe(false);
    document.removeEventListener("keydown", listener);
  });

  it("renders a focusable end message, never a dead Next button", () => {
    const { nav, activate } = attach(-1);
    expect(nav.querySelector("button")).toBeNull();
    const message = nav.querySelector("p")!;
    expect(message.textContent).toBe("End of book");
    expect(message.tabIndex).toBe(0);
    message.click();
    expect(activate).not.toHaveBeenCalled();
  });

  it("does not attach duplicate navigation to the aria-hidden same-chapter iframe", () => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    document.body.append(iframe);
    const doc = iframe.contentDocument!;
    Object.defineProperty(doc.defaultView, "frameElement", { configurable: true, value: iframe });
    const cleanup = attachContentBoundary(
      { document: doc, spineIndex: 0, physicalSide: "right" },
      { label: "Next section", nextSpineIndex: 1 },
      "Continue reading",
      vi.fn(async () => {}),
      "en",
    );
    expect(doc.querySelector("[data-ambra-boundary]")).toBeNull();
    cleanup();
  });

  it("reveals the host surface only while focused and restores it on disposal", () => {
    const restore = vi.fn();
    const reveal = vi.fn(() => restore);
    const { nav, dispose } = attach(1, vi.fn(async () => {}), reveal);
    expect(reveal).not.toHaveBeenCalled();
    const button = nav.querySelector("button")!;
    button.focus();
    expect(reveal).toHaveBeenCalledOnce();
    button.blur();
    expect(restore).toHaveBeenCalledOnce();
    button.focus();
    expect(reveal).toHaveBeenCalledTimes(2);
    dispose();
    expect(restore).toHaveBeenCalledTimes(2);
  });
});
