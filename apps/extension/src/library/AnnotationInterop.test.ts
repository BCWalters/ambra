import { describe, expect, it, vi } from "vitest";
import {
  PackageDocument,
  Locator,
  type LocatorResolver,
  type ResolvedLocator,
} from "@ambra/engine";
import type { Bookmark, Highlight, LibraryDatabase } from "./LibraryDatabase.js";
import {
  buildAnnotationCollection,
  classifyImportOutcome,
  classifyReadOnlyAnnotationKind,
  importAnnotations,
} from "./AnnotationInterop.js";
import type { AnnotationImportResult } from "./AnnotationInterop.js";

/** A two-chapter package, built the same way `PackageDocument.test.ts`
 * builds its own synthetic fixtures — real enough to exercise
 * `findSpineIndexByPackageCfiSteps`/`findManifestItemByPath` without
 * needing an actual zipped `.epub` fixture file. */
function makePackage(): PackageDocument {
  const xml = `<?xml version="1.0"?>
    <package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:identifier id="pub-id">urn:uuid:test</dc:identifier>
        <dc:title>Test Book</dc:title>
        <dc:language>en</dc:language>
      </metadata>
      <manifest>
        <item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
        <item id="chapter2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>
      </manifest>
      <spine>
        <itemref idref="chapter1"/>
        <itemref idref="chapter2"/>
      </spine>
    </package>`;
  return PackageDocument.parse(xml, "OEBPS/content.opf");
}

function makeHighlight(overrides: Partial<Highlight> = {}): Highlight {
  return {
    id: "hl-1",
    bookId: "book-1",
    spineIndex: 0,
    startCfi: "epubcfi(/6/2!/4/2/1:0)",
    endCfi: "epubcfi(/6/2!/4/2/1:10)",
    style: "yellow",
    text: "Some text",
    note: undefined,
    createdAt: 1700000000000,
    ...overrides,
  };
}

function makeBookmark(overrides: Partial<Bookmark> = {}): Bookmark {
  return {
    id: "bm-1",
    bookId: "book-1",
    cfi: "epubcfi(/6/2!/4/2/1:0)",
    label: "Chapter 1, Page 3",
    createdAt: 1700000000000,
    ...overrides,
  };
}

describe("buildAnnotationCollection", () => {
  it("exports a highlight as a highlighting annotation with a joined range-CFI FragmentSelector", () => {
    const pkg = makePackage();
    const annotations = buildAnnotationCollection(pkg, {
      highlights: [makeHighlight()],
      bookmarks: [],
    });

    expect(annotations).toHaveLength(1);
    expect(annotations[0]?.motivation).toBe("highlighting");
    expect(annotations[0]?.target.source).toBe("OEBPS/chapter1.xhtml");
    expect(annotations[0]?.target.selector?.[0]).toEqual({
      type: "FragmentSelector",
      value: "epubcfi(/6/2!/4/2/1,:0,:10)",
      conformsTo: "https://www.w3.org/publishing/epub-cfi/",
    });
    expect(annotations[0]?.body).toBeUndefined();
  });

  it("exports a highlight with a note as a commenting annotation with a TextualBody", () => {
    const pkg = makePackage();
    const annotations = buildAnnotationCollection(pkg, {
      highlights: [makeHighlight({ note: "Interesting point" })],
      bookmarks: [],
    });

    expect(annotations[0]?.motivation).toBe("commenting");
    expect(annotations[0]?.body).toEqual({
      type: "TextualBody",
      format: "text/plain",
      value: "Interesting point",
    });
  });

  it("exports a bookmark as a bookmarking annotation, resolving its spine item from the CFI", () => {
    const pkg = makePackage();
    // Package steps /6/4 point at the second spine item (chapter2).
    const annotations = buildAnnotationCollection(pkg, {
      highlights: [],
      bookmarks: [makeBookmark({ cfi: "epubcfi(/6/4!/4/2/1:0)" })],
    });

    expect(annotations).toHaveLength(1);
    expect(annotations[0]?.motivation).toBe("bookmarking");
    expect(annotations[0]?.target.source).toBe("OEBPS/chapter2.xhtml");
    expect(annotations[0]?.body?.value).toBe("Chapter 1, Page 3");
  });

  it("skips a highlight whose CFI fails to parse rather than throwing", () => {
    const pkg = makePackage();
    const annotations = buildAnnotationCollection(pkg, {
      highlights: [makeHighlight({ startCfi: "not-a-cfi" })],
      bookmarks: [],
    });

    expect(annotations).toHaveLength(0);
  });
});

