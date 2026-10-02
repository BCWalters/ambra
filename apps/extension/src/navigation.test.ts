import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { closeLibraryImportWindow, finishLibraryImport, openLibraryImportWindow } from "./navigation.js";

const api = {
  runtime: { getURL: (path: string) => `chrome-extension://ambra/${path}` },
  windows: {
    getCurrent: vi.fn(),
    getAll: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  tabs: { getCurrent: vi.fn(), create: vi.fn(), remove: vi.fn() },
};
const destination = "chrome-extension://ambra/src/library/index.html?view=tab";

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("chrome", api);
  vi.spyOn(window, "close").mockImplementation(() => {});
  window.history.replaceState(null, "", "/?view=import&sourceWindow=7");
  api.windows.getCurrent.mockResolvedValue({ id: 7 });
  api.windows.getAll.mockResolvedValue([{ id: 7, focused: false }, { id: 8, focused: true }]);
  api.windows.create.mockResolvedValue({ id: 9 });
  api.windows.update.mockResolvedValue({});
  api.tabs.getCurrent.mockResolvedValue({ id: 70 });
  api.tabs.create.mockResolvedValue({ id: 80 });
  api.tabs.remove.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

it("creates a persistent compact window rather than an action popup or full Library", async () => {
  await openLibraryImportWindow();
  expect(api.windows.create).toHaveBeenCalledWith({
    url: "chrome-extension://ambra/src/library/index.html?view=import&sourceWindow=7",
    type: "popup", width: 480, height: 560, focused: true,
  });
  expect(window.close).not.toHaveBeenCalled();
});

it("closes the action popup only after its persistent replacement opens", async () => {
  api.tabs.getCurrent.mockResolvedValue(undefined);
  await openLibraryImportWindow();
  expect(window.close).toHaveBeenCalledOnce();
  expect(api.windows.create.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(window.close).mock.invocationCallOrder[0]!);
});

it("keeps the action popup open if its replacement cannot be created", async () => {
  api.tabs.getCurrent.mockResolvedValue(undefined);
  api.windows.create.mockRejectedValue(new Error("Window unavailable"));
  await expect(openLibraryImportWindow()).rejects.toThrow("Window unavailable");
  expect(window.close).not.toHaveBeenCalled();
});

it("rejects an empty creation result without closing the source", async () => {
  api.windows.create.mockResolvedValue(undefined);
  await expect(openLibraryImportWindow()).rejects.toThrow("Could not open the import window.");
  expect(window.close).not.toHaveBeenCalled();
});

it("returns to the originating normal window before closing only the importer tab", async () => {
  await finishLibraryImport(destination);
  expect(api.windows.getAll).toHaveBeenCalledWith({ windowTypes: ["normal"] });
  expect(api.tabs.create).toHaveBeenCalledWith({ url: destination, windowId: 7 });
  expect(api.windows.update).toHaveBeenCalledWith(7, { focused: true });
  expect(api.tabs.remove).toHaveBeenCalledWith(70);
  expect(api.tabs.create.mock.invocationCallOrder[0]).toBeLessThan(api.tabs.remove.mock.invocationCallOrder[0]!);
});

it("uses another normal window if the source has closed", async () => {
  api.windows.getAll.mockResolvedValue([{ id: 8, focused: true }]);
  await finishLibraryImport(destination);
  expect(api.tabs.create).toHaveBeenCalledWith({ url: destination, windowId: 8 });
});

it("creates a normal window if only the importer remains", async () => {
  api.windows.getAll.mockResolvedValue([]);
  await finishLibraryImport(destination);
  expect(api.windows.create).toHaveBeenCalledWith({ url: destination, type: "normal", focused: true });
  expect(api.tabs.create).not.toHaveBeenCalled();
  expect(api.tabs.remove).toHaveBeenCalledWith(70);
});

it("keeps the importer open when opening its destination fails", async () => {
  api.tabs.create.mockRejectedValue(new Error("Window unavailable"));
  await expect(finishLibraryImport(destination)).rejects.toThrow("Window unavailable");
  expect(api.tabs.remove).not.toHaveBeenCalled();
});

it("rejects malformed destination IDs without acting on another window", async () => {
  window.history.replaceState(null, "", "/?view=import&sourceWindow=bad");
  await expect(finishLibraryImport(destination)).rejects.toThrow("Invalid import-window destination.");
  expect(api.windows.getAll).not.toHaveBeenCalled();
  expect(api.tabs.remove).not.toHaveBeenCalled();
});

it("reports an unavailable importer tab instead of claiming it closed", async () => {
  api.tabs.getCurrent.mockResolvedValue(undefined);
  await expect(closeLibraryImportWindow()).rejects.toThrow("Could not identify the import window.");
  expect(api.tabs.remove).not.toHaveBeenCalled();
});
