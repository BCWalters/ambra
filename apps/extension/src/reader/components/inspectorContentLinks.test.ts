import { describe, expect, it } from "vitest";
import { resolveNavigableLinkTarget } from "./inspectorContentLinks.js";

describe("Inspector source links with HTML bases", () => {
  const files = new Set(["EPUB/text/chapter.xhtml", "EPUB/assets/image.png", "EPUB/text/next.xhtml"]);

  it("resolves resources and fragment-only links against the base, not the source filename", () => {
    expect(resolveNavigableLinkTarget("EPUB/text/chapter.xhtml", "image.png", files, "../assets/"))
      .toBe("EPUB/assets/image.png");
    expect(resolveNavigableLinkTarget("EPUB/text/chapter.xhtml", "#target", files, "next.xhtml"))
      .toBe("EPUB/text/next.xhtml");
    expect(resolveNavigableLinkTarget("EPUB/text/chapter.xhtml", "#target", files)).toBeUndefined();
  });

  it.each(["https://base.invalid/assets/", "file:///private/assets/", "mailto:reader@example.test"])(
    "never offers an archive jump for a relative URL under %s",
    base => {
      expect(resolveNavigableLinkTarget("EPUB/text/chapter.xhtml", "image.png", files, base)).toBeUndefined();
    },
  );

  it("does not invent missing archive files", () => {
    expect(resolveNavigableLinkTarget("EPUB/text/chapter.xhtml", "missing.png", files, "../assets/")).toBeUndefined();
  });
});
