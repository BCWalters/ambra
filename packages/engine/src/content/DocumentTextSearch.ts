/** A match in original source text, with both live DOM endpoints and
 * offsets into its contiguous text run for constructing an excerpt. */
export interface DocumentTextMatch {
  readonly start: { readonly node: Text; readonly offset: number };
  readonly end: { readonly node: Text; readonly offset: number };
  readonly text: string;
  readonly startIndex: number;
  readonly endIndex: number;
}

interface TextSpan {
  readonly node: Text;
  readonly start: number;
  readonly end: number;
}

interface TextRun {
  readonly text: string;
  readonly spans: readonly TextSpan[];
}

const EXCLUDED_ELEMENTS = new Set([
  "head",
  "script",
  "style",
  "template",
  "noscript",
  "title",
  "meta",
  "link",
  "iframe",
  "object",
  "audio",
  "video",
  "select",
  "textarea",
  "defs",
  "desc",
  "metadata",
]);

const BLOCK_ELEMENTS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "body",
  "caption",
  "dd",
  "details",
  "dialog",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hgroup",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "summary",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
  "text",
]);

const BLOCK_DISPLAYS = new Set([
  "block",
  "flow-root",
  "list-item",
  "flex",
  "grid",
  "table",
  "table-caption",
  "table-row",
  "table-cell",
  "table-row-group",
  "table-header-group",
  "table-footer-group",
]);

const BREAK_ELEMENTS = new Set(["br", "hr", "img", "input", "embed"]);

function inlineStyle(element: Element): CSSStyleDeclaration | undefined {
  return (element as HTMLElement).style;
}

function isExcluded(element: Element): boolean {
  const style = inlineStyle(element);
  return (
    EXCLUDED_ELEMENTS.has(element.localName.toLowerCase()) ||
    element.hasAttribute("hidden") ||
    element.getAttribute("aria-hidden") === "true" ||
    style?.display === "none" ||
    style?.visibility === "hidden" ||
    style?.visibility === "collapse"
  );
}

function isBoundary(element: Element): boolean {
  const name = element.localName.toLowerCase();
  if (BREAK_ELEMENTS.has(name)) {
    return true;
  }
  const display = inlineStyle(element)?.display;
  if (display === "inline" || display === "inline-block" || display === "contents") {
    return false;
  }
  return BLOCK_DISPLAYS.has(display ?? "") || BLOCK_ELEMENTS.has(name);
}

/** null ends a run. Skipped subtrees are barriers too: a Range spanning
 * them would include text that the matcher deliberately did not search. */
function* searchableNodes(root: Element): Generator<Text | null> {
  let node: Node = root;
  while (true) {
    if (node.nodeType === 1) {
      const element = node as Element;
      if (isExcluded(element)) {
        yield null;
      } else {
        if (isBoundary(element)) {
          yield null;
        }
        if (node.firstChild) {
          node = node.firstChild;
          continue;
        }
      }
    } else if (node.nodeType === 3) {
      yield node as Text;
    }

    while (node !== root && !node.nextSibling) {
      node = node.parentNode!;
      if (node.nodeType === 1 && isBoundary(node as Element)) {
        yield null;
      }
    }
    if (node === root) {
      return;
    }
    node = node.nextSibling!;
  }
}

function* textRuns(root: Element): Generator<TextRun> {
  let chunks: string[] = [];
  let spans: TextSpan[] = [];
  let length = 0;
  for (const node of searchableNodes(root)) {
    if (node === null) {
      if (length > 0) {
        yield { text: chunks.join(""), spans };
        chunks = [];
        spans = [];
        length = 0;
      }
    } else if (node.data.length > 0) {
      chunks.push(node.data);
      spans.push({ node, start: length, end: length + node.data.length });
      length += node.data.length;
    }
  }
  if (length > 0) {
    yield { text: chunks.join(""), spans };
  }
}

function sourceOffsets(text: string): { starts: number[]; ends: number[] } {
  const starts: number[] = [];
  const ends: number[] = [];
  let offset = 0;
  for (const character of text) {
    const foldedLength = character.toLowerCase().length;
    for (let i = 0; i < foldedLength; i++) {
      // An expansion such as İ → i + combining dot still addresses the
      // original character, including when only part of the expansion matches.
      starts.push(offset + (foldedLength === character.length ? i : 0));
      ends.push(offset + (foldedLength === character.length ? i + 1 : character.length));
    }
    offset += character.length;
  }
  return { starts, ends };
}

function positionAt(
  spans: readonly TextSpan[],
  offset: number,
  end: boolean,
): { node: Text; offset: number } {
  const characterIndex = end ? offset - 1 : offset;
  let low = 0;
  let high = spans.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (spans[middle]!.end <= characterIndex) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  const span = spans[low]!;
  return { node: span.node, offset: offset - span.start };
}

/**
 * Finds non-overlapping, case-insensitive matches across inline text nodes.
 * Runs are transient and end at block/line boundaries or non-content/hidden
 * subtrees. Visibility uses markup and inline styles, not computed layout,
 * so unloaded search documents and rendered highlight documents use one
 * policy. Whitespace is preserved; query trimming/minimum length belong to
 * callers.
 */
export function* findTextMatchesInDocument(
  document: Document,
  needle: string,
): Generator<DocumentTextMatch> {
  const root = document.body ?? document.documentElement;
  if (!root || needle.length === 0) {
    return;
  }
  const lowerNeedle = needle.toLowerCase();
  for (const { text, spans } of textRuns(root)) {
    // Lowercase the entire run to retain contextual casing (e.g. Greek
    // final sigma). Case expansions need a separate UTF-16 source mapping.
    const lowerText = text.toLowerCase();
    let matchIndex = lowerText.indexOf(lowerNeedle);
    if (matchIndex === -1) {
      continue;
    }
    const offsets = lowerText.length === text.length ? undefined : sourceOffsets(text);
    while (matchIndex !== -1) {
      const lowerEnd = matchIndex + lowerNeedle.length;
      const startIndex = offsets?.starts[matchIndex] ?? matchIndex;
      const endIndex = offsets?.ends[lowerEnd - 1] ?? lowerEnd;
      yield {
        start: positionAt(spans, startIndex, false),
        end: positionAt(spans, endIndex, true),
        text,
        startIndex,
        endIndex,
      };
      matchIndex = lowerText.indexOf(lowerNeedle, lowerEnd);
    }
  }
}
