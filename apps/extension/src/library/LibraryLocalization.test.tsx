import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LibraryApp } from "./LibraryApp.js";
import { useLibrary, type UseLibraryResult, type LibraryBookViewModel } from "./useLibrary.js";
import { CATALOGS, getTranslate } from "../i18n/translate.js";
import { SUPPORTED_LOCALES, type Locale } from "../i18n/Locale.js";
import { DEFAULT_GLOBAL_READING_SETTINGS } from "./ReadingSettings.js";
import { formatLibraryBytes, formatLibraryProgress } from "./LibraryFormatting.js";
import { generatedCoverColor } from "./LibraryBookCard.js";

const language = vi.hoisted(() => ({ locale: "en" as Locale }));
vi.mock("./useLibrary.js", () => ({ useLibrary: vi.fn() }));
vi.mock("../i18n/LocaleContext.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../i18n/LocaleContext.js")>();
  return { ...actual, useTranslation: () => actual.getTranslate(language.locale),
    useLocale: () => ({ locale: language.locale, preference: language.locale, ready: true, setPreference: vi.fn() }) };
});

describe("Library localization and action ownership", () => {
  let container: HTMLDivElement;
  let root: Root;
  let state: UseLibraryResult;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("chrome", { runtime: { getManifest: () => ({ version: "1.2.3" }) } });
    const animate = Element.prototype.animate;
    vi.spyOn(Element.prototype, "animate").mockImplementation(function (this: Element, keyframes, options) {
      const animation = animate.call(this, keyframes, options);
      // happy-dom rejects canceled finished promises even after Fluent has disposed its motion.
      vi.spyOn(animation, "cancel").mockImplementation(() => animation.finish());
      queueMicrotask(() => animation.finish());
      return animation;
    });
    language.locale = "en";
    state = {
      books: [], isLoading: false, canImport: true, error: undefined,
      importActivities: [], dismissCompletedImports: vi.fn(), cancelDownload: vi.fn(),
      dismissError: vi.fn(), importFiles: vi.fn(), removeBook: vi.fn(), openBook: vi.fn(),
      chromeTheme: "ambra", settings: DEFAULT_GLOBAL_READING_SETTINGS, setSettings: vi.fn(),
      sort: "dateAddedDesc", setSort: vi.fn(), isFullTab: true, openInFullTab: vi.fn(),
      storageUsage: { usageBytes: 1536, quotaBytes: 1048576 }, openInspectionSession: vi.fn(), saveBookAs: vi.fn(),
      getBookFileSize: vi.fn().mockResolvedValue(1536),
      enrichDescription: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(useLibrary).mockImplementation(() => state);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  async function render() { await act(async () => root.render(<LibraryApp />)); }
  function button(label: string) {
    return [...document.querySelectorAll<HTMLButtonElement>("button")].find((entry) =>
      entry.textContent === label || entry.getAttribute("aria-label") === label)!;
  }
  async function click(label: string) { await act(async () => button(label).click()); }
  const book = (title = "Original title"): LibraryBookViewModel => ({
    id: title, title, creator: "Original author", publisher: "Original publisher", identifiers: [],
    fileName: "original.epub", addedAt: new Date(2026, 8, 23).getTime(),
  } as unknown as LibraryBookViewModel);

  it.each([true, false])("keeps standalone book activation available during imports (full tab: %s)", async (isFullTab) => {
    state.isFullTab = isFullTab;
    state.books = [{ ...book("Original title"), lastReadAt: 10 }];
    state.importActivities = [
      { id: 1, fileName: "original.epub", phase: "complete", bookId: "Original title" },
      { id: 2, fileName: "new.epub", phase: "saving" },
    ];
    await render();
    const covers = [...container.querySelectorAll<HTMLButtonElement>("[data-book-open]")];
    expect(covers).toHaveLength(isFullTab ? 2 : 1);
    for (const cover of covers) {
      expect(cover.disabled).toBe(false);
      await act(async () => cover.click());
    }
    expect(button("Read now: Original title").disabled).toBe(false);
    await click("Read now: Original title");
    expect(state.openBook).toHaveBeenCalledTimes(covers.length + 1);
    expect(state.openBook).toHaveBeenLastCalledWith("Original title");
  });

  it.each(SUPPORTED_LOCALES)("localizes empty state, modal discovery, help and populated totals in %s", async (locale) => {
    language.locale = locale;
    const t = getTranslate(locale);
    await render();
    expect(document.title).toBe(t("library.pageTitle"));
    expect(container.textContent).toContain(t("library.emptyTitle"));
    expect(container.querySelector("main button")).toBeNull();
    expect(container.querySelector("footer")?.textContent).not.toContain("0");
    expect(button(t("library.importEpub"))).toBeDefined();
    await click(t("library.findBooks"));
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain(t("library.discoveryTitle"));
    expect([...dialog.querySelectorAll("a")].map((link) => link.textContent?.trim())).toEqual([
      "Standard Ebooks", "Project Gutenberg", "ReadBeyond", "eBooks.com",
    ]);
    for (const link of dialog.querySelectorAll("a")) {
      expect(link.target).toBe("_blank");
      expect(link.rel).toBe("noopener noreferrer");
    }
    expect(dialog.textContent).toContain(t("library.discoveryImport", { importLabel: t("library.importEpub"), extension: ".epub" }));
    await click(t("highlight.close"));
    await click(t("about.title"));
    const help = document.querySelector('[role="dialog"]')!;
    expect(help.querySelector("a")?.textContent).toBe(t("about.userGuide"));
    expect(button(t("about.copyDiagnostics"))).toBeDefined();
    expect([...help.querySelectorAll("h3")].map((heading) => heading.textContent)).toContain(t("about.aboutAmbra"));
    expect(help.textContent).toContain(t("about.description"));
    expect(help.textContent).toContain(t("about.version", { version: "1.2.3" }));
    expect(help.querySelector('a[href="https://ambraepub.org/en/privacy/"]')?.textContent).toBe(t("about.privacy"));
    await click(t("highlight.close"));
    state.books = [book()];
    await render();
    const footer = container.querySelector("footer")!;
    expect(footer.textContent).toContain(t("library.bookCount", { count: "1" }));
    expect(footer.textContent).toContain(formatLibraryBytes(1536, locale));
    expect(button(t("library.sort"))?.textContent).toBe(t("library.sortLabel"));
  });

  it("keeps persistent normal actions while loading/importing and routes compact discovery to a tab", async () => {
    state.isFullTab = false;
    state.isLoading = true;
    state.canImport = false;
    await render();
    expect(button("Import book").disabled).toBe(true);
    expect(button("Find books").disabled).toBe(false);
    expect(container.textContent).not.toContain("No books yet");
    await click("Find books");
    expect(state.openInFullTab).toHaveBeenCalledWith(true);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await click("Open library in new tab");
    expect(state.openInFullTab).toHaveBeenCalledWith();
    state.isLoading = false;
    state.canImport = true;
    state.importActivities = [{ id: 1, fileName: "first.epub", phase: "processing" }];
    state.error = "Another file failed";
    await render();
    expect(container.textContent).not.toContain("No books yet");
    expect(container.querySelector('[role="status"]')?.textContent).toContain("first.epub");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Another file failed");
    const choose = vi.spyOn(container.querySelector<HTMLInputElement>('input[type="file"]')!, "click");
    await click("Import book");
    expect(choose).toHaveBeenCalledOnce();
  });

  it("leads settings with interface controls and initially collapsed shared reading preferences", async () => {
    await render();
    await click("Ambra settings");
    const surface = document.querySelector('[role="dialog"]')!;
    expect(surface.textContent).toContain("Interface theme");
    expect(surface.querySelector("details")?.open).toBe(false);
    const select = surface.querySelector("select")!;
    await act(async () => { select.value = "blue"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(state.setSettings).toHaveBeenCalledWith({ chromeTheme: "blue" });
    expect(surface.querySelectorAll("select")).toHaveLength(6);
  });

  it("uses the latest real saved reading timestamp for Continue reading without replacing the collection", async () => {
    state.books = [{ ...book("Old"), lastReadAt: 10 }, { ...book("New"), lastReadAt: 20 }, book("Unread")];
    await render();
    const section = container.querySelector('section[aria-label="Continue reading"]')!;
    expect(section.textContent).toContain("New");
    expect(section.textContent).not.toContain("Old");
    expect(container.querySelectorAll("[data-library-book]")).toHaveLength(4);
    state.isFullTab = false;
    await render();
    expect(container.querySelector('section[aria-label="Continue reading"]')).toBeNull();
  });

  it.each(SUPPORTED_LOCALES)("offers a prominent localized resume card without inventing chapter metadata in %s", async locale => {
    language.locale = locale;
    const t = getTranslate(locale);
    state.books = [{ ...book("Old"), lastReadAt: 10 },
      { ...book("Most recent"), lastReadAt: 20, progressFraction: 0.29 }, book("Unread")];
    await render();
    const resume = container.querySelector<HTMLElement>("[data-library-continue]")!;
    expect(resume.querySelector("h3")?.textContent).toBe("Most recent");
    expect(resume.textContent).toContain(t("library.percentRead", { progress: formatLibraryProgress(0.29, locale) }));
    expect(getComputedStyle(resume).borderRadius).toBe("8px");
    expect(resume.querySelector<HTMLButtonElement>("[data-book-open]")?.style.width).toBe("72px");
    expect(resume.querySelector<HTMLElement>("[data-library-progress-track]")?.style.maxWidth).toBe("240px");
    expect(resume.textContent).not.toContain("Chapter");
    await click(t("library.continueReading"));
    expect(state.openBook).toHaveBeenCalledExactlyOnceWith("Most recent");
    const details = [...resume.querySelectorAll("button")].find(element =>
      element.getAttribute("aria-label") === t("library.bookDetails", { title: "Most recent" }))!;
    expect(details.closest("[data-library-progress-status]")?.textContent)
      .toContain(t("library.percentRead", { progress: formatLibraryProgress(0.29, locale) }));
    expect(resume.querySelector("[data-library-continue-actions]")?.contains(details)).toBe(false);
    await act(async () => details.click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Most recent");
    expect(container.querySelector("input[type=file]")?.getAttribute("accept")).toBe(".epub");
  });

  it("reserves card rows and contains real artwork without changing accessible titles", async () => {
    const title = `Title ${"unbroken".repeat(100)}`;
    const creator = "作者".repeat(100);
    state.books = [{ ...book(title), creator, cardCoverUrl: "blob:cover" }, book("Unread")];
    await render();
    const open = button(`Open ${title}`);
    expect(open.querySelector("img")?.style.objectFit).toBe("contain");
    expect(open.style.width).toBe("140px");
    expect(open.style.height).toBe("210px");
    const cards = container.querySelectorAll("article");
    for (const card of cards) {
      expect(card.querySelector("p")?.style.height).toBe("40px");
      expect(card.querySelectorAll("p")[1]?.style.height).toBe("18px");
    }
    expect(button(`${title} details`)).toBeDefined();
    expect(state.books[0]?.title).toBe(title);
    expect(state.books[0]?.creator).toBe(creator);
  });

  it.each([true, false])("renders title, author, ornament and stable color with full-tab=%s", async fullTab => {
    state.isFullTab = fullTab;
    state.books = [{ ...book("The Quiet Coast"), creator: "Mara Vale" }];
    await render();
    const cover = button("Open The Quiet Coast").querySelector<HTMLElement>("[data-generated-cover]")!;
    expect(cover.getAttribute("aria-hidden")).toBe("true");
    expect(cover.textContent).toContain("The Quiet Coast");
    expect(cover.textContent).toContain("Mara Vale");
    expect(cover.querySelector("[data-cover-ornament]")).not.toBeNull();
    const color = cover.style.backgroundColor;
    state.chromeTheme = "purple";
    state.books = [{ ...state.books[0]!, id: "reimported", progressFraction: 0.5 }];
    await render();
    expect(container.querySelector<HTMLElement>("[data-generated-cover]")!.style.backgroundColor).toBe(color);
  });

  it.each(SUPPORTED_LOCALES)("labels unread and unknown progress without inventing a percentage in %s", async (locale) => {
    language.locale = locale;
    const t = getTranslate(locale);
    state.books = [
      book("Unread"),
      { ...book("Unknown"), lastReadAt: 1 },
      { ...book("Zero"), progressFraction: 0 },
      { ...book("Reading"), progressFraction: 0.42 },
    ];
    await render();
    const cards = container.querySelectorAll("[data-library-collection] article");
    expect(cards[0]!.textContent).toContain(t("library.notStarted"));
    expect(cards[1]!.textContent).toContain(t("library.started"));
    expect(cards[1]!.textContent).not.toContain(t("library.notStarted"));
    expect(cards[2]!.textContent).toContain(formatLibraryProgress(0, locale));
    expect(cards[3]!.textContent).toContain(formatLibraryProgress(0.42, locale));
    for (const [index, card] of [...cards].entries()) {
      const track = card.querySelector<HTMLElement>("[data-library-progress-track]")!;
      expect(track.style.background).toBe("var(--colorNeutralStroke2)");
      expect(track.childElementCount).toBe(index < 2 ? 0 : 1);
    }
  });

  it.each(SUPPORTED_LOCALES)("preserves every import state and duplicate outcome in %s", async (locale) => {
    language.locale = locale;
    const t = getTranslate(locale);
    state.importActivities = [
      { id: 1, fileName: "queued.epub", phase: "queued" },
      { id: 2, fileName: "download.epub", phase: "downloading" },
      { id: 3, fileName: "processing.epub", phase: "processing" },
      { id: 4, fileName: "saving.epub", phase: "saving" },
      { id: 5, fileName: "complete.epub", phase: "complete", bookId: "Original title" },
      { id: 6, fileName: "existing.epub", phase: "complete", outcome: "existing" },
    ];
    state.books = [book()];
    await render();
    const status = container.querySelector('[role="status"]')!;
    for (const [key, fileName] of [
      ["library.importQueued", "queued.epub"], ["library.importDownloading", "download.epub"],
      ["library.importProcessing", "processing.epub"], ["library.importSaving", "saving.epub"],
      ["library.importComplete", "Original title"], ["library.importAlreadyPresent", "existing.epub"],
    ] as const) expect(status.textContent).toContain(t(key, { fileName }));
    await click(t("library.cancelDownloadFile", { fileName: "download.epub" }));
    expect(state.cancelDownload).toHaveBeenCalledWith(2);
    await click(t("library.readNowBook", { title: "Original title" }));
    expect(state.openBook).toHaveBeenCalledWith("Original title");
    await click(t("library.dismiss"));
    expect(state.dismissCompletedImports).toHaveBeenCalledOnce();
  });

  it("keeps full metadata, file size, Save as and removal in book details", async () => {
    state.books = [{ ...book(), progressFraction: 0.42, description: "Original description" }];
    await render();
    await click("Original title details");
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Original publisher");
    expect(dialog.textContent).toContain(formatLibraryBytes(1536, "en"));
    expect(dialog.textContent).toContain("Original description");
    expect(button("Remove from library")).toBeDefined();
    await click("Publication details");
    expect(dialog.textContent).toContain("original.epub");
    expect(dialog.textContent).toContain(new Date(state.books[0]!.addedAt).toLocaleDateString("en"));
    expect(button(getTranslate("en")("library.saveAs"))).toBeDefined();
  });

  it("reports diagnostic copy success/failure without publication data or rendered error markup", async () => {
    language.locale = "fr";
    const t = getTranslate("fr");
    const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    await render();
    await click(t("about.title"));
    await click(t("about.copyDiagnostics"));
    expect(button(t("about.copied"))).toBeDefined();
    expect(write.mock.calls[0]?.[0]).toContain("Ambra environment info\n");
    expect(write.mock.calls[0]?.[0]).not.toContain("Original title");
    write.mockRejectedValueOnce(new Error("Permission denied <script>"));
    await click(t("about.copied"));
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Permission denied <script>");
    expect(document.querySelector('[role="alert"] script')).toBeNull();
  });
});

describe("Library catalog and number formatting", () => {
  it("assigns exactly five stable cover colors with accessible text contrast", () => {
    const colors = new Set(Array.from({ length: 200 }, (_, index) => generatedCoverColor(`Book ${index}`)));
    expect(colors.size).toBe(5);
    expect(generatedCoverColor("Café")).toBe(generatedCoverColor("Cafe\u0301"));
    expect(generatedCoverColor(" The Quiet Coast ")).toBe(generatedCoverColor("The Quiet Coast"));
    const luminance = (hex: string) => {
      const rgb = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
        .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
      return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
    };
    for (const color of colors) {
      expect((luminance("#fff8e9") + 0.05) / (luminance(color) + 0.05)).toBeGreaterThanOrEqual(4.5);
    }
  });
  it.each(SUPPORTED_LOCALES)("preserves translation placeholders in %s", (locale) => {
    for (const key of Object.keys(CATALOGS.en).filter((key) => /^(library|about|settings|shortcuts)\./.test(key))) {
      const catalogKey = key as keyof typeof CATALOGS.en;
      const placeholders = (value: string) => value.match(/\{\w+\}/g)?.sort() ?? [];
      expect(placeholders(CATALOGS[locale][catalogKey]), catalogKey).toEqual(placeholders(CATALOGS.en[catalogKey]));
    }
  });
  it("formats localized bytes and progress", () => {
    expect(formatLibraryBytes(1536, "en")).toContain("1.50");
    expect(formatLibraryBytes(1536, "de")).toContain("1,50");
    expect(formatLibraryProgress(0.425, "fr")).toBe(new Intl.NumberFormat("fr", { style: "percent", maximumFractionDigits: 0 }).format(0.425));
  });
});
