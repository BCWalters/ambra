import type { Locale } from "../i18n/Locale.js";
import type { BookMetadata } from "./LibraryDatabase.js";

function fold(value: string, locale: Locale): string {
  // Lowercase first so both forms of German sharp s expand consistently.
  return value.normalize("NFKD").toLocaleLowerCase(locale).toLocaleUpperCase(locale)
    .replace(/(\p{Script=Latin})\p{M}+/gu, "$1").normalize("NFC");
}

export function filterLibraryBooks<T extends Pick<BookMetadata, "title" | "creator">>(
  books: readonly T[], query: string, locale: Locale,
): readonly T[] {
  const terms = fold(query, locale).trim().split(/\s+/u).filter(Boolean);
  if (terms.length === 0) return books;
  return books.filter((book) => {
    const metadata = fold(`${book.title} ${book.creator ?? ""}`, locale);
    return terms.every((term) => metadata.includes(term));
  });
}
