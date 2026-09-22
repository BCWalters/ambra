import { describe, expect, it } from "vitest";
import { classifyInspectionFile, guessMediaType } from "./inspectorFileKind.js";

describe("classifyInspectionFile", () => {
  it("classifies application/json as json", () => {
    expect(classifyInspectionFile("data.json", "application/json").category).toBe("json");
  });

  it("classifies application/ld+json (EPUB Annotations 1.0's declared media type, issue #117) as json, not binary", () => {
    const classification = classifyInspectionFile("annotations.json", "application/ld+json");
    expect(classification.category).toBe("json");
    expect(classification.isText).toBe(true);
    expect(classification.highlightLanguage).toBe("json");
  });

  it("classifies other +json structured-syntax suffixes as json too", () => {
    expect(classifyInspectionFile("data.json", "application/vnd.api+json").category).toBe("json");
  });

  it("classifies XHTML/OPF/NCX as markup", () => {
    expect(classifyInspectionFile("chapter1.xhtml", "application/xhtml+xml").category).toBe("markup");
    expect(classifyInspectionFile("content.opf", "application/oebps-package+xml").category).toBe("markup");
    expect(classifyInspectionFile("toc.ncx", "application/x-dtbncx+xml").category).toBe("markup");
  });

  it("classifies images/audio/video/fonts by media type prefix", () => {
    expect(classifyInspectionFile("cover.jpg", "image/jpeg").category).toBe("image");
    expect(classifyInspectionFile("narration.mp3", "audio/mpeg").category).toBe("audio");
    expect(classifyInspectionFile("clip.mp4", "video/mp4").category).toBe("video");
    expect(classifyInspectionFile("font.woff2", "font/woff2").category).toBe("font");
  });

  it("falls back to text for an unrecognized text/* media type", () => {
    expect(classifyInspectionFile("readme.txt", "text/plain").category).toBe("text");
  });

  it("falls back to binary for a genuinely unrecognized, non-text media type", () => {
    expect(classifyInspectionFile("archive.dat", "application/octet-stream").category).toBe("binary");
  });

  it("falls back to a file-extension guess when there's no manifest media type", () => {
    expect(classifyInspectionFile("META-INF/container.xml", undefined).category).toBe("markup");
    expect(classifyInspectionFile("notes.json", undefined).category).toBe("json");
  });

  it("treats a fully unrecognized, extensionless, non-manifest file as text", () => {
    expect(classifyInspectionFile("README", undefined).category).toBe("text");
  });
});

describe("guessMediaType", () => {
  it("prefers the manifest's declared media type over an extension guess", () => {
    expect(guessMediaType("weird.json", "application/ld+json")).toBe("application/ld+json");
  });

  it("falls back to an extension-based guess when there's no manifest media type", () => {
    expect(guessMediaType("data.json", undefined)).toBe("application/json");
  });

  it("returns undefined for an extensionless, non-manifest file", () => {
    expect(guessMediaType("README", undefined)).toBeUndefined();
  });
});
