import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BookMetadata, LibraryDatabase } from "./LibraryDatabase.js";
import { LibrarySession } from "./LibrarySession.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const book = { id: "book", title: "Book" } as BookMetadata;

function makeDatabase() {
  return {
    listBooks: vi.fn().mockResolvedValue([book]),
    getAllProgress: vi.fn().mockResolvedValue(new Map()),
    getCoverBlob: vi.fn().mockResolvedValue(new Blob(["cover"])),
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
    const cover = deferred<Blob>();
    db.getCoverBlob.mockReturnValueOnce(cover.promise);
    const session = new LibrarySession(db as unknown as LibraryDatabase);
    const old = session.refresh();
    await vi.waitFor(() => expect(db.getCoverBlob).toHaveBeenCalledOnce());
    db.listBooks.mockResolvedValueOnce([]);
    expect(await session.refresh()).toEqual([]);
    cover.resolve(new Blob(["late cover"]));
    expect(await old).toBeUndefined();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    session.dispose();
  });

  it("allocates only one cover for overlapping refreshes and reuses it", async () => {
    const db = makeDatabase();
    const oldCover = deferred<Blob>();
    db.getCoverBlob.mockReturnValueOnce(oldCover.promise);
    const session = new LibrarySession(db as unknown as LibraryDatabase);
    const old = session.refresh();
    await vi.waitFor(() => expect(db.getCoverBlob).toHaveBeenCalledOnce());
    expect((await session.refresh())?.[0]?.coverUrl).toBe("blob:cover");
    oldCover.resolve(new Blob(["older"]));
    expect(await old).toBeUndefined();
    await session.refresh();
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    expect(db.getCoverBlob).toHaveBeenCalledTimes(2);
    session.dispose();
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:cover");
  });

  it("closes once and never creates URLs when cover reads finish after disposal", async () => {
    const db = makeDatabase();
    const cover = deferred<Blob>();
    db.getCoverBlob.mockReturnValue(cover.promise);
    const session = new LibrarySession(db as unknown as LibraryDatabase);
    const pending = session.refresh();
    await vi.waitFor(() => expect(db.getCoverBlob).toHaveBeenCalledOnce());
    session.dispose();
    session.dispose();
    cover.resolve(new Blob(["late"]));
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
    db.getCoverBlob.mockRejectedValueOnce(new Error("Unreadable cover"));
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
});
