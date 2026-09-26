// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { FixedSpreadHost, NavPoint } from "@ambra/engine";
import type { ContentDocumentView } from "@ambra/engine";
import { ReaderController } from "./ReaderController.js";
import { getTranslate } from "../i18n/translate.js";
import { DEFAULT_SHORTCUT_PREFERENCES } from "../shortcuts/ReaderCommands.js";

describe("ReaderController content boundaries", () => {
  const documents: Document[] = [];
  afterEach(() => {
    for (const doc of documents.splice(0)) doc.body.replaceChildren();
    Reflect.deleteProperty(HTMLElement.prototype, "showPopover");
  });

  function setUp(fixed = false) {
    Object.defineProperty(HTMLElement.prototype, "showPopover", { configurable: true, value: () => {} });
    const views: ContentDocumentView[] = [1, 2].map((spineIndex, index) => {
      const doc = document.implementation.createHTMLDocument();
      doc.body.innerHTML = `<p>Page ${spineIndex}</p>`;
      documents.push(doc);
      return { document: doc, spineIndex, physicalSide: index === 0 ? "right" : "left" };
    });
    const controller = Object.create(ReaderController.prototype);
    Object.assign(controller, {
      host: fixed ? Object.create(FixedSpreadHost.prototype) : {},
      operations: { disposed: false },
      translate: getTranslate("en"),
      shortcutPreferences: DEFAULT_SHORTCUT_PREFERENCES,
      shortcutPlatform: "other",
      pkg: { spine: [0, 1, 2, 3].map(index => ({ manifestItem: { path: `${index}.xhtml` } })) },
      navigation: { toc: { items: [new NavPoint("Third", "3.xhtml", undefined, [])] } },
      contentDocumentViews: () => views,
      clearNavigationHighlights: vi.fn(),
      focusReadingContent: vi.fn(),
      accessibility: { focusReadingPosition: vi.fn() },
      nativeReading: { retain: vi.fn() },
      cachedSnapshot: { bookPageIndex: 2 },
      bookWidePagePosition: () => ({ bookPageIndex: 3 }),
      notify: vi.fn(),
      openSpineItem: vi.fn(async () => {}),
    });
    controller.setUpContentBoundaries();
    const buttons = views.map(view =>
      view.document.body.lastElementChild!.shadowRoot!.querySelector("button")!,
    );
    return { controller, views, buttons };
  }

  it.each([false, true])("visits the next already-visible document before loading another (FXL=%s)", async fixed => {
    const { controller, views, buttons } = setUp(fixed);
    buttons[0]!.click();
    expect(controller.openSpineItem).not.toHaveBeenCalled();
    expect(controller.clearNavigationHighlights).toHaveBeenCalledOnce();
    if (fixed) {
      expect(controller.accessibility.focusReadingPosition).toHaveBeenCalledWith(
        views[1]!.document, { node: views[1]!.document.body, offset: 0, spineIndex: 2 },
      );
      expect(controller.nativeReading.retain).toHaveBeenCalledWith(
        { node: views[1]!.document.body, offset: 0, spineIndex: 2 },
      );
      expect(controller.notify).toHaveBeenCalledOnce();
    } else {
      expect(controller.focusReadingContent).toHaveBeenCalledWith(views[1]!.document);
      expect(controller.notify).not.toHaveBeenCalled();
    }
    buttons[1]!.click();
    expect(controller.openSpineItem).toHaveBeenCalledExactlyOnceWith(3, { history: "jump" });
    controller.boundaryCleanup();
  });

  it.each(["isLoadInFlight", "isTurningPage", "isApplyingLayout"])("ignores activation while %s", flag => {
    const { controller, buttons } = setUp();
    controller[flag] = true;
    buttons[1]!.click();
    expect(controller.openSpineItem).not.toHaveBeenCalled();
    expect(controller.clearNavigationHighlights).not.toHaveBeenCalled();
    controller.boundaryCleanup();
  });

  it("rejects callbacks from an old host and after disposal, and removes stale listeners on rewiring", () => {
    const { controller, buttons, views } = setUp();
    controller.host = {};
    buttons[1]!.click();
    expect(controller.openSpineItem).not.toHaveBeenCalled();
    controller.setUpContentBoundaries();
    expect(views[0]!.document.querySelectorAll("[data-ambra-boundary]")).toHaveLength(1);
    buttons[0]!.click();
    expect(controller.focusReadingContent).not.toHaveBeenCalled();
    controller.operations.disposed = true;
    const current = views[1]!.document.body.lastElementChild!.shadowRoot!.querySelector("button")!;
    current.click();
    expect(controller.openSpineItem).not.toHaveBeenCalled();
    controller.setUpContentBoundaries();
    expect(views[0]!.document.querySelectorAll("[data-ambra-boundary]")).toHaveLength(0);
  });

  it("updates the in-book label and its speech language without changing the publication language", () => {
    const { controller, views } = setUp();
    views[1]!.document.documentElement.lang = "en";
    controller.setTranslate(getTranslate("fr"));
    const nav = views[1]!.document.body.lastElementChild!.shadowRoot!.querySelector("nav")!;
    expect(nav.lang).toBe("fr");
    expect(nav.textContent).toBe("Chapitre suivant : Third");
    expect(views[1]!.document.documentElement.lang).toBe("en");
    controller.boundaryCleanup();
  });

  it("keeps existing boundary shortcut hints synchronized with enabled settings", () => {
    const { controller, buttons, views } = setUp();
    expect(buttons[0]!.getAttribute("aria-keyshortcuts")).toBe("Alt+PageDown");
    controller.setShortcutPreferences({ enabled: false }, "other");
    expect(buttons[0]!.hasAttribute("aria-keyshortcuts")).toBe(false);
    controller.setShortcutPreferences({ enabled: true }, "mac");
    expect(buttons[0]!.getAttribute("aria-keyshortcuts")).toBe("Alt+PageDown");
    expect(views[0]!.document.body.lastElementChild!.shadowRoot!.querySelector("button")).toBe(buttons[0]);
    controller.boundaryCleanup();
  });
});
