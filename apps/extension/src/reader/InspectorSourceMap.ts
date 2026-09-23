export interface InspectorSourceElement {
  readonly elementPath: readonly number[];
  readonly start: number;
  readonly openingEnd: number;
  readonly end: number;
}

interface SourceElement {
  elementPath: number[];
  start: number;
  openingEnd: number;
  end: number;
  name: string;
  childCount: number;
}

const xmlSpace = /^[\t\n\r ]*$/;
// XML 1.0 NameChar explicitly allows combining marks after the first character.
// eslint-disable-next-line no-misleading-character-class
const xmlName = /^[:A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\u{10000}-\u{EFFFF}][:A-Z_a-z0-9.\-\u00B7\u0300-\u036F\u203F-\u2040\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\u{10000}-\u{EFFFF}]*/u;

export class InspectorSourceMappingError extends Error {
  override readonly name = "InspectorSourceMappingError";
}

function cannotMap(reason: string): never {
  throw new InspectorSourceMappingError(`Inspector source mapping unavailable: ${reason}`);
}

function validateReferences(value: string): void {
  for (let index = value.indexOf("&"); index !== -1; index = value.indexOf("&", index + 1)) {
    const reference = /^&(?:amp|lt|gt|quot|apos|#([0-9]+)|#x([0-9a-fA-F]+));/.exec(value.slice(index));
    if (!reference) cannotMap("Malformed or custom entity reference; only XML predefined and numeric entities are supported.");
    if (reference[1] !== undefined || reference[2] !== undefined) {
      const codePoint = reference[1] !== undefined
        ? Number(reference[1])
        : Number.parseInt(reference[2]!, 16);
      if (!(codePoint === 9 || codePoint === 10 || codePoint === 13
        || (codePoint >= 0x20 && codePoint <= 0xd7ff)
        || (codePoint >= 0xe000 && codePoint <= 0xfffd)
        || (codePoint >= 0x10000 && codePoint <= 0x10ffff))) {
        cannotMap("Invalid XML character reference.");
      }
    }
    index += reference[0].length - 1;
  }
}

/**
 * Half-open UTF-16 source ranges, in document order. Paths count only elements,
 * so pretty-printing, text, comments and processing instructions do not affect them.
 * The existing formatter's XML parser has no source positions; this lexer locates
 * tokens, while the browser XML parser independently verifies their DOM structure.
 */
export function buildInspectorSourceMap(text: string): readonly InspectorSourceElement[] {
  const elements: SourceElement[] = [];
  const stack: SourceElement[] = [];
  let index = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let hasDoctype = false;

  function skipSpace(): void {
    while (index < text.length && xmlSpace.test(text[index]!)) index += 1;
  }

  function readName(): string {
    const match = xmlName.exec(text.slice(index));
    if (!match) cannotMap(`Invalid XML name at offset ${index}.`);
    index += match[0].length;
    return match[0];
  }

  function skipDelimited(opening: string, closing: string): string {
    const contentStart = index + opening.length;
    const closingStart = text.indexOf(closing, contentStart);
    if (closingStart === -1) cannotMap(`Unterminated ${opening} at offset ${index}.`);
    index = closingStart + closing.length;
    return text.slice(contentStart, closingStart);
  }

  while (index < text.length) {
    if (text[index] !== "<") {
      const next = text.indexOf("<", index);
      const end = next === -1 ? text.length : next;
      const content = text.slice(index, end);
      if (!stack.length && !xmlSpace.test(content)) cannotMap("Text outside the document element.");
      if (content.includes("]]>")) cannotMap("CDATA terminator outside a CDATA section.");
      validateReferences(content);
      index = end;
      continue;
    }
    if (text.startsWith("<!--", index)) {
      const comment = skipDelimited("<!--", "-->");
      if (comment.includes("--") || comment.endsWith("-")) cannotMap("Malformed XML comment.");
      continue;
    }
    if (text.startsWith("<![CDATA[", index)) {
      if (!stack.length) cannotMap("CDATA outside the document element.");
      skipDelimited("<![CDATA[", "]]>");
      continue;
    }
    if (text.startsWith("<?", index)) {
      skipDelimited("<?", "?>");
      continue;
    }
    if (text.startsWith("<!DOCTYPE", index)) {
      if (hasDoctype || elements.length) cannotMap("Misplaced or repeated document type declaration.");
      hasDoctype = true;
      index += "<!DOCTYPE".length;
      if (!xmlSpace.test(text[index] ?? "x")) cannotMap("Malformed document type declaration.");
      let quote: string | undefined;
      let closed = false;
      while (index < text.length) {
        const character = text[index++]!;
        if (quote) {
          if (character === quote) quote = undefined;
        } else if (character === "'" || character === '"') {
          quote = character;
        } else if (character === "[") {
          // Internal subsets may expand entities into markup or supply namespace
          // attributes. Reject before DOMParser can expand any such declarations.
          cannotMap("DOCTYPE internal subsets and custom entity declarations cannot be safely mapped.");
        } else if (character === ">") {
          closed = true;
          break;
        }
      }
      if (!closed) cannotMap("Unterminated document type declaration.");
      continue;
    }
    if (text.startsWith("</", index)) {
      index += 2;
      const name = readName();
      skipSpace();
      if (text[index++] !== ">") cannotMap("Malformed closing tag.");
      const element = stack.pop();
      if (!element || element.name !== name) cannotMap(`Mismatched closing tag </${name}>.`);
      element.end = index;
      continue;
    }
    if (text.startsWith("<!", index)) cannotMap(`Unsupported XML declaration at offset ${index}.`);

    const start = index++;
    const name = readName();
    const attributeNames = new Set<string>();
    while (true) {
      const beforeSpace = index;
      skipSpace();
      if (text[index] === ">" || text.startsWith("/>", index)) break;
      if (index === beforeSpace) cannotMap(`Malformed opening tag <${name}>.`);
      const attributeName = readName();
      if (attributeNames.has(attributeName)) cannotMap(`Duplicate attribute ${attributeName}.`);
      attributeNames.add(attributeName);
      skipSpace();
      if (text[index++] !== "=") cannotMap(`Missing value for attribute ${attributeName}.`);
      skipSpace();
      const quote = text[index++];
      if (quote !== "'" && quote !== '"') cannotMap(`Unquoted attribute ${attributeName}.`);
      const valueEnd = text.indexOf(quote, index);
      if (valueEnd === -1) cannotMap(`Unterminated attribute ${attributeName}.`);
      const value = text.slice(index, valueEnd);
      if (value.includes("<")) cannotMap(`Unescaped < in attribute ${attributeName}.`);
      validateReferences(value);
      index = valueEnd + 1;
    }
    const selfClosing = text[index] === "/";
    index += selfClosing ? 2 : 1;
    const parent = stack.at(-1);
    if (!parent && elements.length) cannotMap("Multiple document elements.");
    const element: SourceElement = {
      elementPath: parent ? [...parent.elementPath, parent.childCount++] : [],
      start,
      openingEnd: index,
      end: index,
      name,
      childCount: 0,
    };
    elements.push(element);
    if (!selfClosing) stack.push(element);
  }

  if (!elements.length || stack.length) cannotMap("Missing or unclosed document element.");
  const document = new DOMParser().parseFromString(text, "application/xhtml+xml");
  const root = document.documentElement;
  if (!root) cannotMap("The XML parser did not produce a document element.");
  const pending: { element: Element; path: number[] }[] = [{ element: root, path: [] }];
  let sourceIndex = 0;
  while (pending.length) {
    const { element, path } = pending.pop()!;
    const source = elements[sourceIndex++];
    // localName preserves XML case even in DOM implementations whose XHTML
    // tagName/nodeName getters uppercase names.
    const name = element.prefix ? `${element.prefix}:${element.localName}` : element.localName;
    if (!source || source.name !== name
      || source.childCount !== element.children.length
      || !pathsEqual(source.elementPath, path)) {
      cannotMap("Malformed XML or XML parser element structure differs from the source.");
    }
    for (let childIndex = element.children.length - 1; childIndex >= 0; childIndex -= 1) {
      pending.push({ element: element.children[childIndex]!, path: [...path, childIndex] });
    }
  }
  if (sourceIndex !== elements.length) cannotMap("XML parser omitted source elements.");
  return elements.map(({ elementPath, start, openingEnd, end }) => ({ elementPath, start, openingEnd, end }));
}

function pathsEqual(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((part, index) => part === right[index]);
}

/** Returns the innermost half-open range containing a UTF-16 source offset. */
export function inspectorElementAtOffset(
  elements: readonly InspectorSourceElement[],
  offset: number,
): InspectorSourceElement | undefined {
  if (!Number.isInteger(offset) || offset < 0) return undefined;
  let match: InspectorSourceElement | undefined;
  for (const element of elements) {
    if (element.start <= offset && offset < element.end
      && (!match || element.elementPath.length > match.elementPath.length)) {
      match = element;
    }
  }
  return match;
}

export function inspectorElementForPath(
  elements: readonly InspectorSourceElement[],
  path: readonly number[],
): InspectorSourceElement | undefined {
  return elements.find((element) => pathsEqual(element.elementPath, path));
}
