import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ShortcutPreferencesProvider, useShortcutPreferences } from "./ShortcutPreferencesContext.js";

const database = vi.hoisted(() => ({
  getShortcutPreferences: vi.fn(),
  setShortcutPreferences: vi.fn(),
  subscribePreferences: vi.fn<(listener: () => void) => () => void>(() => vi.fn()),
  close: vi.fn(),
}));
vi.mock("../library/LibraryDatabase.js", () => ({ LibraryDatabase: { open: vi.fn(async () => database) } }));
let latest: ReturnType<typeof useShortcutPreferences>;
let root: Root;
let container: HTMLDivElement;
function Harness() { latest = useShortcutPreferences(); return null; }
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  database.getShortcutPreferences.mockResolvedValue(undefined);
  database.setShortcutPreferences.mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function mount() {
  await act(async () => root.render(<ShortcutPreferencesProvider><Harness /></ShortcutPreferencesProvider>));
}
it("is disabled before loading and honors persisted disabled settings", async () => {
  let resolve!: (value: unknown) => void;
  database.getShortcutPreferences.mockReturnValue(new Promise(yes => { resolve = yes; }));
  await mount();
  expect(latest.ready).toBe(false);
  expect(latest.preferences.enabled).toBe(false);
  const saved = { enabled: false };
  await act(async () => resolve(saved));
  expect(latest.ready).toBe(true);
  expect(latest.preferences).toEqual(saved);
});
it("never silently activates defaults after read failures and recovers through a live refresh", async () => {
  database.getShortcutPreferences.mockRejectedValue(new Error("Malformed saved shortcuts"));
  await mount();
  expect(latest.ready).toBe(false);
  expect(latest.preferences.enabled).toBe(false);
  expect(latest.error).toBe("Malformed saved shortcuts");
  database.getShortcutPreferences.mockResolvedValue({ enabled: false });
  await act(async () => {
    const listener = database.subscribePreferences.mock.calls[0]?.[0] as unknown as () => void;
    listener();
  });
  expect(latest.ready).toBe(true);
  expect(latest.error).toBeUndefined();
});
it("saves committed values, rejects storage failures, and cleans up subscriptions", async () => {
  await mount();
  const saved = { enabled: false };
  await act(async () => latest.setPreferences(saved));
  expect(database.setShortcutPreferences).toHaveBeenCalledWith(saved);
  expect(latest.preferences).toEqual(saved);
  database.setShortcutPreferences.mockRejectedValue(new Error("Save failed"));
  await act(async () => {
    await expect(latest.setPreferences({ enabled: true })).rejects.toThrow("Save failed");
  });
  expect(latest.preferences).toEqual(saved);
  expect(latest.error).toBe("Save failed");
  act(() => root.render(null));
  expect(database.subscribePreferences.mock.results[0]!.value).toHaveBeenCalledOnce();
  expect(database.close).toHaveBeenCalledOnce();
});
it("disables execution if a later cross-tab refresh fails", async () => {
  await mount();
  expect(latest.preferences.enabled).toBe(true);
  database.getShortcutPreferences.mockRejectedValue(new Error("Read failed"));
  await act(async () => {
    const listener = database.subscribePreferences.mock.calls[0]?.[0] as unknown as () => void;
    listener();
  });
  expect(latest.ready).toBe(false);
  expect(latest.preferences.enabled).toBe(false);
});
