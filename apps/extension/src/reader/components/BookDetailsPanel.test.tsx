import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BookDetails } from "../ReaderTypes.js";
import { BookDetailsPanel } from "./BookDetailsPanel.js";
import { SUPPORTED_LOCALES, type Locale } from "../../i18n/Locale.js";
import { getTranslate } from "../../i18n/translate.js";
import { formatLibraryBytes } from "../../library/LibraryFormatting.js";

const language = vi.hoisted(() => ({ locale: "en" as Locale }));
vi.mock("../../i18n/LocaleContext.js", async importOriginal => {
  const actual = await importOriginal<typeof import("../../i18n/LocaleContext.js")>();
  return {
    ...actual,
    useTranslation: () => actual.getTranslate(language.locale),
    useLocale: () => ({ locale: language.locale }),
  };
});

describe("Book Details publication metadata", () => {
  let root: Root;
  let container: HTMLDivElement;
  let details: BookDetails;
  const onOpenHelp = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const animate = Element.prototype.animate;
    vi.spyOn(Element.prototype, "animate").mockImplementation(function (this: Element, keyframes, options) {
      const animation = animate.call(this, keyframes, options);
      queueMicrotask(() => animation.finish());
      return animation;
    });
    language.locale = "en";
    onOpenHelp.mockClear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    details = {
      title: "A book without identifiers",
      creator: undefined,
      description: "An original description.\nWith a second line.",
      descriptionSourceName: undefined,
      descriptionSourceUrl: undefined,
      publisher: undefined,
      language: "en",
      identifiers: [],
      fileName: "book.epub",
      fileSizeBytes: 1536,
      rights: undefined,
      coverUrl: undefined,
      accessibility: {
        accessModes: [], accessibilityFeatures: [], accessibilityHazards: [],
        accessibilitySummary: undefined,
      },
    };
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  async function render({ loading = false, fixedLayout = false }: { loading?: boolean; fixedLayout?: boolean } = {}) {
    await act(async () => root.render(
      <BookDetailsPanel open details={loading ? undefined : details} onRequestClose={vi.fn()} onOpenInspector={vi.fn()}
        onOpenHelp={onOpenHelp}
        scrubberVisible={false} isPaginated isFixedLayout={fixedLayout} bookPageCount={10} onSeekToFraction={vi.fn()} />,
    ));
  }

  it.each(SUPPORTED_LOCALES)("shows localized file size even without identifiers in %s", async locale => {
    language.locale = locale;
    await render();
    const t = getTranslate(locale);
    const disclosure = [...container.querySelectorAll("button")]
      .find(button => button.textContent === t("bookDetails.publicationDetails"))!;
    expect(disclosure).toBeDefined();
    await act(async () => disclosure.click());
    expect(container.textContent).toContain(t("bookDetails.fileSize"));
    expect(container.textContent).toContain(formatLibraryBytes(1536, locale));
    const help = [...container.querySelectorAll("button")].find(button => button.textContent === t("about.title"))!;
    expect(help).toBeDefined();
    await act(async () => help.click());
    expect(onOpenHelp).toHaveBeenCalledWith(help);
  });

  it.each([{ loading: true }, { fixedLayout: true }])("keeps Help available with %j", async options => {
    await render(options);
    const help = [...container.querySelectorAll("button")].find(button => button.textContent === "Help & About")!;
    expect(help).toBeDefined();
    await act(async () => help.click());
    expect(onOpenHelp).toHaveBeenCalledWith(help);
  });

  it("does not invent a file size when none is available", async () => {
    details = { ...details, fileSizeBytes: undefined };
    await render();
    expect(container.textContent).not.toContain("EPUB file size");
    expect(container.textContent).not.toContain("Publication details");
  });

  it("keeps the full description and attribution with smaller, comfortably spaced text", async () => {
    details = { ...details, descriptionSourceName: "Open Library", descriptionSourceUrl: "https://openlibrary.org/" };
    await render();
    const paragraph = [...container.querySelectorAll("p")]
      .find(node => node.textContent === details.description)!;
    expect(paragraph.classList.contains("fui-Caption1")).toBe(true);
    expect(paragraph.style.lineHeight).toBe("1.5");
    expect(paragraph.style.whiteSpace).toBe("pre-wrap");
    expect(container.querySelector('a[href="https://openlibrary.org/"]')?.textContent).toBe("Open Library");
  });
});
