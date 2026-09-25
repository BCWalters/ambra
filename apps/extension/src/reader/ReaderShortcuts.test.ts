import { afterEach, expect, it, vi } from "vitest";
import { AccessibilityController, FixedContentHost, PaginatedContentHost, ScrollContentHost } from "@ambra/engine";
import { ReaderController } from "./ReaderController.js";
import { DiagnosticsLog } from "./DiagnosticsLog.js";

afterEach(() => document.body.replaceChildren());

it.each(["shell", "content"] as const)("dispatches Go to through the action bridge from %s without changing reading mode", scope => {
  const { controller, first } = setup();
  const doc = scope === "content" ? first : document;
  const goToPage = vi.fn();
  const goToPercentage = vi.fn();
  Object.assign(controller, {
    shortcutPreferences: { enabled: true },
    shortcutPlatform: "other",
    setViewMode: vi.fn(),
  });
  const press = (shiftKey = false) => {
    const event = new KeyboardEvent("keydown", { key: "g", ctrlKey: true, shiftKey, cancelable: true });
    controller.handleShortcut(event, doc, scope);
    return event;
  };
  expect(press().defaultPrevented).toBe(false);
  controller.setShortcutActions({ searchBook: vi.fn(), showKeyboardShortcuts: vi.fn(), goToPage, goToPercentage });
  for (const Host of [PaginatedContentHost, ScrollContentHost, FixedContentHost]) {
    controller.host = Object.create(Host.prototype);
    expect(press().defaultPrevented).toBe(true);
    expect(press(true).defaultPrevented).toBe(true);
  }
  expect(goToPage).toHaveBeenCalledTimes(3);
  expect(goToPercentage).toHaveBeenCalledTimes(3);
  expect(controller.setViewMode).not.toHaveBeenCalled();
  controller.setShortcutModalOpen(true);
  expect(press().defaultPrevented).toBe(false);
  controller.setShortcutModalOpen(false);
  controller.setShortcutPreferences({ enabled: false }, "other");
  expect(press(true).defaultPrevented).toBe(false);
  expect(goToPercentage).toHaveBeenCalledTimes(3);
});
function setup() {
  const first = document.implementation.createHTMLDocument();
  const second = document.implementation.createHTMLDocument();
  const controller = Object.create(ReaderController.prototype);
  Object.assign(controller, {
    diagnostics: new DiagnosticsLog(),
    spineIndex: 1,
    pkg: { spine: [{}, {}, {}], pageProgressionDirection: "ltr" },
    operations: { disposed: false },
    contentDocumentViews: () => [
      { document: first, spineIndex: 0, page: { index: 0 } },
      { document: second, spineIndex: 1, page: { index: 0 } },
    ],
    nativeReading: { current: () => ({ spineIndex: 0 }), retain: vi.fn() },
    accessibility: new AccessibilityController(),
    openSpineItem: vi.fn(),
    clearNavigationHighlights: vi.fn(),
  });
  return { controller, first, second };
}
it("enters the right companion from the left source rather than skipping the merged spread", async () => {
  const { controller, first, second } = setup();
  const focus = vi.spyOn(controller.accessibility, "focusReadingPosition");
  await controller.goToChapter(1, first);
  expect(focus).toHaveBeenCalledWith(second, { spineIndex: 1, node: second.body, offset: 0 });
  expect(controller.nativeReading.retain).toHaveBeenCalledWith({ spineIndex: 1, node: second.body, offset: 0 });
  expect(controller.openSpineItem).not.toHaveBeenCalled();
});
it("uses native reading spine when invoked from shell and opens the next unmounted section", async () => {
  const { controller, second } = setup();
  await controller.goToChapter(1, document);
  expect(controller.nativeReading.retain).toHaveBeenCalledWith({ spineIndex: 1, node: second.body, offset: 0 });
  await controller.goToChapter(1, second);
  expect(controller.openSpineItem).toHaveBeenCalledWith(2);
});
it("does not reuse the end of a previous companion as its section start", async () => {
  const { controller, first, second } = setup();
  controller.contentDocumentViews = () => [
    { document: first, spineIndex: 0, page: { index: 3 } },
    { document: second, spineIndex: 1, page: { index: 0 } },
  ];
  await controller.goToChapter(-1, second);
  expect(controller.openSpineItem).toHaveBeenCalledWith(0);
});
it("has one app registry listener with no legacy fallback when disabled", () => {
  const { controller } = setup();
  controller.shortcutPreferences = { enabled: false };
  controller.shortcutPlatform = "other";
  controller.turnPage = vi.fn();
  controller.goToChapter = vi.fn();
  controller.setUpGlobalArrowKeyFallback(document);
  const press = (key: string, init: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
    document.body.dispatchEvent(event);
    return event;
  };
  expect(press("ArrowRight").defaultPrevented).toBe(false);
  expect(press("ArrowRight", { ctrlKey: true }).defaultPrevented).toBe(false);
  expect(controller.goToChapter).not.toHaveBeenCalled();
  controller.setShortcutPreferences({ enabled: true }, "other");
  expect(press("ArrowRight").defaultPrevented).toBe(true);
  expect(controller.goToChapter).toHaveBeenCalledExactlyOnceWith(1, document);
  controller.setUpGlobalArrowKeyFallback(document);
  press("ArrowRight");
  expect(controller.goToChapter).toHaveBeenCalledTimes(2);
  controller.globalArrowKeyCleanup();
  press("ArrowRight");
  expect(controller.goToChapter).toHaveBeenCalledTimes(2);
});

