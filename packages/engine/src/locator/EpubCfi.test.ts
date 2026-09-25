import { describe, expect, it } from "vitest";
import { CfiStep, EpubCfi, EpubCfiParseError } from "./EpubCfi.js";

describe("CfiStep", () => {
  it("serializes without an id assertion", () => {
    expect(new CfiStep(4).toString()).toBe("/4");
  });

  it("serializes with an id assertion", () => {
    expect(new CfiStep(4, "chap01").toString()).toBe("/4[chap01]");
  });

  it("escapes reserved assertion characters", () => {
    expect(new CfiStep(4, "a^b[c](d),e;f=g").toString()).toBe(
      "/4[a^^b^[c^]^(d^)^,e^;f^=g]",
    );
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

  it("distinguishes an escaped semicolon in an ID from a side-bias parameter", () => {
    const cfi = EpubCfi.parse("epubcfi(/6/4!/4/2[a^;b;s=b])");

    expect(cfi.contentSteps[1]?.idAssertion).toBe("a;b");
    expect(cfi.toString()).toBe("epubcfi(/6/4!/4/2[a^;b])");
  });

  it.each(["a]b", "a[b", "a^b", "a;b", "a,b", "a(b)", "a=b", "a!b", "a/b", "a:b"])(
    "round-trips package and content assertions containing %s",
    (id) => {
      const original = new EpubCfi(
        [new CfiStep(6), new CfiStep(4, id)],
        [new CfiStep(4, id), new CfiStep(1)],
        3,
      );

      const parsed = EpubCfi.parse(original.toString());

      expect(parsed.packageSteps[1]?.idAssertion).toBe(id);
      expect(parsed.contentSteps[0]?.idAssertion).toBe(id);
      expect(parsed.characterOffset).toBe(3);
      expect(parsed.toString()).toBe(original.toString());
    },
  );

  it.each([
    "epubcfi(/6/4!/4[a^x])",
    "epubcfi(/6/4!/4[a^])",
    "epubcfi(/6/4!/4[a][b])",
    "epubcfi(/6/4!/4[a[b]])",
    "epubcfi(/6/4!/4[a]])",
    "epubcfi(/6/4!/4/1:)",
    "epubcfi(/6/4!/4/1:1:2)",
    "epubcfi(/6/4!/4!/2)",
    "epubcfi(/6/9007199254740992!/4)",
    "epubcfi(/6/4!/4/1:9007199254740992)",
  ])("rejects malformed or unsupported point syntax %s", (value) => {
    expect(() => EpubCfi.parse(value)).toThrow(EpubCfiParseError);
  });

  it("throws EpubCfiParseError when missing the epubcfi(...) wrapper", () => {
    expect(() => EpubCfi.parse("/6/4!/4/2")).toThrow(EpubCfiParseError);
  });

  it("round-trips a spine itemref location without an empty indirection", () => {
    const cfi = EpubCfi.parse("epubcfi(/6/4[page])");
    expect(cfi.packageSteps.map(step => step.index)).toEqual([6, 4]);
    expect(cfi.contentSteps).toEqual([]);
    expect(cfi.characterOffset).toBeUndefined();
    expect(cfi.toString()).toBe("epubcfi(/6/4[page])");
  });

  it("does not invent a character offset on a spine itemref", () => {
    expect(() => EpubCfi.parse("epubcfi(/6/4:0)")).toThrow(EpubCfiParseError);
    expect(() => new EpubCfi([new CfiStep(6), new CfiStep(4)], [], 0).toString())
      .toThrow(EpubCfiParseError);
  });

  it("throws EpubCfiParseError for malformed step syntax", () => {
    expect(() => EpubCfi.parse("epubcfi(/6/abc!/4/2)")).toThrow(EpubCfiParseError);
  });

  it("throws EpubCfiParseError when package or content steps are empty", () => {
    expect(() => EpubCfi.parse("epubcfi(!/4/2)")).toThrow(EpubCfiParseError);
    expect(() => EpubCfi.parse("epubcfi(/6/4!)")).toThrow(EpubCfiParseError);
    expect(() => EpubCfi.parse("epubcfi()")).toThrow(EpubCfiParseError);
  });
});

describe("EpubCfi.compare", () => {
  it("orders a spine itemref before locations inside its content", () => {
    expect(EpubCfi.compare("epubcfi(/6/4)", "epubcfi(/6/4!/2)")).toBeLessThan(0);
    expect(EpubCfi.compare("epubcfi(/6/4!/2)", "epubcfi(/6/6)")).toBeLessThan(0);
  });
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

describe("EpubCfi.joinRange / parseRange", () => {
  it("rejects a whole-document itemref as a content-range endpoint", () => {
    expect(() => EpubCfi.joinRange(
      EpubCfi.parse("epubcfi(/6/4)"), EpubCfi.parse("epubcfi(/6/4!/2/1:3)"),
    )).toThrow(EpubCfiParseError);
  });

  it("joins two point CFIs sharing a content-step prefix into a range CFI", () => {
    const start = EpubCfi.parse("epubcfi(/6/4!/4/2/1:3)");
    const end = EpubCfi.parse("epubcfi(/6/4!/4/2/1:10)");

    expect(EpubCfi.joinRange(start, end)).toBe("epubcfi(/6/4!/4/2/1,:3,:10)");
  });

  it("joins two points that diverge at an earlier element into separate tails", () => {
    const start = EpubCfi.parse("epubcfi(/6/4!/4/2/1:3)");
    const end = EpubCfi.parse("epubcfi(/6/4!/4/6/1:1)");

    expect(EpubCfi.joinRange(start, end)).toBe("epubcfi(/6/4!/4,/2/1:3,/6/1:1)");
  });

  it("preserves id assertions in the common prefix", () => {
    const start = EpubCfi.parse("epubcfi(/6/4[chap01ref]!/4[body01]/2/1:0)");
    const end = EpubCfi.parse("epubcfi(/6/4[chap01ref]!/4[body01]/2/3:2)");

    expect(EpubCfi.joinRange(start, end)).toBe("epubcfi(/6/4[chap01ref]!/4[body01]/2,/1:0,/3:2)");
  });

  it("throws when joining two points from different spine items", () => {
    const start = EpubCfi.parse("epubcfi(/6/4!/4/2/1:3)");
    const end = EpubCfi.parse("epubcfi(/6/6!/4/2/1:3)");

    expect(() => EpubCfi.joinRange(start, end)).toThrow(EpubCfiParseError);
  });

  it("round-trips joinRange through parseRange back to the original two points", () => {
    const start = EpubCfi.parse("epubcfi(/6/4[chap01ref]!/4[body01]/2/1:3)");
    const end = EpubCfi.parse("epubcfi(/6/4[chap01ref]!/4[body01]/6/1:10)");

    const rangeCfi = EpubCfi.joinRange(start, end);
    const parsed = EpubCfi.parseRange(rangeCfi);

    expect(parsed.start.toString()).toBe(start.toString());
    expect(parsed.end.toString()).toBe(end.toString());
  });

  it("ignores escaped brackets and commas when splitting a range", () => {
    const packageSteps = [new CfiStep(6), new CfiStep(4, "chapter!one")];
    const sharedStep = new CfiStep(4, "body],^");
    const start = new EpubCfi(packageSteps, [sharedStep, new CfiStep(2, "p[one"), new CfiStep(1)], 0);
    const end = new EpubCfi(packageSteps, [sharedStep, new CfiStep(4, "p;two"), new CfiStep(1)], 5);

    const parsed = EpubCfi.parseRange(EpubCfi.joinRange(start, end));

    expect(parsed.start.toString()).toBe(start.toString());
    expect(parsed.end.toString()).toBe(end.toString());
  });

  it("round-trips same-node range offsets with escaped assertions", () => {
    const start = new EpubCfi([new CfiStep(6), new CfiStep(2)], [
      new CfiStep(4, "p],one"),
      new CfiStep(1),
    ], 2);
    const end = new EpubCfi(start.packageSteps, start.contentSteps, 5);

    const parsed = EpubCfi.parseRange(EpubCfi.joinRange(start, end));

    expect(parsed.start.toString()).toBe(start.toString());
    expect(parsed.end.toString()).toBe(end.toString());
  });

  it("throws parsing a range CFI missing the second comma", () => {
    expect(() => EpubCfi.parseRange("epubcfi(/6/4!/4/2,/1:3)")).toThrow(EpubCfiParseError);
  });

  it("throws parsing a range CFI without the epubcfi(...) wrapper", () => {
    expect(() => EpubCfi.parseRange("/6/4!/4/2,/1:3,/3:5")).toThrow(EpubCfiParseError);
  });
});