describe("importAnnotations", () => {
  function makeResolver(text = "Imported text"): LocatorResolver {
    const doc = { createRange: () => fakeRange(text) } as unknown as Document;
    return {
      resolvePair: vi
        .fn()
        .mockImplementation(
          async (
            startLocator: Locator,
            endLocator: Locator,
          ): Promise<{ start: ResolvedLocator; end: ResolvedLocator; document: Document }> => {
            const node = { ownerDocument: doc } as unknown as Node;
            return {
              start: { spineIndex: 0, node, characterOffset: startLocator.cfi.includes(":0") ? 0 : 10 },
              end: { spineIndex: 0, node, characterOffset: endLocator.cfi.includes(":0") ? 0 : 10 },
              document: doc,
            };
          },
        ),
    } as unknown as LocatorResolver;
  }

  function fakeRange(text: string): Range {
    return {
      setStart: vi.fn(),
      setStartBefore: vi.fn(),
      setEnd: vi.fn(),
      setEndAfter: vi.fn(),
      toString: () => text,
    } as unknown as Range;
  }

  function makeLibrary(
    seed: { highlights?: Highlight[]; bookmarks?: Bookmark[] } = {},
  ): {
    library: LibraryDatabase;
    addedHighlights: unknown[];
    addedBookmarks: unknown[];
  } {
    const addedHighlights: unknown[] = [];
    const addedBookmarks: unknown[] = [];
    const library = {
      listHighlightsForBook: vi.fn().mockResolvedValue(seed.highlights ?? []),
      listBookmarksForBook: vi.fn().mockResolvedValue(seed.bookmarks ?? []),
      addHighlight: vi.fn().mockImplementation(async (input: unknown) => {
        addedHighlights.push(input);
        return { ...(input as object), id: "new-hl", createdAt: 0 };
      }),
      addBookmark: vi
        .fn()
        .mockImplementation(async (bookId: string, cfi: string, label: string) => {
          addedBookmarks.push({ bookId, cfi, label });
          return { id: "new-bm", bookId, cfi, label, createdAt: 0 };
        }),
    } as unknown as LibraryDatabase;
    return { library, addedHighlights, addedBookmarks };
  }

  function makeHighlight(overrides: Partial<Highlight> = {}): Highlight {
    return {
      id: "existing-hl",
      bookId: "book-1",
      spineIndex: 0,
      startCfi: "epubcfi(/6/2!/4/2/1:0)",
      endCfi: "epubcfi(/6/2!/4/2/1:10)",
      style: "yellow",
      text: "The recovered text",
      note: undefined,
      createdAt: 0,
      ...overrides,
    };
  }

  it("imports a highlighting annotation with a range FragmentSelector as a Highlight", async () => {
    const pkg = makePackage();
    const resolver = makeResolver("The recovered text");
    const { library, addedHighlights } = makeLibrary();

    const result = await importAnnotations(pkg, resolver, library, "book-1", [
      {
        id: "urn:uuid:1",
        type: "Annotation",
        motivation: "highlighting",
        created: "2024-01-01T00:00:00.000Z",
        target: {
          source: "OEBPS/chapter1.xhtml",
          selector: [{ type: "FragmentSelector", value: "epubcfi(/6/2!/4/2/1,:0,:10)" }],
        },
      },
    ]);

    expect(result).toEqual({
      importedHighlights: 1,
      importedBookmarks: 0,
      duplicateHighlights: 0,
      duplicateBookmarks: 0,
      skipped: 0,
    });
    expect(addedHighlights).toEqual([
      {
        bookId: "book-1",
        spineIndex: 0,
        startCfi: "epubcfi(/6/2!/4/2/1:0)",
        endCfi: "epubcfi(/6/2!/4/2/1:10)",
        style: "yellow",
        text: "The recovered text",
        note: undefined,
      },
    ]);
  });

  it("imports a bookmarking annotation with a point FragmentSelector as a Bookmark", async () => {
    const pkg = makePackage();
    const resolver = makeResolver();
    const { library, addedBookmarks } = makeLibrary();

    const result = await importAnnotations(pkg, resolver, library, "book-1", [
      {
        id: "urn:uuid:2",
        type: "Annotation",
        motivation: "bookmarking",
        created: "2024-01-01T00:00:00.000Z",
        target: {
          source: "OEBPS/chapter2.xhtml",
          selector: [{ type: "FragmentSelector", value: "epubcfi(/6/4!/4/2/1:0)" }],
        },
        body: { type: "TextualBody", value: "My bookmark" },
      },
    ]);

    expect(result).toEqual({
      importedHighlights: 0,
      importedBookmarks: 1,
      duplicateHighlights: 0,
      duplicateBookmarks: 0,
      skipped: 0,
    });
    expect(addedBookmarks).toEqual([
      { bookId: "book-1", cfi: "epubcfi(/6/4!/4/2/1:0)", label: "My bookmark" },
    ]);
  });

  it("skips an annotation with no FragmentSelector (only a CssSelector) rather than importing it", async () => {
    const pkg = makePackage();
    const { library } = makeLibrary();

    const result = await importAnnotations(pkg, makeResolver(), library, "book-1", [
      {
        id: "urn:uuid:3",
        type: "Annotation",
        created: "2024-01-01T00:00:00.000Z",
        target: {
          source: "OEBPS/chapter1.xhtml",
          selector: [{ type: "CssSelector", value: "#p1" }],
        },
      },
    ]);

    expect(result).toEqual({
      importedHighlights: 0,
      importedBookmarks: 0,
      duplicateHighlights: 0,
      duplicateBookmarks: 0,
      skipped: 1,
    });
  });

  it("skips an annotation whose source doesn't match any spine item and whose CFI doesn't resolve either", async () => {
    const pkg = makePackage();
    const { library } = makeLibrary();

    const result = await importAnnotations(pkg, makeResolver(), library, "book-1", [
      {
        id: "urn:uuid:4",
        type: "Annotation",
        created: "2024-01-01T00:00:00.000Z",
        target: {
          source: "unknown-chapter.xhtml",
          selector: [{ type: "FragmentSelector", value: "epubcfi(/6/99!/4/2/1:0)" }],
        },
      },
    ]);

    expect(result).toEqual({
      importedHighlights: 0,
      importedBookmarks: 0,
      duplicateHighlights: 0,
      duplicateBookmarks: 0,
      skipped: 1,
    });
  });

  it("falls back to the CFI's own package-steps when the source href doesn't match", async () => {
    const pkg = makePackage();
    const resolver = makeResolver();
    const { library, addedBookmarks } = makeLibrary();

    // Source doesn't match any manifest path in this package, but the
    // CFI's package-steps (/6/4) still correctly resolve to chapter2.
    const result = await importAnnotations(pkg, resolver, library, "book-1", [
      {
        id: "urn:uuid:5",
        type: "Annotation",
        created: "2024-01-01T00:00:00.000Z",
        target: {
          source: "some-other-books-chapter.xhtml",
          selector: [{ type: "FragmentSelector", value: "epubcfi(/6/4!/4/2/1:0)" }],
        },
      },
    ]);

    expect(result).toEqual({
      importedHighlights: 0,
      importedBookmarks: 1,
      duplicateHighlights: 0,
      duplicateBookmarks: 0,
      skipped: 0,
    });
    expect(addedBookmarks).toEqual([
      { bookId: "book-1", cfi: "epubcfi(/6/4!/4/2/1:0)", label: "" },
    ]);
  });

  it("dedupes a highlight that's an exact CFI re-import of one already in the book, without re-extracting its text", async () => {
    const pkg = makePackage();
    const resolver = makeResolver("should not be used");
    const { library, addedHighlights } = makeLibrary({ highlights: [makeHighlight()] });

    const result = await importAnnotations(pkg, resolver, library, "book-1", [
      {
        id: "urn:uuid:6",
        type: "Annotation",
        motivation: "highlighting",
        created: "2024-01-01T00:00:00.000Z",
        target: {
          source: "OEBPS/chapter1.xhtml",
          selector: [{ type: "FragmentSelector", value: "epubcfi(/6/2!/4/2/1,:0,:10)" }],
        },
      },
    ]);

    expect(result).toEqual({
      importedHighlights: 0,
      importedBookmarks: 0,
      duplicateHighlights: 1,
      duplicateBookmarks: 0,
      skipped: 0,
    });
    expect(addedHighlights).toEqual([]);
    expect(resolver.resolvePair).not.toHaveBeenCalled(); // never needed the text
  });

  it("dedupes a highlight with a different CFI encoding but the same text and note (\"almost identical\")", async () => {
    const pkg = makePackage();
    const resolver = makeResolver("The recovered text"); // same text, different CFI below
    const { library, addedHighlights } = makeLibrary({
      highlights: [makeHighlight({ startCfi: "epubcfi(/6/2!/4/2/1:0)", endCfi: "epubcfi(/6/2!/4/2/1:11)" })],
    });

    const result = await importAnnotations(pkg, resolver, library, "book-1", [
      {
        id: "urn:uuid:7",
        type: "Annotation",
        motivation: "highlighting",
        created: "2024-01-01T00:00:00.000Z",
        target: {
          source: "OEBPS/chapter1.xhtml",
          selector: [{ type: "FragmentSelector", value: "epubcfi(/6/2!/4/2/1,:0,:10)" }],
        },
      },
    ]);

    expect(result.duplicateHighlights).toBe(1);
    expect(result.importedHighlights).toBe(0);
    expect(addedHighlights).toEqual([]);
  });

  it("does not dedupe two highlights of the same text with different notes — a differing note is meaningful", async () => {
    const pkg = makePackage();
    const resolver = makeResolver("The recovered text");
    const { library, addedHighlights } = makeLibrary({
      highlights: [
        makeHighlight({
          startCfi: "epubcfi(/6/2!/4/2/1:0)",
          endCfi: "epubcfi(/6/2!/4/2/1:11)", // deliberately not an exact CFI match
          note: "My original note",
        }),
      ],
    });

    const result = await importAnnotations(pkg, resolver, library, "book-1", [
      {
        id: "urn:uuid:8",
        type: "Annotation",
        motivation: "commenting",
        created: "2024-01-01T00:00:00.000Z",
        target: {
          source: "OEBPS/chapter1.xhtml",
          selector: [{ type: "FragmentSelector", value: "epubcfi(/6/2!/4/2/1,:0,:10)" }],
        },
        body: { type: "TextualBody", value: "A different note" },
      },
    ]);

    expect(result.duplicateHighlights).toBe(0);
    expect(result.importedHighlights).toBe(1);
    expect(addedHighlights).toHaveLength(1);
  });

  it("dedupes two identical highlights within the same imported file, not just against what's already saved", async () => {
    const pkg = makePackage();
    const resolver = makeResolver("The recovered text");
    const { library, addedHighlights } = makeLibrary();
    const sameAnnotation = {
      id: "urn:uuid:9",
      type: "Annotation" as const,
      motivation: "highlighting" as const,
      created: "2024-01-01T00:00:00.000Z",
      target: {
        source: "OEBPS/chapter1.xhtml",
        selector: [{ type: "FragmentSelector" as const, value: "epubcfi(/6/2!/4/2/1,:0,:10)" }],
      },
    };

    const result = await importAnnotations(pkg, resolver, library, "book-1", [
      sameAnnotation,
      sameAnnotation,
    ]);

    expect(result.importedHighlights).toBe(1);
    expect(result.duplicateHighlights).toBe(1);
    expect(addedHighlights).toHaveLength(1);
  });

  it("dedupes a bookmark that's an exact CFI re-import of one already in the book", async () => {
    const pkg = makePackage();
    const resolver = makeResolver();
    const { library, addedBookmarks } = makeLibrary({
      bookmarks: [{ id: "existing-bm", bookId: "book-1", cfi: "epubcfi(/6/4!/4/2/1:0)", label: "", createdAt: 0 }],
    });

    const result = await importAnnotations(pkg, resolver, library, "book-1", [
      {
        id: "urn:uuid:10",
        type: "Annotation",
        motivation: "bookmarking",
        created: "2024-01-01T00:00:00.000Z",
        target: {
          source: "OEBPS/chapter2.xhtml",
          selector: [{ type: "FragmentSelector", value: "epubcfi(/6/4!/4/2/1:0)" }],
        },
      },
    ]);

    expect(result).toEqual({
      importedHighlights: 0,
      importedBookmarks: 0,
      duplicateHighlights: 0,
      duplicateBookmarks: 1,
      skipped: 0,
    });
    expect(addedBookmarks).toEqual([]);
  });
});

