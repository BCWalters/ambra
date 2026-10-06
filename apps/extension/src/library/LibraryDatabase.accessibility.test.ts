import { strToU8, zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";
import { LibraryDatabase, type BookMetadata } from "./LibraryDatabase.js";

function storedBook(): BookMetadata {
  return {
    id: "original",
    title: "Retained title",
    identifier: "urn:ambra:accessibility",
    addedAt: 1,
    creator: undefined,
    fileName: "original.epub",
    fetchedDescription: undefined,
    fetchedDescriptionSourceName: undefined,
    fetchedDescriptionSourceUrl: undefined,
    descriptionFetchAttempts: undefined,
    description: undefined,
    publisher: undefined,
    rights: undefined,
    identifiers: undefined,
    accessibility: undefined,
  };
}
function originalPublication(): Blob {
  const bytes = zipSync(
    {
      mimetype: strToU8("application/epub+zip"),
      "META-INF/container.xml":
        strToU8(`<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles>
      <rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`),
      "EPUB/package.opf":
        strToU8(`<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:ambra:accessibility</dc:identifier>
      <dc:title>Original source title</dc:title><dc:language>en</dc:language>
      <meta property="a11y:certifiedBy">Original publisher</meta></metadata><manifest/><spine/></package>`),
    },
    { level: 0 },
  );
  return new Blob([Uint8Array.from(bytes).buffer]);
}
function database() {
  const db: LibraryDatabase = Object.create(LibraryDatabase.prototype);
  let current: BookMetadata | undefined = storedBook();
  const record = vi.spyOn(db, "getBookMetadata").mockImplementation(async () => current);
  const file = vi.spyOn(db, "getBookFile").mockResolvedValue(originalPublication());
  const changed = vi.fn();
  const update = vi.fn(async (_id: string, transform: (book: BookMetadata) => BookMetadata) => {
    if (current) current = transform(current);
  });
  Reflect.set(db, "booksChanged", changed);
  Reflect.set(db, "updateBookMetadata", update);
  return {
    db,
    record,
    file,
    changed,
    update,
    read: () => current,
    set: (value: BookMetadata | undefined) => {
      current = value;
    },
  };
}

describe("lazy accessibility metadata refresh", () => {
  it("backfills old records from local source bytes without changing identity or enrichment", async () => {
    const state = database();
    state.set({ ...storedBook(), fetchedDescription: "Concurrent enrichment" });
    await state.db.refreshAccessibilityMetadata("original");
    expect(state.read()).toMatchObject({
      id: "original",
      title: "Retained title",
      fetchedDescription: "Concurrent enrichment",
      accessibility: { certifiedBy: ["Original publisher"] },
    });
    expect(state.read()?.metadataLocalization?.metaValues[0]?.key).toBe("a11y:certifiedBy");
    expect(state.changed).toHaveBeenCalledOnce();
  });
  it("does not reparse assessed empty metadata", async () => {
    const state = database();
    state.set({
      ...storedBook(),
      accessibility: {
        accessModes: [],
        accessibilityFeatures: [],
        accessibilityHazards: [],
        accessibilitySummary: undefined,
        declarations: [],
      },
    });
    await state.db.refreshAccessibilityMetadata("original");
    expect(state.file).not.toHaveBeenCalled();
    expect(state.changed).not.toHaveBeenCalled();
  });
  it("propagates missing records and files explicitly", async () => {
    const state = database();
    state.set(undefined);
    await expect(state.db.refreshAccessibilityMetadata("original")).rejects.toThrow(
      "library record is missing",
    );
    state.set(storedBook());
    state.file.mockResolvedValue(undefined);
    await expect(state.db.refreshAccessibilityMetadata("original")).rejects.toThrow(
      "stored EPUB file is missing",
    );
    expect(state.update).not.toHaveBeenCalled();
  });
  it("propagates corrupt publication errors instead of persisting empty claims", async () => {
    const state = database();
    state.file.mockResolvedValue(new Blob(["not a ZIP archive"]));
    await expect(state.db.refreshAccessibilityMetadata("original")).rejects.toThrow();
    expect(state.read()?.accessibility).toBeUndefined();
    expect(state.update).not.toHaveBeenCalled();
  });
  it("does not resurrect a book deleted while its source is being read", async () => {
    const state = database();
    state.file.mockImplementation(async () => {
      state.set(undefined);
      return originalPublication();
    });
    await state.db.refreshAccessibilityMetadata("original");
    expect(state.read()).toBeUndefined();
  });
  it("does not overwrite a more recent accessibility backfill", async () => {
    const state = database();
    const current = {
      ...storedBook(),
      accessibility: {
        accessModes: [],
        accessibilityFeatures: [],
        accessibilityHazards: [],
        accessibilitySummary: "Newer claims",
        declarations: [],
      },
    };
    state.file.mockImplementation(async () => {
      state.set(current);
      return originalPublication();
    });
    await state.db.refreshAccessibilityMetadata("original");
    expect(state.read()).toBe(current);
  });
});
