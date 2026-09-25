// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { PaginatedContentHost } from "@ambra/engine";
import { ReaderController } from "./ReaderController.js";

describe("ReaderController seek focus ownership", () => {
  it.each([
    { measured: true, preserveFocus: false },
    { measured: true, preserveFocus: true },
    { measured: false, preserveFocus: false },
    { measured: false, preserveFocus: true },
  ])("forwards measured=$measured preserveFocus=$preserveFocus without changing the destination", async ({ measured, preserveFocus }) => {
    const controller = Object.create(ReaderController.prototype);
    const openSpineItem = vi.fn(async () => {});
    Object.assign(controller, {
      diagnostics: { record: vi.fn() },
      clearNavigationHighlights: vi.fn(),
      pkg: { spine: [{}, {}] },
      bookPagination: measured ? {
        positionFor: () => ({ totalPages: 8 }),
        resolveGlobalPage: () => ({ spineIndex: 1, pageIndexInItem: 1 }),
      } : undefined,
      openSpineItem,
    });
    await controller.seekToFraction(0.75, preserveFocus ? { preserveFocus: true } : undefined);
    expect(openSpineItem).toHaveBeenCalledExactlyOnceWith(1, {
      ...(measured ? { landOnPageIndex: 1 } : { landOnFractionInItem: 0.5 }),
      ...(preserveFocus ? { preserveFocus: true } : {}),
    });
  });
});

