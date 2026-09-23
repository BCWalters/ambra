// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { FixedContentHost, PaginatedContentHost, ScrollContentHost } from "@ambra/engine";
import { readerDocumentViews } from "./ReaderDocuments.js";

describe("readerDocumentViews", () => {
  it("has no documents before a host exists", () => {
    expect(readerDocumentViews(undefined, 9)).toEqual([]);
  });

  it.each([FixedContentHost, PaginatedContentHost, ScrollContentHost])(
    "associates a single %s document with its explicit current spine item",
    Host => {
      const host = new Host(800, 900);
      const doc = document.implementation.createHTMLDocument();
      Object.defineProperty(host.element, "contentDocument", { configurable: true, value: doc });
      expect(readerDocumentViews(host, 9)).toEqual([
        { document: doc, spineIndex: 9, physicalSide: "single", page: undefined },
      ]);
      Object.defineProperty(host.element, "contentDocument", { value: null });
      expect(readerDocumentViews(host, 9)).toEqual([]);
      host.dispose();
    },
  );
});
