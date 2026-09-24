import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LibraryApp } from "./LibraryApp.js";
import { useLibrary, type UseLibraryResult, type LibraryBookViewModel } from "./useLibrary.js";
import { CATALOGS, getTranslate } from "../i18n/translate.js";
import { SUPPORTED_LOCALES, type Locale } from "../i18n/Locale.js";
import { DEFAULT_GLOBAL_READING_SETTINGS } from "./ReadingSettings.js";
import { formatLibraryBytes, formatLibraryProgress } from "./LibraryFormatting.js";

const language = vi.hoisted(() => ({ locale: "en" as Locale }));
vi.mock("./useLibrary.js", () => ({ useLibrary: vi.fn() }));
vi.mock("../i18n/LocaleContext.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../i18n/LocaleContext.js")>();
  return { ...actual, useTranslation: () => actual.getTranslate(language.locale),
    useLocale: () => ({ locale: language.locale, preference: language.locale, ready: true, setPreference: vi.fn() }) };
});
vi.mock("@fluentui/react-components", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@fluentui/react-components")>();
  return { ...actual,
    OverlayDrawer: ({ open, children, "aria-labelledby": labelledBy }: { open: boolean; children: React.ReactNode; "aria-labelledby"?: string }) =>
      open ? <section role="dialog" aria-labelledby={labelledBy}>{children}</section> : null,
  };
});

