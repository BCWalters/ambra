import { resolveEpubPath } from "@ambra/engine";
import { buildInspectorSourceMap, InspectorSourceMappingError, type InspectorSourceElement } from "./InspectorSourceMap.js";

export interface InspectorReference {
  readonly sourcePath: string;
  readonly kind: "markup" | "css";
  readonly line: number;
  readonly snippet: string;
  readonly elementPath?: readonly number[];
  /** Half-open UTF-16 offsets in LF-normalized, standalone CSS source. */
  readonly textRange?: { readonly start: number; readonly end: number };
}

interface UrlToken {
  value: string;
  start: number;
  end: number;
}

interface MarkupToken {
  name: string;
  start: number;
  openingEnd: number;
  end: number;
  attributes: Map<string, { start: number; valueStart: number; value: string }>;
}

const externalUrl = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
const space = /[\t\n\f\r ]/;

function failure(message: string): never {
  throw new Error(`Cannot inspect references: ${message}`);
}

function localPath(base: string | undefined, value: string): string | undefined {
  const href = value.trim().replace(/[\t\r\n]/g, "");
  if (base === undefined || !href || externalUrl.test(href)) return undefined;
  return resolveEpubPath(base, href);
}

function resolveBase(base: string | undefined, value: string): string | undefined {
  return value.trim() ? localPath(base, value) : base;
}

function attributeNamespace(element: Element, attribute: Attr): string | null {
  if (attribute.namespaceURI) return attribute.namespaceURI;
  // Some XML DOM implementations expose prefixed attributes without namespace
  // metadata. Resolve the nearest declaration rather than assuming "xlink".
  const colon = attribute.name.indexOf(":");
  if (colon < 0) return null;
  const prefix = attribute.name.slice(0, colon);
  if (prefix === "xml") return "http://www.w3.org/XML/1998/namespace";
  for (let owner: Element | null = element; owner; owner = owner.parentElement) {
    const namespace = owner.getAttribute(`xmlns:${prefix}`);
    if (namespace !== null) return namespace;
  }
  return null;
}

