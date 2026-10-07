import { describe, expect, it } from "vitest";
import { formatLibraryBookCount } from "./LibraryFormatting.js";
import { getTranslate } from "../i18n/translate.js";
import { SUPPORTED_LOCALES } from "../i18n/Locale.js";

describe("Library book-count cardinality", () => {
  it.each([[0, "0 books"], [1, "1 book"], [2, "2 books"], [21, "21 books"], [1000, "1,000 books"]])(
    "formats English count %s as %s", (count, expected) => {
      expect(formatLibraryBookCount(Number(count), "en", getTranslate("en"))).toBe(expected);
    },
  );
  it.each([[0, "0 книг"], [1, "1 книга"], [2, "2 книги"], [5, "5 книг"], [21, "21 книга"], [22, "22 книги"], [25, "25 книг"]])(
    "uses Russian cardinal forms for %s", (count, expected) => {
      expect(formatLibraryBookCount(Number(count), "ru", getTranslate("ru"))).toBe(expected);
    },
  );
  it.each(SUPPORTED_LOCALES)("formats zero, one and many without unresolved placeholders in %s", locale => {
    for (const count of [0, 1, 2, 5, 21, 1000]) {
      const result = formatLibraryBookCount(count, locale, getTranslate(locale));
      expect(result).toContain(new Intl.NumberFormat(locale).format(count));
      expect(result).not.toContain("{");
    }
  });
});
