export interface SimpleTableRow {
  readonly element: HTMLTableRowElement;
  readonly top: number;
  readonly bottom: number;
}

const TEXT_ELEMENTS = new Set([
  "a", "abbr", "b", "bdi", "bdo", "br", "cite", "code", "em", "i", "s",
  "small", "span", "strong", "sub", "sup", "u",
]);

/** A conservative, geometry-checked subset, shared by pagination and viewer
 * controls. Returning undefined keeps the ordinary atomic-table fallback. */
export function measureSimpleTableRows(
  table: HTMLTableElement,
  pageHeight = Infinity,
): readonly SimpleTableRow[] | undefined {
  if (table.parentElement?.closest("table, figure") ||
    table.querySelector("caption, thead, tfoot, th, table") ||
    table.rows.length < 2) return;
  const view = table.ownerDocument.defaultView;
  if (!view) return;
  const width = table.ownerDocument.documentElement.clientWidth;
  const rect = table.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0 || rect.left < 0 || rect.right > width) return;
  const normalBox = (element: Element, display: string): boolean => {
    const style = view.getComputedStyle(element);
    return style.display === display && style.position === "static" &&
      style.float === "none" && style.transform === "none" &&
      style.writingMode === "horizontal-tb";
  };
  if (!normalBox(table, "table")) return;
  for (const child of table.children) {
    if (child.localName !== "tbody" || !normalBox(child, "table-row-group")) return;
  }
  const rows: SimpleTableRow[] = [];
  let previousBottom = rect.top;
  for (const row of table.rows) {
    if (row.cells.length !== 1 || !normalBox(row, "table-row")) return;
    const cell = row.cells[0]!;
    if (cell.colSpan !== 1 || cell.rowSpan !== 1 || !normalBox(cell, "table-cell")) return;
    for (const child of cell.querySelectorAll("*")) {
      if (!TEXT_ELEMENTS.has(child.localName) || !normalBox(child, "inline")) return;
    }
    const bounds = row.getBoundingClientRect();
    if (bounds.height <= 0 || bounds.top < previousBottom || bounds.bottom > rect.bottom) return;
    // A row box alone cannot detect text overflowing a fixed-height cell.
    const range = table.ownerDocument.createRange();
    range.selectNodeContents(cell);
    for (const content of range.getClientRects()) {
      if (content.width === 0 || content.height === 0) continue;
      if (content.top < bounds.top - 1 || content.bottom > bounds.bottom + 1 ||
        content.left < bounds.left - 1 || content.right > bounds.right + 1 ||
        content.left < 0 || content.right > width) return;
    }
    const top = rows.length === 0 ? rect.top : bounds.top;
    const bottom = rows.length === table.rows.length - 1 ? rect.bottom : bounds.bottom;
    if (bottom - top > pageHeight) return;
    rows.push({ element: row, top, bottom });
    previousBottom = bounds.bottom;
  }
  return rows;
}