describe("ReaderController layout-only focus", () => {
  afterEach(() => document.body.replaceChildren());

  function setUp() {
    const container = document.createElement("main");
    const hostElement = document.createElement("div");
    hostElement.tabIndex = -1;
    container.append(hostElement);
    document.body.append(container);
    const node = document.createTextNode("Current reading position");
    const controller = Object.create(ReaderController.prototype);
    Object.assign(controller, {
      containerEl: container,
      spineIndex: 3,
      host: { element: hostElement, currentPosition: () => ({ node, offset: 7 }) },
      locatorResolver: { generate: vi.fn(() => ({ cfi: "saved-position" })) },
      openSpineItem: vi.fn(async () => {}),
      nativeReading: { current: () => undefined, retainedForShell: () => undefined },
    });
    return { controller, hostElement, node };
  }

  it.each(["input", "button", "div"])("preserves focused shell %s outside the replaced host", async tag => {
    const { controller, node } = setUp();
    const control = document.createElement(tag);
    control.tabIndex = 0;
    document.body.append(control);
    control.focus();
    await controller.reopenForCurrentSize();
    expect(controller.locatorResolver.generate).toHaveBeenCalledWith(3, node, 7);
    expect(controller.openSpineItem).toHaveBeenCalledWith(3, {
      bridgeCfi: "saved-position", preserveFocus: true,
    });
    expect(document.activeElement).toBe(control);
  });

  it.each(["body", "html", "host", "iframe"])("restores content focus when %s held focus", async target => {
    const { controller, hostElement } = setUp();
    const frame = document.createElement("iframe");
    hostElement.append(frame);
    const element = target === "body" ? document.body : target === "html" ? document.documentElement :
      target === "host" ? hostElement : frame;
    element.tabIndex = -1;
    element.focus();
    expect(document.activeElement).toBe(element);
    await controller.reopenForCurrentSize();
    expect(controller.openSpineItem).toHaveBeenCalledWith(3, {
      bridgeCfi: "saved-position", preserveFocus: false,
    });
  });

  it("bridges a precise companion reading position rather than the visual primary on reflow", async () => {
    const { controller, node } = setUp();
    controller.nativeReading.retainedForShell = () => ({ spineIndex: 4, node, offset: 12 });
    await controller.reopenForCurrentSize();
    expect(controller.locatorResolver.generate).toHaveBeenCalledWith(4, node, 12);
    expect(controller.openSpineItem).toHaveBeenCalledWith(4, {
      bridgeCfi: "saved-position", preserveFocus: false,
    });
  });

  it("preserves canonical page boundaries when reopening after a disclosure toggle", async () => {
    const { controller, node } = setUp();
    controller.nativeReading.retainedForShell = () => ({ spineIndex: 3, node, offset: 12 });
    await controller.reopenForCurrentSize(undefined, true);
    expect(controller.locatorResolver.generate).toHaveBeenCalledWith(3, node, 12);
    expect(controller.openSpineItem).toHaveBeenCalledWith(3, {
      bridgeCfi: "saved-position", preserveFocus: false, preservePageBoundaries: true,
    });
  });

  it.each([undefined, true, false])("restores a single-page CFI with forceAnchor=%s", forceAnchor => {
    const { controller, node } = setUp();
    const doc = document.implementation.createHTMLDocument();
    controller.host = Object.create(PaginatedContentHost.prototype);
    controller.host.goToPosition = vi.fn();
    controller.contentDocumentViews = () => [{ document: doc, spineIndex: 3 }];
    controller.locatorResolver.resolveInDocument = () => ({ node, characterOffset: 12 });
    controller.restoreCfi("epubcfi(/6/8!/4/2:12)", 3, forceAnchor);
    expect(controller.host.goToPosition).toHaveBeenCalledWith(node, 12, forceAnchor ?? true);
  });

  it("enters the requested chapter rather than the visual primary of a cross-chapter spread", () => {
    const controller = Object.create(ReaderController.prototype);
    const first = document.implementation.createHTMLDocument();
    const second = document.implementation.createHTMLDocument();
    Object.assign(controller, {
      updateContentTitle: vi.fn(),
      reattachKeyboardNav: vi.fn(),
      primaryContentDocument: () => second,
      contentDocumentViews: () => [{ document: first, spineIndex: 0 }, { document: second, spineIndex: 1 }],
      focusReadingContent: vi.fn(),
    });
    controller.setUpAccessibility(undefined, true, 0);
    expect(controller.focusReadingContent).toHaveBeenCalledWith(first, undefined);
    controller.focusReadingContent.mockClear();
    controller.setUpAccessibility(undefined, false, 0);
    expect(controller.focusReadingContent).not.toHaveBeenCalled();
    controller.setUpAccessibility(undefined, true, 1);
    expect(controller.focusReadingContent).toHaveBeenCalledWith(second, undefined);
  });

  it.each([true, false])("returns from an overlay using a retained companion position when available: %s", retained => {
    const controller = Object.create(ReaderController.prototype);
    const first = document.implementation.createHTMLDocument();
    const second = document.implementation.createHTMLDocument();
    first.body.textContent = "Original reading position";
    const point = { spineIndex: 0, node: first.body.firstChild!, offset: 9 };
    Object.assign(controller, {
      nativeReading: { current: () => retained ? point : undefined, retainedForShell: () => retained ? point : undefined, retain: vi.fn() },
      primaryContentDocument: () => second,
      contentDocumentViews: () => [{ document: first, spineIndex: 0 }, { document: second, spineIndex: 1 }],
      accessibility: { focusReadingPosition: vi.fn(), focusContent: vi.fn() },
    });
    controller.restoreContentFocus();
    if (retained) {
      expect(controller.accessibility.focusReadingPosition).toHaveBeenCalledWith(first, point);
      expect(controller.accessibility.focusContent).not.toHaveBeenCalled();
      expect(controller.nativeReading.retain).toHaveBeenCalledWith(point);
    } else {
      expect(controller.accessibility.focusContent).toHaveBeenCalledWith(second);
      expect(controller.nativeReading.retain).not.toHaveBeenCalled();
    }
  });

  it.each([true, false])("uses an explicit page destination instead of the visual page or saved caret (move=%s)", moveFocus => {
    const controller = Object.create(ReaderController.prototype);
    const doc = document.implementation.createHTMLDocument();
    doc.body.innerHTML = "<p>Left page</p><p>Right page destination</p>";
    const position = { node: doc.body.lastChild!.firstChild!, offset: 6 };
    Object.assign(controller, {
      updateContentTitle: vi.fn(),
      reattachKeyboardNav: vi.fn(),
      primaryContentDocument: () => doc,
      contentDocumentViews: () => [{ document: doc, spineIndex: 0 }],
      focusReadingContent: vi.fn(),
      nativeReading: {
        current: () => ({ spineIndex: 0, node: doc.body.firstChild!.firstChild!, offset: 2 }),
        retain: vi.fn(),
      },
      accessibility: { focusReadingPosition: vi.fn() },
    });
    controller.setUpAccessibility(undefined, moveFocus, 0, position);
    expect(controller.focusReadingContent).not.toHaveBeenCalled();
    if (moveFocus) {
      expect(controller.accessibility.focusReadingPosition).toHaveBeenCalledWith(doc, position);
      expect(controller.nativeReading.retain).toHaveBeenCalledWith({ ...position, spineIndex: 0 });
    } else {
      expect(controller.accessibility.focusReadingPosition).not.toHaveBeenCalled();
      expect(controller.nativeReading.retain).not.toHaveBeenCalled();
    }
  });
});
