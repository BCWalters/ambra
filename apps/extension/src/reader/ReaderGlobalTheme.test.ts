import { expect, it, vi } from "vitest";
import { ReaderController } from "./ReaderController.js";
import { DEFAULT_GLOBAL_READING_SETTINGS } from "../library/ReadingSettings.js";

function fixture() {
  const controller = Object.create(ReaderController.prototype);
  Object.assign(controller, {
    ...DEFAULT_GLOBAL_READING_SETTINGS, operations: { disposed: false }, preferencesRevision: 0,
    containerEl: document.createElement("div"), recordDiagnosticEvent: vi.fn(),
    requestLayout: vi.fn(), applyPageThemeToHost: vi.fn(), notify: vi.fn(),
    library: {
      getGlobalReadingSettings: vi.fn(async () => ({ ...DEFAULT_GLOBAL_READING_SETTINGS, pageTheme: "dark" })),
      patchGlobalReadingSettings: vi.fn(async () => {}),
    },
  });
  return controller;
}

it("repaints external global theme changes without repagination or writeback", async () => {
  const controller = fixture();
  await controller.refreshGlobalSettings();
  expect(controller.pageTheme).toBe("dark");
  expect(controller.applyPageThemeToHost).toHaveBeenCalledOnce();
  expect(controller.notify).toHaveBeenCalledOnce();
  expect(controller.requestLayout).not.toHaveBeenCalled();
  expect(controller.library.patchGlobalReadingSettings).not.toHaveBeenCalled();
  await controller.refreshGlobalSettings();
  expect(controller.applyPageThemeToHost).toHaveBeenCalledOnce();
});

it("does not let a late read override a newer cross-tab theme", async () => {
  const controller = fixture();
  let complete!: (settings: typeof DEFAULT_GLOBAL_READING_SETTINGS) => void;
  controller.library.getGlobalReadingSettings.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const first = controller.refreshGlobalSettings();
  await controller.refreshGlobalSettings();
  complete({ ...DEFAULT_GLOBAL_READING_SETTINGS, pageTheme: "sepia" });
  await first;
  expect(controller.pageTheme).toBe("dark");
  expect(controller.applyPageThemeToHost).toHaveBeenCalledOnce();
});

it("surfaces failed global-theme persistence without falsely changing live state", async () => {
  const controller = fixture();
  controller.library.patchGlobalReadingSettings.mockRejectedValue(new Error("Storage full"));
  await expect(controller.setPageTheme("sepia")).rejects.toThrow("Storage full");
  expect(controller.pageTheme).toBe("white");
  expect(controller.applyPageThemeToHost).not.toHaveBeenCalled();
  expect(controller.library.getGlobalReadingSettings).not.toHaveBeenCalled();
});

it.each(["off", "upcoming"] as const)(
  "switches global progress markers to %s without moving or repaginating the book",
  async style => {
    const controller = fixture();
    controller.spineIndex = 3;
    controller.host = { currentPageIndex: 7 };
    controller.openSpineItem = vi.fn();
    controller.seekToFraction = vi.fn();
    controller.library.getGlobalReadingSettings.mockResolvedValue({
      ...DEFAULT_GLOBAL_READING_SETTINGS, progressMarkerStyle: style,
    });
    await controller.setProgressMarkerStyle(style);
    expect(controller.library.patchGlobalReadingSettings).toHaveBeenCalledExactlyOnceWith({ progressMarkerStyle: style });
    expect(controller.progressMarkerStyle).toBe(style);
    expect(controller.spineIndex).toBe(3);
    expect(controller.host.currentPageIndex).toBe(7);
    expect(controller.requestLayout).not.toHaveBeenCalled();
    expect(controller.openSpineItem).not.toHaveBeenCalled();
    expect(controller.seekToFraction).not.toHaveBeenCalled();
    expect(controller.applyPageThemeToHost).not.toHaveBeenCalled();
    expect(controller.notify).toHaveBeenCalledTimes(style === "upcoming" ? 0 : 1);
  },
);

it("refreshes external progress marker changes without writing them back", async () => {
  const controller = fixture();
  controller.library.getGlobalReadingSettings.mockResolvedValue({
    ...DEFAULT_GLOBAL_READING_SETTINGS, progressMarkerStyle: "off",
  });
  await controller.refreshGlobalSettings();
  expect(controller.progressMarkerStyle).toBe("off");
  expect(controller.notify).toHaveBeenCalledOnce();
  expect(controller.requestLayout).not.toHaveBeenCalled();
  expect(controller.library.patchGlobalReadingSettings).not.toHaveBeenCalled();
});

it("retains the current marker style on a failed save and ignores changes after disposal", async () => {
  const controller = fixture();
  controller.library.patchGlobalReadingSettings.mockRejectedValue(new Error("Storage full"));
  await expect(controller.setProgressMarkerStyle("off")).rejects.toThrow("Storage full");
  expect(controller.progressMarkerStyle).toBe("upcoming");
  expect(controller.notify).not.toHaveBeenCalled();
  expect(controller.library.getGlobalReadingSettings).not.toHaveBeenCalled();
  controller.operations.disposed = true;
  await controller.setProgressMarkerStyle("off");
  expect(controller.library.patchGlobalReadingSettings).toHaveBeenCalledOnce();
});
