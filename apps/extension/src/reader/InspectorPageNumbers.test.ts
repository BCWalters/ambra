import { expect, it, vi } from "vitest";
import { Page, type ContentDocumentView } from "@ambra/engine";
import { ReaderController } from "./ReaderController.js";
import type { InspectorReaderBridge } from "./ReaderTypes.js";

it("notifies Inspector when footer numbers change without changing the visible pages", () => {
  const document = new DOMParser().parseFromString("<html><body><p>Text</p></body></html>", "text/html");
  const page = new Page(0, { node: document.body, offset: 0 }, { node: document.body, offset: 1 }, 0, 100);
  const views: ContentDocumentView[] = [{ document, spineIndex: 0, physicalSide: "single", page }];
  const bridge: InspectorReaderBridge = {
    currentPath: "chapter.xhtml",
    locateCurrentPassage: vi.fn(),
    canShowInBook: () => true,
    showInBook: vi.fn(),
  };
  let pageNumber: number | undefined;
  let notify: (() => void) | undefined;
  const unsubscribe = vi.fn();
  const controller = Object.create(ReaderController.prototype) as ReaderController;
  Object.assign(controller, {
    inspectionReading: { create: () => bridge },
    contentDocumentViews: () => views,
    bookWidePagePosition: () => ({ bookPageIndex: pageNumber }),
    subscribe: (listener: () => void) => { notify = listener; return unsubscribe; },
  });
  const changed = vi.fn();
  const stop = controller.getInspectorReaderBridge().subscribeVisiblePages!(changed);
  notify!();
  expect(changed).not.toHaveBeenCalled();
  pageNumber = 35;
  notify!();
  expect(changed).toHaveBeenCalledOnce();
  notify!();
  expect(changed).toHaveBeenCalledOnce();
  pageNumber = 36;
  notify!();
  expect(changed).toHaveBeenCalledTimes(2);
  stop();
  expect(unsubscribe).toHaveBeenCalledOnce();
});