function cssUrls(text: string): UrlToken[] {
  const result: UrlToken[] = [];
  let index = 0;
  function escape(continuation = false): string {
    index += 1;
    if (index >= text.length) failure("Unterminated CSS escape.");
    if (text[index] === "\n") {
      if (!continuation) failure("Invalid escaped newline in CSS token.");
      index += 1;
      return "";
    }
    const hex = /^[\da-fA-F]{1,6}/.exec(text.slice(index));
    if (hex) {
      index += hex[0].length;
      if (space.test(text[index] ?? "")) index += 1;
      const point = Number.parseInt(hex[0], 16);
      return String.fromCodePoint(point === 0 || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff) ? 0xfffd : point);
    }
    return text[index++]!;
  }
  function string(): string {
    const quote = text[index++]!;
    let value = "";
    while (index < text.length && text[index] !== quote) {
      if (text[index] === "\n") failure("Unescaped newline in CSS string.");
      value += text[index] === "\\" ? escape(true) : text[index++]!;
    }
    if (text[index++] !== quote) failure("Unterminated CSS string.");
    return value;
  }
  function trivia(): void {
    while (index < text.length) {
      if (space.test(text[index]!)) index += 1;
      else if (text.startsWith("/*", index)) {
        const end = text.indexOf("*/", index + 2);
        if (end < 0) failure("Unterminated CSS comment.");
        index = end + 2;
      } else break;
    }
  }
  function identifier(): string {
    let value = "";
    while (index < text.length && /[a-zA-Z0-9_\-\u0080-\uffff\\]/.test(text[index]!)) {
      value += text[index] === "\\" ? escape() : text[index++]!;
    }
    return value;
  }
  while (index < text.length) {
    trivia();
    if (index >= text.length) break;
    const start = index;
    if (text[index] === "'" || text[index] === '"') { string(); continue; }
    if (text[index] === "#") { index += 1; identifier(); continue; }
    if (text[index] === "@") {
      index += 1;
      if (identifier().toLowerCase() === "import") {
        trivia();
        if (text[index] === "'" || text[index] === '"') {
          const start = index;
          const value = string();
          result.push({ value, start, end: index });
        }
      }
      continue;
    }
    if (/[a-zA-Z0-9_\-\u0080-\uffff\\]/.test(text[index]!)) {
      const name = identifier();
      if (name.toLowerCase() !== "url" || text[index] !== "(") continue;
      index += 1;
      while (space.test(text[index] ?? "")) index += 1;
      let value = "";
      if (text[index] === "'" || text[index] === '"') {
        value = string();
        trivia();
      } else {
        while (index < text.length && text[index] !== ")" && !space.test(text[index]!)) {
          if (/["'(]/.test(text[index]!)) failure("Malformed CSS url().");
          value += text[index] === "\\" ? escape() : text[index++]!;
        }
        while (space.test(text[index] ?? "")) index += 1;
      }
      if (text[index++] !== ")") failure("Unterminated or malformed CSS url().");
      result.push({ value, start, end: index });
      continue;
    }
    index += 1;
  }
  return result;
}

function srcsetUrls(value: string): UrlToken[] {
  const result: UrlToken[] = [];
  let index = 0;
  while (index < value.length) {
    while (/[\t\n\f\r ,]/.test(value[index] ?? "") && index < value.length) index += 1;
    const start = index;
    while (index < value.length && !space.test(value[index]!)) index += 1;
    const raw = value.slice(start, index);
    const url = raw.replace(/,+$/, "");
    if (url) result.push({ value: url, start, end: start + url.length });
    if (raw.endsWith(",")) continue;
    let parentheses = 0;
    while (index < value.length) {
      const character = value[index++]!;
      if (character === "(") parentheses += 1;
      if (character === ")") parentheses -= 1;
      if (character === "," && parentheses === 0) break;
    }
  }
  return result;
}

function decodedXml(raw: string, start: number, attribute = false): { value: string; offsets: number[] } | undefined {
  let value = "";
  const offsets: number[] = [];
  let index = 0;
  let cdata = false;
  while (index < raw.length) {
    if (!attribute && !cdata && raw.startsWith("<!--", index)) {
      const end = raw.indexOf("-->", index + 4);
      if (end < 0) return undefined;
      index = end + 3;
      continue;
    }
    if (!attribute && !cdata && raw.startsWith("<?", index)) {
      const end = raw.indexOf("?>", index + 2);
      if (end < 0) return undefined;
      index = end + 2;
      continue;
    }
    if (!attribute && !cdata && raw.startsWith("<![CDATA[", index)) { cdata = true; index += 9; continue; }
    if (cdata && raw.startsWith("]]>", index)) { cdata = false; index += 3; continue; }
    const offset = start + index;
    let character = raw[index++]!;
    if (!cdata && character === "&") {
      const entity = /^(amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);/.exec(raw.slice(index));
      if (!entity) return undefined;
      index += entity[0].length;
      const name = entity[1]!;
      character = name.startsWith("#")
        ? String.fromCodePoint(Number.parseInt(name.slice(name[1] === "x" ? 2 : 1), name[1] === "x" ? 16 : 10))
        : ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as Record<string, string>)[name]!;
    } else if (attribute && /[\t\n\r]/.test(character)) {
      character = " ";
    }
    value += character;
    for (let unit = 0; unit < character.length; unit += 1) offsets.push(offset);
  }
  return { value, offsets };
}

