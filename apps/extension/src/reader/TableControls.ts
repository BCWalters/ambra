import { isReaderOwnedContent, markReaderOwnedContent, measureSimpleTableRows, ReadingTheme } from "@ambra/engine";
import type { Page } from "@ambra/engine";
import { getInterfaceCssVariables, getInterfaceTheme, type InterfaceTheme } from "@ambra/shell/theme";

export function updateTableControlTheme(doc: Document, palette: InterfaceTheme): void {
  const root = Array.from(doc.querySelectorAll<HTMLElement>("[data-ambra-table-controls]"))
    .find(isReaderOwnedContent);
  if (!root) return;
  for (const [key, value] of Object.entries(getInterfaceCssVariables(palette))) {
    root.style.setProperty(key, value);
  }
  root.style.setProperty("color-scheme", palette.appearance, "important");
}

export function updateTableControlLabels(doc: Document, label: string): void {
  const root = Array.from(doc.querySelectorAll<HTMLElement>("[data-ambra-table-controls]"))
    .find(isReaderOwnedContent);
  for (const button of root?.shadowRoot?.querySelectorAll("button") ?? []) {
    button.setAttribute("aria-label", label);
    button.title = label;
  }
}

/** Top-layer controls never participate in publication layout or CFI trees. */
export function attachTableControls(
  doc: Document,
  label: string,
  open: (table: HTMLTableElement, trigger: HTMLButtonElement) => void,
  visiblePage?: () => Page | undefined,
  palette: InterfaceTheme = getInterfaceTheme("ambra", "light"),
): () => void {
  const tables = Array.from(doc.querySelectorAll("table")).filter(table =>
    !table.parentElement?.closest("table") && !isReaderOwnedContent(table));
  if (!tables.length || !doc.defaultView) return () => {};
  const root = doc.createElement("div");
  root.dataset.ambraTableControls = "";
  root.style.cssText = "all:initial!important;position:fixed!important;width:0!important;height:0!important";
  markReaderOwnedContent(root);
  const shadow = root.attachShadow({ mode: "open" });
  const style = doc.createElement("style");
  style.textContent = `
    :host { all: initial; }
    button { all: initial; position: fixed; margin: 0; box-sizing: border-box;
      width: 28px; height: 28px; display: none; place-items: center;
      border: 1px solid var(--ambraControlBorder); border-radius: 4px; background: var(--ambraSurface);
      color: var(--ambraAccentForeground); cursor: zoom-in; font: 20px/1 system-ui; }
    button::backdrop { display: none; }
    button:popover-open { display: grid; }
    button:hover { background: var(--ambraHover); }
    button:active { background: var(--ambraSelected); }
    button:focus-visible { outline: 3px solid var(--ambraFocus); outline-offset: 2px;
      box-shadow: 0 0 0 2px var(--ambraSurface); }
    @media (forced-colors: active) {
      button { color: ButtonText; background: ButtonFace; border-color: ButtonText; }
      button:focus-visible { outline-color: Highlight; box-shadow: none; }
    }
  `;
  shadow.append(style);
  const entries = tables.map(table => {
    const button = doc.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", label);
    button.title = label;
    button.setAttribute("popover", "manual");
    const icon = doc.createElement("span");
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "⛶";
    button.append(icon);
    button.addEventListener("click", event => {
      event.stopPropagation();
      open(table, button);
    });
    for (const type of ["pointerdown", "pointerup", "keydown", "keyup"]) {
      button.addEventListener(type, event => event.stopPropagation());
    }
    shadow.append(button);
    return { table, button };
  });
  doc.body.append(root);
  updateTableControlTheme(doc, palette);
  let frame = 0;
  let disposed = false;
  const update = (): void => {
    frame = 0;
    const width = doc.documentElement.clientWidth;
    const height = doc.documentElement.clientHeight;
    const page = visiblePage?.();
    const translation = page
      ? new DOMMatrixReadOnly(doc.defaultView!.getComputedStyle(doc.body).transform).m42 : 0;
    const top = page ? Math.max(0, page.topY + translation) : 0;
    const contentHeight = Number.parseFloat(doc.documentElement.style.getPropertyValue(
      ReadingTheme.PAGE_CONTENT_HEIGHT_PROPERTY,
    ));
    const budget = page && Number.isFinite(contentHeight) ? contentHeight : Infinity;
    const bottom = page ? Math.min(height, page.bottomY + translation, top + budget) : height;
    for (const { table, button } of entries) {
      const flowsNormally = measureSimpleTableRows(table, budget) !== undefined;
      const rect = table.getBoundingClientRect();
      const visible = !flowsNormally && table.isConnected && rect.width > 0 && rect.height > 0 &&
        rect.right > 0 && rect.left < width && rect.bottom > top && rect.top < bottom;
      if (visible) {
        const edge = doc.defaultView!.getComputedStyle(table).direction === "rtl"
          ? rect.right : rect.left - 28;
        button.style.left = `${Math.max(0, Math.min(width - 28, edge))}px`;
        button.style.top = `${Math.max(top, Math.min(bottom - 28, rect.top))}px`;
        if (!button.matches(":popover-open")) button.showPopover();
      } else if (button.matches(":popover-open")) button.hidePopover();
    }
  };
  const schedule = (): void => {
    if (!disposed && !frame) frame = doc.defaultView!.requestAnimationFrame(update);
  };
  // Pagination moves a transformed body without scroll/resize events. Observe
  // its style changes instead of measuring every table on every animation frame.
  const mutations = new MutationObserver(schedule);
  mutations.observe(doc.body, { attributes: true, subtree: true, childList: true,
    attributeFilter: ["style", "class", "hidden", "open"] });
  const resize = new ResizeObserver(schedule);
  resize.observe(doc.body);
  for (const { table } of entries) resize.observe(table);
  doc.addEventListener("scroll", schedule, true);
  doc.addEventListener("load", schedule, true);
  doc.addEventListener("transitionend", schedule, true);
  doc.defaultView.addEventListener("resize", schedule);
  update();
  return () => {
    disposed = true;
    mutations.disconnect();
    resize.disconnect();
    doc.removeEventListener("scroll", schedule, true);
    doc.removeEventListener("load", schedule, true);
    doc.removeEventListener("transitionend", schedule, true);
    doc.defaultView?.removeEventListener("resize", schedule);
    doc.defaultView?.cancelAnimationFrame(frame);
    root.remove();
  };
}
