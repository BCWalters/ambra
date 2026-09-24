import { expect, it, vi } from "vitest";
import { LibraryDatabase } from "./LibraryDatabase.js";
import type { ShortcutPreferences } from "../shortcuts/ReaderCommands.js";

function database() {
  const records = new Map<string, unknown>();
  const db = Object.create(LibraryDatabase.prototype);
  db.get = vi.fn(async (_store: string, key: string) => records.get(key));
  db.put = vi.fn(async (_store: string, record: { key: string; value: unknown }) => records.set(record.key, record));
  return { db: db as LibraryDatabase, records, put: db.put };
}
it("persists only the enabled flag in the existing preference store", async () => {
  const { db, put } = database();
  expect(await db.getShortcutPreferences()).toBeUndefined();
  await db.setShortcutPreferences({ enabled: false });
  expect(put).toHaveBeenCalledWith("preferences", { key: "readerKeyboardShortcuts", value: { enabled: false } });
  expect(await db.getShortcutPreferences()).toEqual({ enabled: false });
});
it.each([true, false])("discards legacy overrides while preserving enabled=%s", async enabled => {
  const { db, records, put } = database();
  const legacy = { enabled, bindings: { nextPage: [], nextSection: [{ key: "b", mod: true }] } };
  records.set("readerKeyboardShortcuts", { key: "readerKeyboardShortcuts", value: legacy });
  expect(await db.getShortcutPreferences()).toEqual({ enabled });
  await db.setShortcutPreferences(legacy);
  expect(put).toHaveBeenCalledWith("preferences", { key: "readerKeyboardShortcuts", value: { enabled } });
});
it("rejects malformed enabled values without silently activating defaults", async () => {
  const { db, records, put } = database();
  records.set("readerKeyboardShortcuts", { key: "readerKeyboardShortcuts", value: { enabled: "false" } });
  await expect(db.getShortcutPreferences()).rejects.toThrow("Invalid keyboard shortcut");
  await expect(db.setShortcutPreferences({ enabled: "false" } as unknown as ShortcutPreferences))
    .rejects.toThrow("Invalid keyboard shortcut");
  expect(put).not.toHaveBeenCalled();
});
it("propagates preference read and write errors", async () => {
  const { db } = database();
  const internals = db as unknown as { get: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn> };
  internals.get.mockRejectedValue(new Error("Read failed"));
  internals.put.mockRejectedValue(new Error("Write failed"));
  await expect(db.getShortcutPreferences()).rejects.toThrow("Read failed");
  await expect(db.setShortcutPreferences({ enabled: true })).rejects.toThrow("Write failed");
});