it("dispatches explicit idempotent view modes through the existing asynchronous layout API", async () => {
  const { controller } = setup();
  Object.assign(controller, {
    containerEl: document.createElement("main"),
    host: Object.create(PaginatedContentHost.prototype),
    shortcutPreferences: { enabled: true },
    shortcutPlatform: "other",
    setViewMode: vi.fn(async (mode: string) => {
      controller.host = Object.create(mode === "scroll" ? ScrollContentHost.prototype : PaginatedContentHost.prototype);
    }),
  });
  const press = (key: string) => {
    const event = new KeyboardEvent("keydown", { key, altKey: true, shiftKey: true, cancelable: true });
    Object.defineProperty(event, "getModifierState", { value: () => false });
    controller.handleShortcut(event, document, "shell");
    return event;
  };
  expect(press("PageDown").defaultPrevented).toBe(true);
  await Promise.resolve();
  expect(controller.setViewMode).toHaveBeenLastCalledWith("scroll");
  expect(press("PageDown").defaultPrevented).toBe(true);
  expect(controller.setViewMode).toHaveBeenLastCalledWith("scroll");
  expect(press("PageUp").defaultPrevented).toBe(true);
  expect(controller.setViewMode).toHaveBeenLastCalledWith("paginated");
  expect(controller.setViewMode).toHaveBeenCalledTimes(3);
});

it("leaves fixed-layout and unavailable mode commands entirely unhandled", () => {
  const { controller } = setup();
  Object.assign(controller, {
    containerEl: document.createElement("main"),
    host: Object.create(FixedContentHost.prototype),
    shortcutPreferences: { enabled: true },
    shortcutPlatform: "other",
    setViewMode: vi.fn(),
  });
  const event = new KeyboardEvent("keydown", { key: "PageDown", altKey: true, shiftKey: true, cancelable: true });
  Object.defineProperty(event, "getModifierState", { value: () => false });
  controller.handleShortcut(event, document, "shell");
  expect(event.defaultPrevented).toBe(false);
  controller.host = undefined;
  controller.handleShortcut(event, document, "shell");
  expect(event.defaultPrevented).toBe(false);
  controller.host = Object.create(PaginatedContentHost.prototype);
  controller.operations.disposed = true;
  controller.handleShortcut(event, document, "shell");
  expect(event.defaultPrevented).toBe(false);
  expect(controller.setViewMode).not.toHaveBeenCalled();
});

it("preserves precise native companion position through mode changes and does not rebuild the same mode", async () => {
  const { controller, first } = setup();
  const native = { spineIndex: 0, node: first.body, offset: 0 };
  Object.assign(controller, {
    containerEl: document.createElement("main"),
    host: Object.create(PaginatedContentHost.prototype),
    viewMode: "paginated",
    nativeReading: { current: () => native, retainedForShell: () => native },
    locatorResolver: { generate: vi.fn(() => ({ cfi: "native-companion-cfi" })) },
    library: { patchGlobalReadingSettings: vi.fn(async () => {}) },
    refreshGlobalSettings: vi.fn(async () => {}),
    requestLayout: vi.fn((changes: object) => controller.applyLayout({
      configuration: { ...controller.currentLayout(), ...changes }, reflow: false,
    })),
    openSpineItem: vi.fn(async () => { controller.host = Object.create(ScrollContentHost.prototype); }),
    announce: vi.fn(),
    translate: (key: string) => key,
    notify: vi.fn(),
  });
  await controller.setViewMode("scroll");
  expect(controller.locatorResolver.generate).toHaveBeenCalledWith(0, first.body, 0);
  expect(controller.openSpineItem).toHaveBeenCalledExactlyOnceWith(0, {
    bridgeCfi: "native-companion-cfi", preserveFocus: false,
  });
  await controller.setViewMode("scroll");
  expect(controller.openSpineItem).toHaveBeenCalledTimes(1);
});
