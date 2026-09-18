import { describe, expect, it } from "vitest";
import { CfiStep, EpubCfi, EpubCfiParseError } from "./EpubCfi.js";

describe("CfiStep", () => {
  it("serializes without an id assertion", () => {
    expect(new CfiStep(4).toString()).toBe("/4");
  });

  it("serializes with an id assertion", () => {
    expect(new CfiStep(4, "chap01").toString()).toBe("/4[chap01]");
  });
});

describe("EpubCfi.parse / toString round-trip", () => {
  it("parses a simple point CFI with package and content steps", () => {
    const cfi = EpubCfi.parse("epubcfi(/6/4!/4/2/2/1:3)");

    expect(cfi.packageSteps.map((s) => s.index)).toEqual([6, 4]);
    expect(cfi.contentSteps.map((s) => s.index)).toEqual([4, 2, 2, 1]);
    expect(cfi.characterOffset).toBe(3);
  });

  it("round-trips toString back to an equivalent parseable string", () => {
    const original = "epubcfi(/6/4[chap01ref]!/4/2/2/1:3)";
    const cfi = EpubCfi.parse(original);

    expect(cfi.toString()).toBe(original);
  });

  it("parses id assertions on individual steps", () => {
    const cfi = EpubCfi.parse("epubcfi(/6/4[chap01ref]!/4[body01]/2:0)");

    expect(cfi.packageSteps[1]?.idAssertion).toBe("chap01ref");
    expect(cfi.contentSteps[0]?.idAssertion).toBe("body01");
  });

  it("parses a CFI with no character offset", () => {
    const cfi = EpubCfi.parse("epubcfi(/6/4!/4/2)");

    expect(cfi.characterOffset).toBeUndefined();
    expect(cfi.toString()).toBe("epubcfi(/6/4!/4/2)");
  });

  it("parses an explicit :0 offset as 0, not undefined", () => {
    const cfi = EpubCfi.parse("epubcfi(/6/4!/4/2:0)");

    expect(cfi.characterOffset).toBe(0);
    expect(cfi.toString()).toBe("epubcfi(/6/4!/4/2:0)");
  });

  it("tolerates leading/trailing whitespace around the whole CFI string", () => {
    const cfi = EpubCfi.parse("  epubcfi(/6/4!/4/2:3)  ");

    expect(cfi.characterOffset).toBe(3);
  });

  it("strips a trailing side-bias parameter from an id assertion", () => {
    const cfi = EpubCfi.parse("epubcfi(/6/4!/4/2[;s=b])");

    expect(cfi.contentSteps[1]?.idAssertion).toBeUndefined();
  });

  it("throws EpubCfiParseError when missing the epubcfi(...) wrapper", () => {
    expect(() => EpubCfi.parse("/6/4!/4/2")).toThrow(EpubCfiParseError);
  });

  it("throws EpubCfiParseError when missing the '!' indirection", () => {
    expect(() => EpubCfi.parse("epubcfi(/6/4/4/2)")).toThrow(EpubCfiParseError);
  });

  it("throws EpubCfiParseError for malformed step syntax", () => {
    expect(() => EpubCfi.parse("epubcfi(/6/abc!/4/2)")).toThrow(EpubCfiParseError);
  });

  it("throws EpubCfiParseError when package or content steps are empty", () => {
    expect(() => EpubCfi.parse("epubcfi(!/4/2)")).toThrow(EpubCfiParseError);
    expect(() => EpubCfi.parse("epubcfi(/6/4!)")).toThrow(EpubCfiParseError);
  });
});

describe("EpubCfi.compare", () => {
  it("orders by spine item (package steps) first", () => {
    const earlierSpine = "epubcfi(/6/4!/4/2/1:50)";
    const laterSpine = "epubcfi(/6/6!/4/2/1:0)";

    expect(EpubCfi.compare(earlierSpine, laterSpine)).toBeLessThan(0);
    expect(EpubCfi.compare(laterSpine, earlierSpine)).toBeGreaterThan(0);
  });

  it("orders by content steps within the same spine item", () => {
    const earlierInChapter = "epubcfi(/6/4!/4/2/1:0)";
    const laterInChapter = "epubcfi(/6/4!/4/2/3:0)";

    expect(EpubCfi.compare(earlierInChapter, laterInChapter)).toBeLessThan(0);
  });

  it("orders by character offset when the content steps are identical", () => {
    const earlierOffset = "epubcfi(/6/4!/4/2/1:5)";
    const laterOffset = "epubcfi(/6/4!/4/2/1:50)";

    expect(EpubCfi.compare(earlierOffset, laterOffset)).toBeLessThan(0);
  });

  it("treats a shorter content-step prefix as earlier than a longer, more specific descendant", () => {
    // /4/2 names an ancestor element of /4/2/1 — a position "at" that
    // ancestor reads as coming before a position further down inside it.
    const ancestor = "epubcfi(/6/4!/4/2:0)";
    const descendant = "epubcfi(/6/4!/4/2/1:0)";

    expect(EpubCfi.compare(ancestor, descendant)).toBeLessThan(0);
  });

  it("returns 0 for two identical CFIs", () => {
    const cfi = "epubcfi(/6/4!/4/2/1:5)";

    expect(EpubCfi.compare(cfi, cfi)).toBe(0);
  });

  it("is usable directly as an Array.prototype.sort comparator", () => {
    const cfis = ["epubcfi(/6/6!/4/2:0)", "epubcfi(/6/4!/4/8:0)", "epubcfi(/6/4!/4/2:0)"];

    expect([...cfis].sort(EpubCfi.compare)).toEqual([
      "epubcfi(/6/4!/4/2:0)",
      "epubcfi(/6/4!/4/8:0)",
      "epubcfi(/6/6!/4/2:0)",
    ]);
  });
});
