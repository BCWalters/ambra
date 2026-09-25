import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BookMetadata, LibraryCoverBlobs, LibraryDatabase } from "./LibraryDatabase.js";
import { LibrarySession } from "./LibrarySession.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const book = { id: "book", title: "Book" } as BookMetadata;
const blob = new Blob(["cover"]);
const coverBlobs = { original: blob, card: blob };

function makeDatabase() {
  return {
    listBooks: vi.fn().mockResolvedValue([book]),
    getAllProgress: vi.fn().mockResolvedValue(new Map()),
    getLibraryCoverBlobs: vi.fn().mockResolvedValue(coverBlobs),
    close: vi.fn(),
  };
}

describe("LibrarySession", () => {
  beforeEach(() => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:cover");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("does not publish an older refresh after a newer deletion", async () => {
    const db = makeDatabase();
    const cover = deferred<LibraryCoverBlobs>();
    db.getLibraryCoverBlobs.mockReturnValueOnce(cover.promise);
    const session = new LibrarySession(db as unknown as LibraryDatabase);
    const old = session.refresh();
    await vi.waitFor(() => expect(db.getLibraryCoverBlobs).toHaveBeenCalledOnce());
    db.listBooks.mockResolvedValueOnce([]);
    expect(await session.refresh()).toEqual([]);
    cover.resolve(coverBlobs);
    expect(await old).toBeUndefined();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    session.dispose();
  });

  it("allocates only one cover for overlapping refreshes and reuses it", async () => {
    const db = makeDatabase();
    const oldCover = deferred<LibraryCoverBlobs>();
    db.getLibraryCoverBlobs.mockReturnValueOnce(oldCover.promise);
    const session = new LibrarySession(db as unknown as LibraryDatabase);
    const old = session.refresh();
    await vi.waitFor(() => expect(db.getLibraryCoverBlobs).toHaveBeenCalledOnce());
    expect((await session.refresh())?.[0]?.coverUrl).toBe("blob:cover");
    oldCover.resolve(coverBlobs);
    expect(await old).toBeUndefined();
    await session.refresh();
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    expect(db.getLibraryCoverBlobs).toHaveBeenCalledTimes(2);
    session.dispose();
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:cover");
  });

  it("closes once and never creates URLs when cover reads finish after disposal", async () => {
    const db = makeDatabase();
    const cover = deferred<LibraryCoverBlobs>();
    db.getLibraryCoverBlobs.mockReturnValue(cover.promise);
    const session = new LibrarySession(db as unknown as LibraryDatabase);
    const pending = session.refresh();
    await vi.waitFor(() => expect(db.getLibraryCoverBlobs).toHaveBeenCalledOnce());
    session.dispose();
    session.dispose();
    cover.resolve(coverBlobs);
    expect(await pending).toBeUndefined();
    expect(await session.refresh()).toBeUndefined();
    expect(db.close).toHaveBeenCalledOnce();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("revokes covers removed from the latest snapshot and retains surviving covers", async () => {
    const db = makeDatabase();
    const session = new LibrarySession(db as unknown as LibraryDatabase);
    await session.refresh();
    db.listBooks.mockResolvedValue([]);
    expect(await session.refresh()).toEqual([]);
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:cover");
    session.dispose();
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
  });

  it("does not allocate partial URLs when a cover read fails, and allows retry", async () => {
    const db = makeDatabase();
    db.listBooks.mockResolvedValue([book, { ...book, id: "other" }]);
    db.getLibraryCoverBlobs.mockRejectedValueOnce(new Error("Unreadable cover"));
    const session = new LibrarySession(db as unknown as LibraryDatabase);
    await expect(session.refresh()).rejects.toThrow("Unreadable cover");
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(await session.refresh()).toHaveLength(2);
    session.dispose();
  });

  it("ignores stale read failures rather than replacing the newer outcome", async () => {
    const db = makeDatabase();
    const oldRead = deferred<BookMetadata[]>();
    db.listBooks.mockReturnValueOnce(oldRead.promise);
    const session = new LibrarySession(db as unknown as LibraryDatabase);
    const old = session.refresh();
    await session.refresh();
    oldRead.reject(new Error("Obsolete read failed"));
    expect(await old).toBeUndefined();
    session.dispose();
  });

  it("uses separate URLs for thumbnails and originals and releases both on removal", async () => {
    const db = makeDatabase();
    const thumbnail = new Blob(["thumbnail"]);
    db.getLibraryCoverBlobs.mockResolvedValue({ original: blob, card: thumbnail });
    vi.mocked(URL.createObjectURL).mockReturnValueOnce("blob:original").mockReturnValueOnce("blob:thumbnail");
    const session = new LibrarySession(db as unknown as LibraryDatabase);
    expect((await session.refresh())?.[0]).toMatchObject({ coverUrl: "blob:original", cardCoverUrl: "blob:thumbnail" });
    expect(URL.createObjectURL).toHaveBeenNthCalledWith(1, blob);
    expect(URL.createObjectURL).toHaveBeenNthCalledWith(2, thumbnail);
    db.listBooks.mockResolvedValue([]);
    await session.refresh();
    session.dispose();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:original");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:thumbnail");
  });

  it("reads legacy covers sequentially and caches missing covers for the session", async () => {
    const db = makeDatabase();
    const first = deferred<LibraryCoverBlobs | undefined>();
    db.listBooks.mockResolvedValue([book, { ...book, id: "second" }]);
    db.getLibraryCoverBlobs.mockReturnValueOnce(first.promise).mockResolvedValueOnce(undefined);
    const session = new LibrarySession(db as unknown as LibraryDatabase);
    const refresh = session.refresh();
    await vi.waitFor(() => expect(db.getLibraryCoverBlobs).toHaveBeenCalledTimes(1));
    first.resolve(undefined);
    expect((await refresh)?.map(({ cardCoverUrl }) => cardCoverUrl)).toEqual([undefined, undefined]);
    await session.refresh();
    expect(db.getLibraryCoverBlobs).toHaveBeenCalledTimes(2);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    session.dispose();
  });
});
