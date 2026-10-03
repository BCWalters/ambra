import { buildInspectorSourceMap, InspectorSourceMappingError } from "./InspectorSourceMap.js";
import type { InspectorSourceElement } from "./InspectorSourceMap.js";
import type { InspectorSourcePoint, InspectorVisiblePage } from "./ReaderTypes.js";

export interface InspectorPageMarker {
  readonly page: InspectorVisiblePage;
  readonly edge: "start" | "end";
  readonly offset: number;
  readonly line: number;
  readonly column: number;
}

function fail(reason: string): never {
  throw new InspectorSourceMappingError(`Cannot map page boundary: ${reason}`);
}

function samePath(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function decodedOffset(text: string, offset: number): number {
  let decoded = 0;
  let index = 0;
  while (index < text.length && decoded < offset) {
    if (text[index] === "&") {
      const entity = /^&(?:amp|lt|gt|quot|apos|#(\d+)|#x([\da-fA-F]+));/.exec(text.slice(index));
      if (!entity) fail("unsupported entity.");
      const codePoint = entity[1] ? Number(entity[1]) : entity[2] ? Number.parseInt(entity[2], 16) : 0;
      const length = codePoint > 0xffff ? 2 : 1;
      if (decoded + length > offset) fail("boundary splits an encoded Unicode character.");
      decoded += length;
      index += entity[0].length;
    } else {
      decoded += 1;
      index += 1;
    }
  }
  if (decoded !== offset) fail("text offset exceeds source text.");
  return index;
}

/** Map child-node boundaries without changing original whitespace or entity spelling. */
export function inspectorSourcePointOffset(
  text: string, elements: readonly InspectorSourceElement[], point: InspectorSourcePoint,
): number {
  const source = elements.find(element => samePath(element.elementPath, point.elementPath));
  if (!source) fail("source element is missing.");
  if (point.childIndex === undefined) {
    if (point.textOffset !== undefined) fail("text position has no child index.");
    return source.start;
  }
  if (!Number.isInteger(point.childIndex) || point.childIndex < 0 ||
      (point.textOffset !== undefined && (!Number.isInteger(point.textOffset) || point.textOffset < 0))) {
    fail("invalid source position.");
  }
  const children = elements.filter(element => element.elementPath.length === point.elementPath.length + 1 &&
    samePath(element.elementPath.slice(0, -1), point.elementPath));
  let index = source.openingEnd;
  let childIndex = 0;
  while (index < source.end && !text.startsWith("</", index)) {
    const child = children.find(element => element.start === index);
    let end: number;
    let contentStart = index;
    let contentEnd: number;
    let isText = false;
    let cdata = false;
    if (child) {
      end = child.end;
      contentEnd = end;
    } else if (text.startsWith("<!--", index) || text.startsWith("<?", index)) {
      const closing = text.startsWith("<!--", index) ? "-->" : "?>";
      end = text.indexOf(closing, index) + closing.length;
      contentEnd = end;
    } else if (text.startsWith("<![CDATA[", index)) {
      contentStart = index + 9;
      contentEnd = text.indexOf("]]>", contentStart);
      end = contentEnd + 3;
      isText = true;
      cdata = true;
    } else {
      if (text[index] === "<") fail("unrecognized child node.");
      const next = text.indexOf("<", index);
      end = next === -1 ? source.end : next;
      contentEnd = end;
      isText = true;
    }
    if (end <= index || end > source.end) fail("invalid child source range.");
    if (childIndex === point.childIndex) {
      if (point.textOffset === undefined) return index;
      if (!isText) fail("text boundary points at a non-text node.");
      const content = text.slice(contentStart, contentEnd);
      if (cdata) {
        if (point.textOffset > content.length) fail("CDATA offset exceeds source text.");
        return contentStart + point.textOffset;
      }
      return contentStart + decodedOffset(content, point.textOffset);
    }
    childIndex += 1;
    index = end;
  }
  if (childIndex !== point.childIndex || point.textOffset !== undefined) fail("child index exceeds source children.");
  return index;
}

export function mapInspectorPageMarkers(text: string, pages: readonly InspectorVisiblePage[]): readonly InspectorPageMarker[] {
  const elements = buildInspectorSourceMap(text);
  return pages.flatMap(page => (["start", "end"] as const).map(edge => {
    const offset = inspectorSourcePointOffset(text, elements, page[edge]);
    const prefix = text.slice(0, offset);
    return {
      page, edge, offset,
      line: prefix.split("\n").length,
      column: offset - prefix.lastIndexOf("\n"),
    };
  }));
}
