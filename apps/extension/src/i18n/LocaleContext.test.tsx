import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider, useLocale } from "./LocaleContext.js";
import { SUPPORTED_LOCALES } from "./Locale.js";
import type { LibraryDatabase } from "../library/LibraryDatabase.js";

const database = vi.hoisted(() => ({
  getLocalePreference: vi.fn(),
  setLocalePreference: vi.fn(),
  subscribePreferences: vi.fn<LibraryDatabase["subscribePreferences"]>(() => vi.fn()),
  close: vi.fn(),
}));
vi.mock("../library/LibraryDatabase.js", () => ({
  LibraryDatabase: { open: vi.fn(async () => database) },
}));

let latest: ReturnType<typeof useLocale>;
function LanguagePicker() {
  latest = useLocale();
  const { setPreference } = latest;
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
    database.subscribePreferences.mockClear();
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

  it("updates from another page without writing back, and unsubscribes on unmount", async () => {
    await act(async () => root.render(<LocaleProvider><LanguagePicker /></LocaleProvider>));
    const writes = database.setLocalePreference.mock.calls.length;
    database.getLocalePreference.mockResolvedValue("de");
    await act(async () => database.subscribePreferences.mock.calls[0]![0]());
    expect(document.documentElement.lang).toBe("de");
    expect(database.setLocalePreference.mock.calls).toHaveLength(writes);
    act(() => root.render(null));
    expect(database.subscribePreferences.mock.results[0]!.value).toHaveBeenCalledOnce();
  });

  it("retains the saved locale and exposes storage failures without unhandled rejections", async () => {
    await act(async () => root.render(<LocaleProvider><LanguagePicker /></LocaleProvider>));
    database.setLocalePreference.mockRejectedValueOnce(new Error("Language save failed"));
    await act(async () => container.querySelector("button")!.click());
    expect(document.documentElement.lang).toBe("fr");
    expect(latest.error).toBe("Language save failed");
  });
});
