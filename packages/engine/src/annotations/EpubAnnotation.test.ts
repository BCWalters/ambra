import { describe, expect, it } from "vitest";
import {
  AnnotationParseError,
  parseAnnotationCollection,
  serializeAnnotationCollection,
} from "./EpubAnnotation.js";
import type { EpubAnnotation } from "./EpubAnnotation.js";

const validAnnotation: EpubAnnotation = {
  id: "urn:uuid:11111111-1111-1111-1111-111111111111",
  type: "Annotation",
  motivation: "highlighting",
  created: "2024-01-01T00:00:00.000Z",
  target: {
    source: "chapter1.xhtml",
    selector: [
      {
        type: "FragmentSelector",
        value: "epubcfi(/6/4!/4/2/1,:3,:10)",
        conformsTo: "https://www.w3.org/publishing/epub-cfi/",
      },
    ],
  },
};

describe("parseAnnotationCollection", () => {
  it("parses a bare array of annotations (this reader's own export shape)", () => {
    const json = JSON.stringify([validAnnotation]);
    const parsed = parseAnnotationCollection(json);

    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.id).toBe(validAnnotation.id);
    expect(parsed[0]?.target.source).toBe("chapter1.xhtml");
    expect(parsed[0]?.target.selector?.[0]).toEqual({
      type: "FragmentSelector",
      value: "epubcfi(/6/4!/4/2/1,:3,:10)",
      conformsTo: "https://www.w3.org/publishing/epub-cfi/",
    });
  });

  it("parses a single bare Annotation object", () => {
    const parsed = parseAnnotationCollection(JSON.stringify(validAnnotation));
    expect(parsed).toHaveLength(1);
  });

  it("parses a W3C-style collection wrapper with an items array", () => {
    const json = JSON.stringify({ type: "AnnotationCollection", items: [validAnnotation] });
    const parsed = parseAnnotationCollection(json);
    expect(parsed).toHaveLength(1);
  });

  it("parses a bookmarking annotation with no selector at all (targets the whole resource)", () => {
    const bookmark: EpubAnnotation = {
      id: "urn:uuid:22222222-2222-2222-2222-222222222222",
      type: "Annotation",
      motivation: "bookmarking",
      created: "2024-01-01T00:00:00.000Z",
      target: { source: "chapter2.xhtml" },
    };
    const parsed = parseAnnotationCollection(JSON.stringify([bookmark]));
    expect(parsed[0]?.target.selector).toBeUndefined();
  });

  it("parses a commenting annotation with a TextualBody note", () => {
    const commented: EpubAnnotation = {
      ...validAnnotation,
      motivation: "commenting",
      body: { type: "TextualBody", format: "text/plain", value: "This is my note." },
    };
    const parsed = parseAnnotationCollection(JSON.stringify([commented]));
    expect(parsed[0]?.body).toEqual({
      type: "TextualBody",
      format: "text/plain",
      value: "This is my note.",
    });
  });

  it("silently skips a malformed entry without throwing (one bad entry doesn't sink the import)", () => {
    const malformed = { id: "bad", type: "Annotation" }; // missing required `created`/`target`
    const parsed = parseAnnotationCollection(JSON.stringify([validAnnotation, malformed]));
    expect(parsed).toHaveLength(1);
  });

  it("preserves a foreign CssSelector/TextPositionSelector structurally, even though this reader can't resolve them", () => {
    const foreign: EpubAnnotation = {
      ...validAnnotation,
      target: { source: "chapter1.xhtml", selector: [{ type: "CssSelector", value: "#para3" }] },
    };
    const parsed = parseAnnotationCollection(JSON.stringify([foreign]));
    expect(parsed[0]?.target.selector?.[0]).toEqual({ type: "CssSelector", value: "#para3" });
  });

  it("throws AnnotationParseError for invalid JSON", () => {
    expect(() => parseAnnotationCollection("{not json")).toThrow(AnnotationParseError);
  });

  it("throws AnnotationParseError for a JSON value that isn't a list or a single Annotation", () => {
    expect(() => parseAnnotationCollection(JSON.stringify({ foo: "bar" }))).toThrow(
      AnnotationParseError,
    );
  });
});

describe("serializeAnnotationCollection", () => {
  it("round-trips through parseAnnotationCollection", () => {
    const json = serializeAnnotationCollection([validAnnotation]);
    const parsed = parseAnnotationCollection(json);
    expect(parsed).toEqual([validAnnotation]);
  });
});
