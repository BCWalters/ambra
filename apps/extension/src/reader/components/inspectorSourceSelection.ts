/** HTML parsing normalizes source line endings before creating text nodes.
 * Normalize up front so source-map offsets match the displayed DOM exactly. */
export function normalizeInspectorSourceText(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/** Offsets refer to displayed text, not highlight.js's escaped HTML. */
export function sourceSelectionOffset(container: HTMLElement, selection: Selection | null): number | undefined {
  const node = selection?.focusNode;
  if (!node || !container.contains(node)) return undefined;
  const prefix = container.ownerDocument.createRange();
  prefix.selectNodeContents(container);
  prefix.setEnd(node, selection.focusOffset);
  return prefix.toString().length;
}

export function sourceTextRange(container: HTMLElement, start: number, end: number): Range | undefined {
  const walker = container.ownerDocument.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const range = container.ownerDocument.createRange();
  let offset = 0;
  let started = false;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0;
    if (!started && start >= offset &&
        (start < offset + length || (start === end && start === offset + length))) {
      range.setStart(node, start - offset);
      started = true;
    }
    if (started && end <= offset + length) {
      range.setEnd(node, end - offset);
      return range;
    }
    offset += length;
  }
  return undefined;
}

/** Native Selection.modify keeps this read-only source keyboard-selectable
 * without an editable DOM or intercepting copy, Tab, or link activation. */
export function moveSourceCaret(
  container: HTMLElement,
  key: string,
  extend: boolean,
  byWord: boolean,
): boolean {
  const directions: Record<string, "forward" | "backward"> = {
    ArrowRight: "forward", ArrowLeft: "backward", ArrowDown: "forward",
    ArrowUp: "backward", Home: "backward", End: "forward",
  };
  const direction = directions[key];
  const selection = container.ownerDocument.getSelection();
  if (!direction || !selection?.modify) return false;
  if (sourceSelectionOffset(container, selection) === undefined) {
    const start = sourceTextRange(container, 0, 0);
    if (!start) return false;
    selection.removeAllRanges();
    selection.addRange(start);
  }
  const granularity = key === "Home" || key === "End" ? "lineboundary"
    : key === "ArrowUp" || key === "ArrowDown" ? "line"
    : byWord ? "word" : "character";
  selection.modify(extend ? "extend" : "move", direction, granularity);
  return true;
}
