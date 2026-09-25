import { expect, it, vi } from "vitest";
import { LibraryDatabase } from "./LibraryDatabase.js";

function database() {
  const records = new Map<string, unknown>();
  const db = Object.create(LibraryDatabase.prototype);
  db.get = vi.fn(async (_store: string, key: string) => records.get(key));
  db.put = vi.fn(async (_store: string, record: { key: string; value: unknown }) => records.set(record.key, record));
  return { db: db as LibraryDatabase, records, put: db.put };
}

it("acknowledges version one independently of all other preferences", async () => {
  const { db, records, put } = database();
  records.set("localePreference", { key: "localePreference", value: "fr" });
  records.set("readerKeyboardShortcuts", { key: "readerKeyboardShortcuts", value: { enabled: false } });
  expect(await db.getReadingWelcomeVersion()).toBe(0);
  await db.acknowledgeReadingWelcome();
  expect(put).toHaveBeenCalledExactlyOnceWith("preferences", { key: "readingWelcomeVersion", value: 1 });
  expect(await db.getReadingWelcomeVersion()).toBe(1);
  expect(await db.getLocalePreference()).toBe("fr");
  expect(await db.getShortcutPreferences()).toEqual({ enabled: false });
});

it.each([undefined, "1", null, {}, 0.5])("treats malformed version %s as unacknowledged", async value => {
  const { db, records } = database();
  records.set("readingWelcomeVersion", { key: "readingWelcomeVersion", value });
  expect(await db.getReadingWelcomeVersion()).toBe(0);
});
