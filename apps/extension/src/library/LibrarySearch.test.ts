import { describe, expect, it } from "vitest";
import { filterLibraryBooks } from "./LibrarySearch.js";

describe("local library metadata search", () => {
  const books = [
    { title: "Voyage au centre de la Terre", creator: "Jules Verne" },
    { title: "Émile", creator: "Jean-Jacques Rousseau" },
    { title: "A Nameless Tale", creator: undefined },
    { title: "Straße", creator: "An Author" },
  ];

  it("preserves the sorted list and object identities without changing metadata", () => {
    expect(filterLibraryBooks(books, "", "en")).toBe(books);
    expect(filterLibraryBooks(books, " \n\t ", "en")).toBe(books);
    const result = filterLibraryBooks(books, "a", "en");
    expect(result).toEqual(books);
    expect(result.every((book, index) => book === books[index])).toBe(true);
    expect(books[1]?.title).toBe("Émile");
  });

  it("matches every whitespace-separated term across title and author in any order", () => {
    expect(filterLibraryBooks(books, "  VERNE \t centre ", "fr")).toEqual([books[0]]);
    expect(filterLibraryBooks(books, "rousseau emi", "fr")).toEqual([books[1]]);
    expect(filterLibraryBooks(books, "verne emile", "fr")).toEqual([]);
    expect(filterLibraryBooks(books, "nameless", "en")).toEqual([books[2]]);
    expect(filterLibraryBooks(books, "undefined", "en")).toEqual([]);
  });

  it("folds Latin accents, canonical variants, case and German sharp s", () => {
    expect(filterLibraryBooks(books, "e\u0301MILE", "fr")).toEqual([books[1]]);
    expect(filterLibraryBooks(books, "strasse", "de")).toEqual([books[3]]);
    expect(filterLibraryBooks(books, "STRAẞE", "de")).toEqual([books[3]]);
    expect(filterLibraryBooks([{ title: "E\u0301mile", creator: undefined }], "émile", "fr")).toHaveLength(1);
  });

  it("keeps non-Latin distinctions while supporting CJK and Cyrillic substrings", () => {
    const titles = ["がく", "かく", "한국 문학", "Русская книга", "中文书籍", "ガク"];
    const entries = titles.map((title) => ({ title, creator: undefined }));
    expect(filterLibraryBooks(entries, "が", "ja")).toEqual([entries[0]]);
    expect(filterLibraryBooks(entries, "か", "ja")).toEqual([entries[1]]);
    expect(filterLibraryBooks(entries, "국", "ko")).toEqual([entries[2]]);
    expect(filterLibraryBooks(entries, "русская", "ru")).toEqual([entries[3]]);
    expect(filterLibraryBooks(entries, "书籍", "zh")).toEqual([entries[4]]);
    expect(filterLibraryBooks(entries, "ｶﾞｸ", "ja")).toEqual([entries[5]]);
  });

  it("treats punctuation literally and does not inspect filenames or book contents", () => {
    expect(filterLibraryBooks(books, ".*", "en")).toEqual([]);
    expect(filterLibraryBooks(books, "[", "en")).toEqual([]);
    const entry = { title: "Local book", creator: undefined, fileName: "private.epub", text: "secret contents" };
    expect(filterLibraryBooks([entry], "private", "en")).toEqual([]);
    expect(filterLibraryBooks([entry], "secret", "en")).toEqual([]);
    expect(filterLibraryBooks([entry], "local", "en")).toEqual([entry]);
  });
});