describe("Library localization and action order", () => {
  let container: HTMLDivElement;
  let root: Root;
  let state: UseLibraryResult;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("chrome", { runtime: { getManifest: () => ({ version: "1.2.3" }) } });
    const animate = Element.prototype.animate;
    vi.spyOn(Element.prototype, "animate").mockImplementation(function (this: Element, keyframes, options) {
      const animation = animate.call(this, keyframes, options);
      queueMicrotask(() => animation.finish());
      return animation;
    });
    language.locale = "en";
    state = {
      books: [], isLoading: false, canImport: true, error: undefined,
      importActivities: [], dismissCompletedImports: vi.fn(),
      dismissError: vi.fn(), importFiles: vi.fn(), removeBook: vi.fn(), openBook: vi.fn(),
      chromeTheme: "ambra", settings: DEFAULT_GLOBAL_READING_SETTINGS, setSettings: vi.fn(),
      sort: "dateAddedDesc", setSort: vi.fn(), isFullTab: false, openInFullTab: vi.fn(),
      storageUsage: { usageBytes: 1536, quotaBytes: 1048576 }, openInspectionSession: vi.fn(),
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
    return [...container.querySelectorAll<HTMLButtonElement>("button")].find((entry) =>
      entry.textContent === label || entry.getAttribute("aria-label") === label ||
      entry.getAttribute("aria-labelledby")?.split(" ").map((id) => document.getElementById(id)?.textContent).join(" ") === label)!;
  }

  it.each(SUPPORTED_LOCALES)("localizes empty Library, discovery, About and storage in %s", async (locale) => {
    language.locale = locale;
    const t = getTranslate(locale);
    await render();
    expect(document.title).toBe(t("library.pageTitle"));
    expect(container.textContent).toContain(t("library.emptyTitle"));
    const explore = button(`${t("library.findNextBook")} ${t("library.exploreFreeBooks")}`);
    expect(explore.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector("main section")?.hasAttribute("hidden")).toBe(true);
    await act(async () => explore.click());
    expect(container.textContent).toContain(t("library.discoveryTitle"));
    expect(container.textContent).toContain(t("library.discoveryImport", { importLabel: t("library.chooseEpubFiles"), extension: ".epub" }));
    expect(container.textContent).toContain(t("library.standardEbooksDownload"));
    expect(container.textContent).toContain(t("library.gutenbergDownload"));
    expect(container.textContent).toContain(t("library.readBeyondDownload"));
    expect(container.textContent).toContain(t("library.bookCount", { count: "0" }));
    expect(container.textContent).toContain(formatLibraryBytes(1536, locale));
    expect(container.querySelector('a[href="https://www.gutenberg.org/ebooks/"]')?.textContent?.trim()).toBe("Project Gutenberg");
    await act(async () => button(t("about.title")).click());
    expect(container.textContent).toContain(t("about.description"));
    expect(container.textContent).toContain(t("about.version", { version: "1.2.3" }));
    expect(container.textContent).toContain("Ben Walters");
    expect(container.querySelector('a[href="mailto:AmbraEPUB@outlook.com"]')?.textContent).toBe(t("about.feedback"));
    const privacy = container.querySelector<HTMLAnchorElement>('a[href="https://github.com/BCWalters/ambra/blob/main/store-assets/privacy-policy.md"]');
    expect(privacy?.textContent).toBe(t("about.privacy"));
    expect(privacy?.target).toBe("_blank");
    expect(privacy?.rel).toBe("noreferrer");
    expect(container.querySelector<HTMLAnchorElement>('a[href="https://github.com/BCWalters/ambra"]')?.style.color).toBe("#7a3e00");
    expect(button(t("about.copyDiagnostics"))).toBeDefined();
  });

  it("keeps DOM/tab order Import, Sort, Settings, About, then popup-only Expand", async () => {
    await render();
    const labels = () => [...container.querySelectorAll<HTMLButtonElement>('[role="toolbar"] button')].map((entry) =>
      entry.getAttribute("aria-label") ?? (entry.textContent || document.getElementById(entry.getAttribute("aria-labelledby") ?? "")?.textContent));
    expect(labels()).toEqual(["Settings", "Help & About", "Expand library into a full browser tab"]);
    state.books = [{ id: "book", title: "Book", identifiers: [] } as unknown as LibraryBookViewModel];
    await render();
    expect(labels()).toEqual(["Import EPUB", "Sort library", "Settings", "Help & About", "Expand library into a full browser tab"]);
    state.isFullTab = true;
    await render();
    expect(labels()).toEqual(["Import EPUB", "Sort library", "Settings", "Help & About"]);
  });

  it("offers exactly two whole-card actions and toggles discovery without moving focus", async () => {
    await render();
    const actions = [...container.querySelectorAll<HTMLButtonElement>("main button")];
    expect(actions).toHaveLength(2);
    const [bring, explore] = actions;
    expect(bring?.textContent).toContain("FROM YOUR DEVICE");
    expect(bring?.textContent).toContain("Choose EPUB files...");
    expect(explore?.textContent).toContain("ON THE WEB");
    expect(bring?.querySelector("button, a")).toBeNull();
    expect(explore?.querySelector("button, a")).toBeNull();
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const choose = vi.spyOn(input, "click");
    await act(async () => bring!.click());
    expect(choose).toHaveBeenCalledOnce();
    explore!.focus();
    await act(async () => explore!.click());
    expect(document.activeElement).toBe(explore);
    const panel = document.getElementById(explore!.getAttribute("aria-controls")!)!;
    expect(panel.hidden).toBe(false);
    expect(container.querySelectorAll("main button")).toHaveLength(2);
    expect([...panel.querySelectorAll("a")].map((link) => link.textContent?.trim())).toEqual([
      "Standard Ebooks", "Project Gutenberg", "ReadBeyond",
    ]);
    await act(async () => explore!.click());
    expect(panel.hidden).toBe(true);
    expect(document.activeElement).toBe(explore);
  });

  it("keeps onboarding out of loading, disables unavailable import, and preserves discovery", async () => {
    state.isLoading = true;
    state.canImport = false;
    await render();
    expect(container.textContent).not.toContain("What will you read first?");
    expect(container.querySelector("main button")).toBeNull();
    expect(button("Import EPUB")).toBeUndefined();
    state.isLoading = false;
    state.error = "Database unavailable";
    await render();
    expect(button("Bring a book Choose EPUB files...").disabled).toBe(true);
    expect(container.querySelector<HTMLInputElement>('input[type="file"]')?.disabled).toBe(true);
    expect(button("Find your next book Explore free books").disabled).toBe(false);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Database unavailable");
  });

  it("keeps choices, errors and concurrent import progress until the first book appears", async () => {
    await render();
    const bring = button("Bring a book Choose EPUB files...");
    bring.focus();
    state.importActivities = [
      { id: 1, fileName: "first.epub", phase: "processing" },
      { id: 2, fileName: "second.epub", phase: "queued" },
    ];
    state.error = "Another file failed";
    await render();
    expect(button("Bring a book Choose EPUB files...")).toBe(bring);
    expect(bring.disabled).toBe(false);
    expect(document.activeElement).toBe(bring);
    expect(container.querySelector('[role="status"]')?.textContent).toContain("first.epub");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Another file failed");
    state.books = [{ id: "first", title: "First book", identifiers: [] } as unknown as LibraryBookViewModel];
    state.importActivities = [
      { id: 1, fileName: "first.epub", phase: "complete", bookId: "first" },
      { id: 2, fileName: "second.epub", phase: "processing" },
    ];
    await render();
    expect(container.textContent).not.toContain("What will you read first?");
    expect(document.activeElement).toBe(button("Import EPUB"));
    expect(button("Read now: First book")).toBeDefined();
    expect(button("Find books").getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector('[role="status"]')?.textContent).toContain("second.epub");
  });

  it.each(["Help & About", undefined])("does not steal focus from %s after the first import", async (focusLabel) => {
    await render();
    if (focusLabel) button(focusLabel).focus();
    const focused = document.activeElement;
    state.books = [{ id: "first", title: "First book", identifiers: [] } as unknown as LibraryBookViewModel];
    await render();
    expect(document.activeElement).toBe(focused);
  });

  it("restores focus when a focused discovery link disappears with onboarding", async () => {
    await render();
    await act(async () => button("Find your next book Explore free books").click());
    container.querySelector<HTMLAnchorElement>('a[href="https://standardebooks.org/ebooks"]')!.focus();
    state.books = [{ id: "first", title: "First book", identifiers: [] } as unknown as LibraryBookViewModel];
    await render();
    expect(document.activeElement).toBe(button("Import EPUB"));
  });

  it("contains coverless titles, creators and action tooltips without shortening book data or action names", async () => {
    const title = `Title ${"unbroken".repeat(100)}`;
    const creator = `Creator ${"作者".repeat(100)}`;
    state.books = [{ id: "long-book", title, creator, identifiers: [] } as unknown as LibraryBookViewModel];
    const markup = renderToStaticMarkup(<LibraryApp />);
    expect(markup).toContain("-webkit-line-clamp:6");
    expect(markup).toContain("-webkit-line-clamp:2");
    await render();
    const cover = button(`Open ${title}`);
    const coverTitle = cover.querySelector<HTMLElement>("span")!;
    expect(coverTitle.textContent).toBe(title);
    expect(coverTitle.style.overflow).toBe("hidden");
    expect(coverTitle.style.overflowWrap).toBe("anywhere");
    const author = [...container.querySelectorAll("p")].find((entry) => entry.textContent === creator)!;
    expect(author.style.overflow).toBe("hidden");
    expect(author.style.overflowWrap).toBe("anywhere");
    const details = button(`${title} details`);
    await act(async () => details.dispatchEvent(new PointerEvent("pointerover", { bubbles: true })));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });
    const tooltip = document.querySelector<HTMLElement>('[role="tooltip"]')!;
    expect(tooltip.textContent).toBe(`${title} details`);
    expect(tooltip.style.overflowWrap).toBe("anywhere");
    expect(tooltip.style.maxHeight).toContain("240px");
    expect(details.getAttribute("aria-label")).toBe(`${title} details`);
    expect(state.books[0]?.title).toBe(title);
    expect(state.books[0]?.creator).toBe(creator);
  });

  it("exposes a Library main landmark and a readable top-level heading", async () => {
    await render();
    expect(container.querySelector("main")?.getAttribute("aria-label")).toBe("Ambra — Library");
    const heading = container.querySelector("h1")!;
    expect(heading.textContent).toBe("Ambra");
    expect(heading.style.color).toBe("#7a3e00");
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.querySelector("main h2")?.getAttribute("style")).toContain("#7a3e00");
  });

  it.each(SUPPORTED_LOCALES)("localizes every import stage and completion in %s", async (locale) => {
    language.locale = locale;
    const t = getTranslate(locale);
    state.importActivities = [
      { id: 1, fileName: "queued.epub", phase: "queued" },
      { id: 2, fileName: "narrated.epub", phase: "downloading" },
      { id: 3, fileName: "processing.epub", phase: "processing" },
      { id: 4, fileName: "saving.epub", phase: "saving" },
      { id: 5, fileName: "complete.epub", phase: "complete", bookId: "complete" },
    ];
    const title = "Original EPUB title";
    state.books = [{ id: "complete", title, identifiers: [] } as unknown as LibraryBookViewModel];
    await render();
    const status = container.querySelector('[role="status"]')!;
    expect(status.textContent).toContain(t("library.importQueued", { fileName: "queued.epub" }));
    expect(status.textContent).toContain(t("library.importDownloading", { fileName: "narrated.epub" }));
    expect(status.textContent).toContain(t("library.importProcessing", { fileName: "processing.epub" }));
    expect(status.textContent).toContain(t("library.importSaving", { fileName: "saving.epub" }));
    expect(status.textContent).toContain(t("library.importComplete", { fileName: title }));
    expect(status.textContent).not.toContain("complete.epub");
    expect(status.textContent).toContain(t("library.importKeepOpen"));
    expect(status.querySelector('[aria-valuenow]')).toBeNull();
    await act(async () => button(t("library.readNowBook", { title })).click());
    expect(state.openBook).toHaveBeenCalledExactlyOnceWith("complete");
    await act(async () => button(t("library.dismiss")).click());
    expect(state.dismissCompletedImports).toHaveBeenCalledOnce();
  });

  it("updates an open details pane, localized dates, progress and errors while preserving book data", async () => {
    const book = {
      id: "book", title: "Original title", creator: "Original author", publisher: "Original publisher",
      fileName: "original.epub", description: "Original description", progressFraction: 0.42,
      addedAt: new Date(2026, 8, 23).getTime(), identifiers: [],
    } as unknown as LibraryBookViewModel;
    state.books = [book];
    state.error = "Raw parser detail <tag>";
    await render();
    await act(async () => button("Original title details").click());
    language.locale = "de";
    await render();
    const t = getTranslate("de");
    expect(button(t("library.openBookProgress", { title: book.title, progress: formatLibraryProgress(0.42, "de") }))).toBeDefined();
    expect(container.textContent).toContain(t("bookDetails.publisher"));
    expect(container.textContent).toContain(t("library.percentRead", { progress: formatLibraryProgress(0.42, "de") }));
    expect(container.textContent).toContain("Original description");
    expect(container.textContent).toContain(t("error.somethingWentWrongHeadline"));
    expect(container.textContent).toContain("Raw parser detail <tag>");
    await act(async () => button(t("bookDetails.publicationDetails")).click());
    expect(container.textContent).toContain(new Date(book.addedAt).toLocaleDateString("de"));
    expect(container.textContent).toContain("original.epub");
  });

  it("localizes diagnostics status while keeping the copied support payload unchanged", async () => {
    language.locale = "fr";
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(navigator.clipboard, "writeText").mockImplementation(writeText);
    await render();
    const t = getTranslate("fr");
    await act(async () => button(t("about.title")).click());
    await act(async () => button(t("about.copyDiagnostics")).click());
    expect(button(t("about.copied"))).toBeDefined();
    expect(writeText.mock.calls[0]?.[0]).toContain("Ambra environment info\n");
    expect(writeText.mock.calls[0]?.[0]).toContain("Extension version: 1.2.3");
    expect(writeText.mock.calls[0]?.[0]).not.toContain("Original title");
    writeText.mockRejectedValueOnce(new Error("Permission denied <script>"));
    await act(async () => button(t("about.copied")).click());
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(`${t("about.copyError")} Permission denied <script>`);
    expect(container.querySelector('[role="alert"] script')).toBeNull();
  });
});

describe("Library catalog and number formatting", () => {
  it.each(SUPPORTED_LOCALES)("preserves translation placeholders for every Library/About key in %s", (locale) => {
    for (const key of Object.keys(CATALOGS.en).filter((key) => key.startsWith("library.") || key.startsWith("about.") || key.startsWith("shortcuts.") || key === "settings.helpAbout")) {
      const catalogKey = key as keyof typeof CATALOGS.en;
      const placeholders = (value: string) => value.match(/\{\w+\}/g)?.sort() ?? [];
      expect(placeholders(CATALOGS[locale][catalogKey]), catalogKey).toEqual(placeholders(CATALOGS.en[catalogKey]));
    }
  });
  it("uses localized decimal and percent formatting with binary byte scaling", () => {
    expect(formatLibraryBytes(1536, "en")).toContain("1.50");
    expect(formatLibraryBytes(1536, "de")).toContain("1,50");
    expect(formatLibraryProgress(0.425, "fr")).toBe(new Intl.NumberFormat("fr", { style: "percent", maximumFractionDigits: 0 }).format(0.425));
  });
});