describe("classifyReadOnlyAnnotationKind", () => {
  it("classifies an explicit \"bookmarking\" motivation as a bookmark, even if the selector happens to be a range", () => {
    expect(classifyReadOnlyAnnotationKind("bookmarking", true)).toBe("bookmark");
  });

  it("classifies an explicit \"highlighting\" motivation as a highlight, even if the selector happens to be a point", () => {
    expect(classifyReadOnlyAnnotationKind("highlighting", false)).toBe("highlight");
  });

  it("classifies an explicit \"commenting\" motivation as a highlight (a highlight that also carries a note)", () => {
    expect(classifyReadOnlyAnnotationKind("commenting", false)).toBe("highlight");
  });

  it("falls back to a range selector meaning a highlight when motivation is absent", () => {
    expect(classifyReadOnlyAnnotationKind(undefined, true)).toBe("highlight");
  });

  it("falls back to a point selector meaning a bookmark when motivation is absent", () => {
    expect(classifyReadOnlyAnnotationKind(undefined, false)).toBe("bookmark");
  });
});

describe("classifyImportOutcome", () => {
  function makeResult(overrides: Partial<AnnotationImportResult>): AnnotationImportResult {
    return {
      importedHighlights: 0,
      importedBookmarks: 0,
      duplicateHighlights: 0,
      duplicateBookmarks: 0,
      skipped: 0,
      ...overrides,
    };
  }

  it("is \"imported\" whenever anything new was actually added, regardless of duplicates/skips alongside it", () => {
    expect(classifyImportOutcome(makeResult({ importedHighlights: 1 }))).toBe("imported");
    expect(classifyImportOutcome(makeResult({ importedBookmarks: 1 }))).toBe("imported");
    expect(
      classifyImportOutcome(makeResult({ importedHighlights: 1, duplicateBookmarks: 3, skipped: 2 })),
    ).toBe("imported");
  });

  it("is \"allDuplicates\" when nothing new was added but at least one entry was a known duplicate (issue #115)", () => {
    expect(classifyImportOutcome(makeResult({ duplicateHighlights: 1 }))).toBe("allDuplicates");
    expect(classifyImportOutcome(makeResult({ duplicateBookmarks: 2 }))).toBe("allDuplicates");
  });

  it("is \"wrongBook\" when nothing new was added and nothing was even a recognized duplicate (issue #114)", () => {
    expect(classifyImportOutcome(makeResult({ skipped: 3 }))).toBe("wrongBook");
    // A literally empty file lands in the same bucket — rare enough not
    // to need its own distinct message (see `ImportOutcome`'s doc
    // comment).
    expect(classifyImportOutcome(makeResult({}))).toBe("wrongBook");
  });
});
