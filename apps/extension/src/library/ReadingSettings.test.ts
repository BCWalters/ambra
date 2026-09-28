import { expect, it, vi } from "vitest";
import { LibraryDatabase } from "./LibraryDatabase.js";
import { DEFAULT_BOOK_READING_SETTINGS, DEFAULT_GLOBAL_READING_SETTINGS } from "./ReadingSettings.js";
import type { ProgressMarkerStyle } from "../reader/ProgressMarkerStyle.js";

it("defaults to automatic spreads and an app-wide white page theme", async () => {
  const database = Object.create(LibraryDatabase.prototype);
  database.get = vi.fn(async () => undefined);
  database.getAll = vi.fn(async () => []);
  expect(await database.getBookReadingSettings("new")).toEqual(DEFAULT_BOOK_READING_SETTINGS);
  expect(DEFAULT_BOOK_READING_SETTINGS.alwaysShowOnePage).toBe(false);
  expect(await database.getGlobalReadingSettings()).toEqual(DEFAULT_GLOBAL_READING_SETTINGS);
  expect(DEFAULT_GLOBAL_READING_SETTINGS.pageTheme).toBe("white");
  expect(DEFAULT_GLOBAL_READING_SETTINGS.progressMarkerStyle).toBe("upcoming");
});

it.each(["off", "ticks", "sections", "minimal", "upcoming"] as const)("loads or migrates global progress marker style %s", async style => {
  const database = Object.create(LibraryDatabase.prototype);
  database.getAll = vi.fn(async () => [{ key: "defaultProgressMarkerStyle", value: style }]);
  expect((await database.getGlobalReadingSettings()).progressMarkerStyle).toBe(style === "off" ? "off" : "upcoming");
});

it.each([undefined, null, "", "unknown", "TICKS", "UPCOMING", "upcoming ", 1, {}, ["ticks"], ["upcoming"]])(
  "defaults to Show for a missing or invalid persisted progress marker style %j",
  async value => {
    const database = Object.create(LibraryDatabase.prototype);
    database.getAll = vi.fn(async () => [{ key: "defaultProgressMarkerStyle", value }]);
    expect((await database.getGlobalReadingSettings()).progressMarkerStyle).toBe("upcoming");
  },
);

it.each(["off", "ticks", "sections", "minimal", "upcoming", "unknown"])(
  "atomically persists and broadcasts only the global marker setting %s",
  async value => {
    const database = Object.create(LibraryDatabase.prototype);
    const put = vi.fn();
    database.transaction = vi.fn(async (_stores, _mode, _error, write) => {
      write({ objectStore: () => ({ put }) });
    });
    database.preferencesChanged = vi.fn();
    await database.patchGlobalReadingSettings({ progressMarkerStyle: value as ProgressMarkerStyle });
    expect(put).toHaveBeenCalledExactlyOnceWith({
      key: "defaultProgressMarkerStyle", value: value === "off" ? "off" : "upcoming",
    });
    expect(database.preferencesChanged).toHaveBeenCalledOnce();
  },
);

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
