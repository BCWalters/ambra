import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LibraryDatabase } from "./LibraryDatabase.js";
import { createLibraryCover } from "./LibraryCover.js";

vi.mock("./LibraryCover.js", () => ({ createLibraryCover: vi.fn() }));

const original = new Blob(["original"]);
const thumbnail = new Blob(["thumbnail"]);
const record = { id: "book", blob: original };

function database() {
  const db = Object.create(LibraryDatabase.prototype);
  const get = vi.fn().mockResolvedValue(record);
  db.get = get;
  db.transaction = vi.fn().mockRejectedValue(new DOMException("Cache quota exceeded", "QuotaExceededError"));
  return { db: db as LibraryDatabase, get };
}

beforeEach(() => {
  vi.mocked(createLibraryCover).mockResolvedValue(thumbnail);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

it("uses transient thumbnails after a cache failure and warns without claiming persistence", async () => {
  const { db, get } = database();
  expect(await db.getLibraryCoverBlobs("book")).toEqual({ original, card: thumbnail });
  expect(get).toHaveBeenCalledTimes(2);
  expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("temporary cover"), expect.objectContaining({ name: "QuotaExceededError" }));
});

it("does not revive a cover deleted before the post-rollback reread", async () => {
  const { db, get } = database();
  get.mockResolvedValueOnce(record).mockResolvedValueOnce(undefined);
  expect(await db.getLibraryCoverBlobs("book")).toBeUndefined();
});

it("retains a cover another connection successfully cached while this write failed", async () => {
  const { db, get } = database();
  const cached = new Blob(["other cached cover"]);
  get.mockResolvedValueOnce(record).mockResolvedValueOnce({ ...record, libraryCoverV1: cached });
  expect(await db.getLibraryCoverBlobs("book")).toEqual({ original, card: cached });
});

it("still propagates genuine read failures after the optional write fails", async () => {
  const { db, get } = database();
  get.mockResolvedValueOnce(record).mockRejectedValueOnce(new Error("Cover storage unreadable"));
  await expect(db.getLibraryCoverBlobs("book")).rejects.toThrow("Cover storage unreadable");
});
