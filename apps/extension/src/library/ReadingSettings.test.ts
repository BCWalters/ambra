import { expect, it, vi } from "vitest";
import { LibraryDatabase } from "./LibraryDatabase.js";
import { DEFAULT_BOOK_READING_SETTINGS, DEFAULT_GLOBAL_READING_SETTINGS } from "./ReadingSettings.js";

it("defaults to automatic spreads and an app-wide white page theme", async () => {
  const database = Object.create(LibraryDatabase.prototype);
  database.get = vi.fn(async () => undefined);
  database.getAll = vi.fn(async () => []);
  expect(await database.getBookReadingSettings("new")).toEqual(DEFAULT_BOOK_READING_SETTINGS);
  expect(DEFAULT_BOOK_READING_SETTINGS.alwaysShowOnePage).toBe(false);
  expect(await database.getGlobalReadingSettings()).toEqual(DEFAULT_GLOBAL_READING_SETTINGS);
  expect(DEFAULT_GLOBAL_READING_SETTINGS.pageTheme).toBe("white");
});

it("ignores old book themes without losing saved typography or adopting unknown fields", async () => {
  const database = Object.create(LibraryDatabase.prototype);
  database.get = vi.fn(async () => ({
    bookId: "legacy", settings: { fontScale: 1.25, pageTheme: "dark", unknown: true },
  }));
  expect(await database.getBookReadingSettings("legacy")).toEqual({
    ...DEFAULT_BOOK_READING_SETTINGS, fontScale: 1.25,
  });
});

it("reads the existing global theme key and persists the one-page book option", async () => {
  const database = Object.create(LibraryDatabase.prototype);
  database.getAll = vi.fn(async () => [{ key: "defaultPageTheme", value: "sepia" }]);
  database.get = vi.fn(async () => ({ settings: { alwaysShowOnePage: true } }));
  expect(await database.getGlobalReadingSettings()).toEqual({
    ...DEFAULT_GLOBAL_READING_SETTINGS, pageTheme: "sepia",
  });
  expect(await database.getBookReadingSettings("book")).toEqual({
    ...DEFAULT_BOOK_READING_SETTINGS, alwaysShowOnePage: true,
  });
});
