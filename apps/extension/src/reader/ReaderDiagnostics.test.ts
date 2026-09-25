import { describe, expect, it, vi } from "vitest";
import { ReaderController } from "./ReaderController.js";
import { DiagnosticsLog, type DiagnosticSettings } from "./DiagnosticsLog.js";
import { DEFAULT_BOOK_READING_SETTINGS, DEFAULT_GLOBAL_READING_SETTINGS } from "../library/ReadingSettings.js";

function setup() {
  const diagnostics = new DiagnosticsLog();
  const controller = Object.create(ReaderController.prototype) as ReaderController;
  Object.assign(controller, {
    ...DEFAULT_BOOK_READING_SETTINGS, ...DEFAULT_GLOBAL_READING_SETTINGS,
    diagnostics, operations: { disposed: false }, containerEl: document.createElement("div"),
    pkg: { spine: [{ manifestItem: { path: "private-chapter.xhtml" } }] }, spineIndex: 0,
    isFixedLayoutHost: () => false,
    requestLayout: vi.fn(async () => {}),
    refreshGlobalSettings: vi.fn(async () => {}),
    applyDisplaySettingsToHost: vi.fn(), notify: vi.fn(),
    library: { patchGlobalReadingSettings: vi.fn(async () => {}), patchBookReadingSettings: vi.fn(async () => {}) },
    clearNavigationHighlights: vi.fn(), suspendNarrationFollowing: vi.fn(),
    goToCfi: vi.fn(async () => {}), openSpineItem: vi.fn(async () => {}),
    searchCoordinator: { search: vi.fn(), goToResult: vi.fn(async () => {}) },
    narration: { snapshot: { rate: 1 }, setRate: vi.fn() },
  });
  return { controller, diagnostics };
}

describe("reader diagnostic intent", () => {
  const settings: Array<[keyof DiagnosticSettings, (controller: ReaderController) => void | Promise<void>, string]> = [
    ["viewMode", c => c.setViewMode("scroll"), '"scroll"'],
    ["fontScale", c => c.setFontScale(1.5), "1.5"],
    ["fontFamily", c => c.setFontFamily("times"), '"times"'],
    ["lineSpacing", c => c.setLineSpacing(1.8), "1.6"],
    ["letterSpacing", c => c.setLetterSpacing(0.1), "0.1"],
    ["contentWidthEm", c => c.setContentWidth(30), "30"],
    ["alwaysShowOnePage", c => c.setAlwaysShowOnePage(true), "true"],
    ["pageTheme", c => c.setPageTheme("sepia"), '"sepia"'],
    ["brightness", c => c.setBrightness(0.8), "0.8"],
    ["chromeTheme", c => c.setChromeTheme("blue"), '"blue"'],
    ["pageTurnAnimationStyle", c => c.setPageTurnAnimationStyle("scroll"), '"scroll"'],
  ];
  it.each(settings)("records %s with typed before/after values", async (name, change, after) => {
    const { controller, diagnostics } = setup();
    await change(controller);
    const report = diagnostics.format({});
    expect(report).toContain(`setting requested name="${name}" before=`);
    expect(report).toContain(`after=${after} source="reader-control"`);
  });

  it("uses the queued value as before and clamps incoming typography values", async () => {
    const { controller, diagnostics } = setup();
    Object.assign(controller, { pendingLayout: { configuration: { fontScale: 1.25 } } });
    await controller.setFontScale(999);
    expect(diagnostics.format({})).toContain('name="fontScale" before=1.25 after=2');
  });

  it("records playback rate and preference changes without private data", () => {
    const { controller, diagnostics } = setup();
    const snapshot = { rate: 1 };
    Object.assign(controller, { narration: { snapshot, setRate: (rate: number) => { snapshot.rate = rate; } } });
    controller.setNarrationRate(1.5);
    controller.recordDiagnosticEvent({ kind: "setting", name: "locale", before: "en", after: "ja", source: "preferences" });
    controller.recordDiagnosticEvent({ kind: "setting", name: "shortcutsEnabled", before: true, after: false, source: "preferences" });
    expect(diagnostics.format({})).toContain('name="narrationRate" before=1 after=1.5');
    expect(diagnostics.format({})).toContain('name="locale" before="en" after="ja"');
    expect(diagnostics.format({})).toContain('name="shortcutsEnabled" before=true after=false');
  });

  it("records Inspector show-in-book intent without its source path or selected text", async () => {
    const { controller, diagnostics } = setup();
    const showInBook = vi.fn(async () => {});
    Object.assign(controller, { inspectionReading: { create: () => ({ showInBook }) } });
    await controller.getInspectorReaderBridge().showInBook({
      path: "private.xhtml", spineIndex: 3, elementPath: [0, 1],
    });
    expect(showInBook).toHaveBeenCalledOnce();
    expect(diagnostics.format({})).toContain('navigation source="inspector" targetSpine=3');
    expect(diagnostics.format({})).not.toContain("private");
  });

  it("omits no-op settings, and never records search terms, annotation text, CFI assertions or paths", async () => {
    const { controller, diagnostics } = setup();
    await controller.setPageTheme(DEFAULT_GLOBAL_READING_SETTINGS.pageTheme);
    controller.search("private search terms");
    await controller.goToBookmark("private bookmark assertion");
    await controller.goToHighlight("private highlighted words");
    await controller.goToReadOnlyAnnotation("private annotation");
    await controller.goToSearchResult("private search CFI");
    await controller.goToNavPoint({ label: "private title", path: "private-chapter.xhtml",
      children: [], fragment: undefined, isLinked: true, target: "private-chapter.xhtml" });
    const report = diagnostics.format({});
    for (const source of ["bookmark", "highlight", "embedded-annotation", "search", "toc"]) {
      expect(report).toContain(`navigation source="${source}"`);
    }
    expect(report).toContain("queryLength=20");
    expect(report).toContain("navigation from spine=0 page=0 busy=false");
    expect(report).not.toContain("private");
    expect(report).not.toContain("setting");
  });
});
