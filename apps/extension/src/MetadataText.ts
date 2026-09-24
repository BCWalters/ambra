export type MetadataTextKind = "description" | "rights" | "identity" | "detail";

export const METADATA_TEXT_LIMITS = {
  description: { preview: 700, expanded: 1400, paragraphs: 2 },
  rights: { preview: 140, expanded: 600, paragraphs: 2 },
  identity: { preview: 100, expanded: 480, paragraphs: 1 },
  detail: { preview: 160, expanded: 600, paragraphs: 2 },
} as const;

const blockTags = new Set([
  "P", "DIV", "SECTION", "ARTICLE", "BLOCKQUOTE", "PRE", "LI", "UL", "OL",
  "DL", "DT", "DD", "H1", "H2", "H3", "H4", "H5", "H6", "TABLE", "TR",
]);
const ignoredTags = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT", "IFRAME", "OBJECT", "HEAD"]);
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function normalizeParagraphs(text: string): string {
  return text.replace(/\r\n?|\u2028/g, "\n").replace(/\u2029/g, "\n\n")
    .split(/\n\s*\n/).map(p => p.replace(/[ \t\f\v\n\r]+/g, " ").trim())
    .filter(Boolean).join("\n\n");
}

/** Parse only into inert template content; never mount publisher markup or
 * load its images/frames in the extension's document. */
export function metadataPlainText(value: string): string {
  const template = document.createElement("template");
  template.innerHTML = value;
  const parts: string[] = [];
  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.textContent ?? "");
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
    const tag = node instanceof Element ? node.tagName.toUpperCase() : "";
    if (ignoredTags.has(tag)) return;
    if (tag === "BR") {
      parts.push("\n");
      return;
    }
    if (blockTags.has(tag)) parts.push("\n\n");
    for (const child of node.childNodes) visit(child);
    if (blockTags.has(tag)) parts.push("\n\n");
  };
  visit(template.content);
  return normalizeParagraphs(parts.join(""));
}

export function abbreviateMetadata(text: string, limit: number, paragraphs: number): string {
  const candidates = text.split("\n\n").slice(0, paragraphs).join("\n\n");
  if (candidates === text && text.length <= limit) return text;
  // Reserve one character for an honest omission marker, even at a paragraph
  // boundary. Never split a surrogate pair or combining/emoji sequence.
  let end = 0;
  for (const part of graphemes.segment(candidates)) {
    if (part.index + part.segment.length > limit - 1) break;
    end = part.index + part.segment.length;
  }
  let cut = candidates.slice(0, end);
  if (end < candidates.length) {
    const paragraphEnd = cut.lastIndexOf("\n\n");
    const sentenceEnd = Array.from(cut.matchAll(/[.!?。！？](?=\s|$)/gu)).at(-1)?.index;
    if (paragraphEnd >= limit * 0.4) cut = cut.slice(0, paragraphEnd);
    else if (sentenceEnd !== undefined && sentenceEnd >= limit * 0.6) cut = cut.slice(0, sentenceEnd + 1);
    else {
      const wordEnd = cut.lastIndexOf(" ");
      if (wordEnd >= limit * 0.6) cut = cut.slice(0, wordEnd);
    }
  }
  return cut.trimEnd() + "\u2026";
}

export function metadataTextSummary(value: string, kind: MetadataTextKind) {
  const limits = METADATA_TEXT_LIMITS[kind];
  const text = kind === "description" || kind === "rights" ? metadataPlainText(value) : normalizeParagraphs(value);
  return {
    preview: abbreviateMetadata(text, limits.preview, limits.paragraphs),
    expanded: abbreviateMetadata(text, limits.expanded, limits.paragraphs),
  };
}
