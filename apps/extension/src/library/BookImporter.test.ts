import { beforeEach, describe, expect, it, vi } from "vitest";
import { ContentLoader, EpubContainer } from "@ambra/engine";
import { importBook } from "./BookImporter.js";
import type { LibraryDatabase } from "./LibraryDatabase.js";

vi.mock("@ambra/engine", () => ({
  EpubContainer: { open: vi.fn() },
  ContentLoader: { create: vi.fn() },
}));

describe("book import stages", () => {
  beforeEach(() => vi.resetAllMocks());

  it("reports processing through metadata/cover extraction, then saving until persistence resolves", async () => {
    let resolveCover!: (bytes: Uint8Array) => void;
    let resolveSave!: (id: string) => void;
    const cover = new Promise<Uint8Array>((resolve) => { resolveCover = resolve; });
    const saved = new Promise<string>((resolve) => { resolveSave = resolve; });
    const loadResourceBytes = vi.fn().mockReturnValue(cover);
    vi.mocked(ContentLoader.create).mockResolvedValue({ loadResourceBytes } as unknown as ContentLoader);
    vi.mocked(EpubContainer.open).mockResolvedValue({
      getPackageDocument: vi.fn().mockResolvedValue({
        metadata: { title: "Narrated book" },
        manifest: [{ hasProperty: () => true, path: "cover.png", mediaType: "image/png" }],
      }),
    } as unknown as EpubContainer);
    const addBook = vi.fn().mockReturnValue(saved);
    const phases = vi.fn();
    const file = { name: "narrated.epub", arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)) } as unknown as File;
    const result = importBook({ addBook } as unknown as LibraryDatabase, file, phases);
    expect(phases).toHaveBeenCalledExactlyOnceWith("processing");
    await vi.waitFor(() => expect(loadResourceBytes).toHaveBeenCalledWith("cover.png"));
    expect(addBook).not.toHaveBeenCalled();
    resolveCover(new Uint8Array([1, 2]));
    await vi.waitFor(() => expect(addBook).toHaveBeenCalledOnce());
    expect(phases.mock.calls).toEqual([["processing"], ["saving"]]);
    let finished = false;
    void result.then(() => { finished = true; });
    await Promise.resolve();
    expect(finished).toBe(false);
    resolveSave("saved-book");
    await expect(result).resolves.toBe("saved-book");
  });

  it("propagates parsing and persistence failures rather than reporting completion", async () => {
    const phases = vi.fn();
    const file = { arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)) } as unknown as File;
    const addBook = vi.fn().mockRejectedValue(new DOMException("Full", "QuotaExceededError"));
    vi.mocked(EpubContainer.open).mockRejectedValueOnce(new Error("Invalid EPUB"));
    await expect(importBook({ addBook } as unknown as LibraryDatabase, file, phases)).rejects.toThrow("Invalid EPUB");
    expect(addBook).not.toHaveBeenCalled();
    expect(phases.mock.calls).toEqual([["processing"]]);
    vi.mocked(EpubContainer.open).mockResolvedValue({
      getPackageDocument: vi.fn().mockResolvedValue({ metadata: {}, manifest: [] }),
    } as unknown as EpubContainer);
    phases.mockClear();
    await expect(importBook({ addBook } as unknown as LibraryDatabase, file, phases)).rejects.toThrow("Full");
    expect(phases.mock.calls).toEqual([["processing"], ["saving"]]);
  });
});
