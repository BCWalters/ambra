import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider, useLocale } from "./LocaleContext.js";
import { SUPPORTED_LOCALES } from "./Locale.js";

const database = vi.hoisted(() => ({
  getLocalePreference: vi.fn(),
  setLocalePreference: vi.fn(),
  close: vi.fn(),
}));
vi.mock("../library/LibraryDatabase.js", () => ({
  LibraryDatabase: { open: vi.fn(async () => database) },
}));

function LanguagePicker() {
  const { setPreference } = useLocale();
  return <button onClick={() => setPreference("ja")}>Japanese</button>;
}

describe("LocaleProvider shell language", () => {
  let root: Root;
  let container: HTMLDivElement;
  let originalLanguage: string;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["fr-CA", "en"]);
    originalLanguage = document.documentElement.lang;
    document.documentElement.lang = "en";
    database.getLocalePreference.mockResolvedValue(undefined);
    database.setLocalePreference.mockResolvedValue(undefined);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.documentElement.lang = originalLanguage;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("uses the system locale and updates when the reader selects another language", async () => {
    await act(async () => root.render(<LocaleProvider><LanguagePicker /></LocaleProvider>));
    expect(document.documentElement.lang).toBe("fr");
    await act(async () => container.querySelector("button")!.click());
    expect(document.documentElement.lang).toBe("ja");
    expect(database.setLocalePreference).toHaveBeenCalledWith("ja");
  });

  it.each(SUPPORTED_LOCALES)("applies persisted %s to the shell without changing the book language", async (locale) => {
    database.getLocalePreference.mockResolvedValue(locale);
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    const bookDocument = iframe.contentDocument!;
    bookDocument.documentElement.lang = "it";
    try {
      await act(async () => root.render(<LocaleProvider><LanguagePicker /></LocaleProvider>));
      expect(document.documentElement.lang).toBe(locale);
      expect(bookDocument.documentElement.lang).toBe("it");
    } finally {
      iframe.remove();
    }
  });
});