/** Source positions only; well-formedness and entity expansion belong to DOMParser. */
function markupTokens(text: string): MarkupToken[] {
  const tokens: MarkupToken[] = [];
  const stack: MarkupToken[] = [];
  let index = 0;
  while ((index = text.indexOf("<", index)) !== -1) {
    const start = index;
    const delimiters = text.startsWith("<!--", index) ? ["<!--", "-->"]
      : text.startsWith("<![CDATA[", index) ? ["<![CDATA[", "]]>"]
        : text.startsWith("<?", index) ? ["<?", "?>"] : undefined;
    if (delimiters) {
      const end = text.indexOf(delimiters[1]!, index + delimiters[0]!.length);
      if (end < 0) failure("Unterminated XML token.");
      index = end + delimiters[1]!.length;
      continue;
    }
    if (text.startsWith("<!DOCTYPE", index)) {
      index += 9;
      let quote = "";
      let depth = 0;
      while (index < text.length) {
        if (!quote && text.startsWith("<!--", index)) {
          const end = text.indexOf("-->", index + 4);
          if (end < 0) failure("Unterminated document type comment.");
          index = end + 3;
          continue;
        }
        const character = text[index++]!;
        if (quote) { if (character === quote) quote = ""; }
        else if (character === "'" || character === '"') quote = character;
        else if (character === "[") depth += 1;
        else if (character === "]") depth -= 1;
        else if (character === ">" && depth === 0) break;
      }
      continue;
    }
    if (text.startsWith("</", index)) {
      index = text.indexOf(">", index) + 1;
      if (!index) failure("Unterminated XML closing tag.");
      const token = stack.pop();
      if (!token) failure("Unbalanced XML tags.");
      token.end = index;
      continue;
    }
    const name = /^<([^\s/>]+)/.exec(text.slice(index));
    if (!name) failure("Invalid XML opening tag.");
    index += name[0].length;
    const attributes: MarkupToken["attributes"] = new Map();
    while (index < text.length) {
      while (/\s/.test(text[index] ?? "")) index += 1;
      if (text[index] === "/" || text[index] === ">") break;
      const attributeStart = index;
      const attribute = /^([^\s=/>]+)\s*=\s*(["'])/.exec(text.slice(index));
      if (!attribute) failure("Malformed XML attribute.");
      index += attribute[0].length;
      const valueStart = index;
      const end = text.indexOf(attribute[2]!, index);
      if (end < 0) failure("Unterminated XML attribute.");
      if (attributes.has(attribute[1]!)) failure(`Duplicate XML attribute ${attribute[1]}.`);
      attributes.set(attribute[1]!, { start: attributeStart, valueStart, value: text.slice(index, end) });
      index = end + 1;
    }
    const selfClosing = text[index] === "/";
    index += selfClosing ? 2 : 1;
    const token = { name: name[1]!, start, openingEnd: index, end: index, attributes };
    tokens.push(token);
    if (!selfClosing) stack.push(token);
  }
  if (stack.length) failure("Unclosed XML element.");
  return tokens;
}

/**
 * Indexes actual markup/CSS URL tokens, never textual filename lookalikes.
 * Unsupported exact XML mapping degrades to file/line context, not a guessed path.
 */
export function collectInspectorReferences(
  sourcePath: string,
  source: string,
  kind: InspectorReference["kind"],
): readonly { targetPath: string; reference: InspectorReference }[] {
  const text = source.replace(/\r\n?/g, "\n");
  const results: { targetPath: string; reference: InspectorReference }[] = [];
  const lineStarts = [0];
  for (let offset = text.indexOf("\n"); offset >= 0; offset = text.indexOf("\n", offset + 1)) lineStarts.push(offset + 1);
  function add(value: string, base: string | undefined, offset: number, elementPath?: readonly number[], end?: number): void {
    const targetPath = localPath(base, value);
    if (targetPath === undefined) return;
    let low = 0;
    let high = lineStarts.length;
    while (low + 1 < high) {
      const middle = Math.floor((low + high) / 2);
      if (lineStarts[middle]! <= offset) low = middle;
      else high = middle;
    }
    const lineStart = lineStarts[low]!;
    const lineEnd = lineStarts[low + 1] === undefined ? text.length : lineStarts[low + 1]! - 1;
    results.push({
      targetPath,
      reference: {
        sourcePath,
        kind,
        line: low + 1,
        snippet: text.slice(Math.max(lineStart, offset - 60), Math.min(lineEnd, offset + 140)).trim(),
        ...(elementPath ? { elementPath } : {}),
        ...(kind === "css" && end !== undefined ? { textRange: { start: offset, end } } : {}),
      },
    });
  }
  if (kind === "css") {
    for (const token of cssUrls(text)) add(token.value, sourcePath, token.start, undefined, token.end);
    return results;
  }
  const document = new DOMParser().parseFromString(text, "application/xhtml+xml");
  if (!document.documentElement || document.getElementsByTagName("parsererror").length) failure(`Malformed XML in ${sourcePath}.`);
  const tokens = markupTokens(text);
  const elements = [document.documentElement, ...Array.from(document.documentElement.getElementsByTagName("*"))];
  if (tokens.length !== elements.length || tokens.some((token, index) => {
    const element = elements[index]!;
    return token.name !== (element.prefix ? `${element.prefix}:${element.localName}` : element.localName);
  })) failure(`Expanded XML structure in ${sourcePath} cannot be indexed safely.`);
  let mapping: readonly InspectorSourceElement[] | undefined;
  try { mapping = buildInspectorSourceMap(text); } catch (error) {
    if (!(error instanceof InspectorSourceMappingError)) throw error;
    // The independent XML parse and token correspondence above remain required.
    // Internal subsets/custom entities can prevent exact mapping in valid XML.
  }
  const bases = new Map<Element, string | undefined>();
  const documentBase = elements.find(element => element.localName === "base" && element.hasAttribute("href")
    && (element.namespaceURI === "http://www.w3.org/1999/xhtml"
      || (element.namespaceURI === null && document.documentElement.localName === "html")));
  const base = documentBase ? resolveBase(sourcePath, documentBase.getAttribute("href")!) : sourcePath;
  const presentation = new Set(["fill", "stroke", "filter", "clip-path", "mask", "marker", "marker-start", "marker-mid", "marker-end", "cursor"]);
  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index]!;
    const token = tokens[index]!;
    const parentBase = element.parentElement ? bases.get(element.parentElement) : base;
    const xmlBase = element.getAttributeNS("http://www.w3.org/XML/1998/namespace", "base") ?? element.getAttribute("xml:base");
    const elementBase = xmlBase === null ? parentBase : resolveBase(parentBase, xmlBase);
    bases.set(element, elementBase);
    const elementPath = mapping?.[index]?.elementPath;
    for (const attribute of Array.from(element.attributes)) {
      const raw = token.attributes.get(attribute.name);
      const offset = raw?.start ?? token.start;
      const decoded = raw ? decodedXml(raw.value, raw.valueStart, true) : undefined;
      const sourceOffset = (position: number): number => decoded?.value === attribute.value
        ? decoded.offsets[position] ?? offset : offset;
      if (element.localName !== "base" && (attribute.name === "src" || attribute.name === "href"
        || (attribute.name.endsWith(":href") && attributeNamespace(element, attribute) === "http://www.w3.org/1999/xlink")
        || attribute.name === "poster" || (element.localName === "object" && attribute.name === "data"))) {
        add(attribute.value, elementBase, offset, elementPath);
      } else if (attribute.name === "srcset") {
        for (const url of srcsetUrls(attribute.value)) add(url.value, elementBase, sourceOffset(url.start), elementPath);
      } else if (attribute.name === "style" || (element.namespaceURI === "http://www.w3.org/2000/svg" && presentation.has(attribute.name))) {
        for (const url of cssUrls(attribute.value)) add(url.value, elementBase, sourceOffset(url.start), elementPath);
      }
    }
    if (element.localName === "style" && (!element.getAttribute("type") || element.getAttribute("type") === "text/css")) {
      const css = element.textContent ?? "";
      const contentEnd = token.end === token.openingEnd ? token.openingEnd : text.lastIndexOf("</", token.end - 1);
      const decoded = decodedXml(text.slice(token.openingEnd, contentEnd), token.openingEnd);
      for (const url of cssUrls(css)) {
        const offset = decoded?.value === css ? decoded.offsets[url.start] ?? token.start : token.start;
        add(url.value, elementBase, offset, elementPath);
      }
    }
  }
  return results;
}
