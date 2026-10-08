// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { PackageDocument } from "./PackageDocument.js";

function parse(language: string, direction?: string) {
  return PackageDocument.parse(
    `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id" xml:lang="en" dir="ltr">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:identifier id="id">urn:ambra:progression</dc:identifier><dc:title>English instructions</dc:title>
        <dc:language>${language}</dc:language>
      </metadata>
      <manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest>
      <spine${direction ? ` page-progression-direction="${direction}"` : ""}><itemref idref="chapter"/></spine>
    </package>`,
    "EPUB/package.opf",
  );
}

describe("effective page progression", () => {
  it.each(["ar", "ar-EG", "he", "fa", "ur", "az-Arab", "pa-Arab"])(
    "uses RTL for %s without confusing package text localization with publication language",
    (language) => {
      const pkg = parse(language);
      expect(pkg.pageProgressionDirection).toBe("default");
      expect(pkg.effectivePageProgressionDirection).toBe("rtl");
      expect(pkg.metadata.language).toBe(language);
      expect(pkg.metadata.localization?.package.direction).toBe("ltr");
    },
  );

  it.each(["en", "ja", "ar-Latn", "az-Latn", "pa-Guru", "und", "zz"])(
    "retains LTR for %s, including explicit script overrides",
    (language) => {
      expect(parse(language).effectivePageProgressionDirection).toBe("ltr");
    },
  );

  it("honors explicit directions and resolves explicit default like an absent attribute", () => {
    expect(parse("ar", "ltr").effectivePageProgressionDirection).toBe("ltr");
    expect(parse("en", "rtl").effectivePageProgressionDirection).toBe("rtl");
    expect(parse("ar", "default").effectivePageProgressionDirection).toBe("rtl");
    expect(parse("ar", "unknown").effectivePageProgressionDirection).toBe("rtl");
  });

  it("preserves opening invalid language metadata with an explicit diagnostic, once per package", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const pkg = parse("not_a_language");
      expect(pkg.effectivePageProgressionDirection).toBe("ltr");
      expect(pkg.effectivePageProgressionDirection).toBe("ltr");
      expect(warn).toHaveBeenCalledExactlyOnceWith(
        expect.stringContaining("Invalid publication language"),
      );
      expect(parse("not_a_language", "rtl").effectivePageProgressionDirection).toBe("rtl");
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });
});
