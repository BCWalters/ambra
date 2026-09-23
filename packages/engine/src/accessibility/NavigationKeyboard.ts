export interface NavigationKeyboardOptions {
  interceptSpace?: boolean;
  pageProgressionDirection?: string;
  scope?: "content" | "shell";
}

export interface NavigationCommand {
  kind: "page" | "chapter";
  direction: 1 | -1;
}

const CONTROL_SELECTOR =
  'input, textarea, select, [role="slider"], [role="spinbutton"], ' +
  '[role="menu"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], ' +
  '[role="listbox"], [role="option"], [role="tree"], [role="treeitem"], ' +
  '[role="tablist"], [role="tab"], [role="radiogroup"], [role="grid"], ' +
  '[role="dialog"], [role="alertdialog"], dialog';

/** One shortcut policy for the shell and every content iframe. */
export function navigationCommand(
  event: KeyboardEvent,
  document: Document,
  options: NavigationKeyboardOptions = {},
): NavigationCommand | undefined {
  if (event.defaultPrevented || event.isComposing || event.altKey) return undefined;
  const arrow = event.key === "ArrowLeft" || event.key === "ArrowRight";
  const space = event.key === " ";
  if (!arrow && !space) return undefined;
  if (arrow && event.shiftKey) return undefined;
  if (space && (options.interceptSpace === false || event.ctrlKey || event.metaKey)) return undefined;

  // Event targets belong to the iframe's realm, not necessarily this module's.
  const node = event.target as Node | null;
  const target = node?.nodeType === 1 ? node as Element : node?.parentElement ?? document.activeElement;
  if (target) {
    if (target.closest(CONTROL_SELECTOR)) return undefined;
    if (isEditable(target)) return undefined;
    if (options.scope === "shell" && target.closest("nav, aside")) return undefined;
    if (space && target.closest('button, a[href], summary, [role="button"], [role="checkbox"], [role="radio"]')) {
      return undefined;
    }
    for (let element: Element | null = target; element; element = element.parentElement) {
      const style = document.defaultView?.getComputedStyle(element);
      const scrolls = arrow
        ? element.scrollWidth > element.clientWidth && /^(auto|scroll)$/.test(style?.overflowX ?? "")
        : element.scrollHeight > element.clientHeight && /^(auto|scroll)$/.test(style?.overflowY ?? "");
      if (scrolls) return undefined;
    }
  }

  if (space) return { kind: "page", direction: event.shiftKey ? -1 : 1 };
  const forward = (event.key === "ArrowRight") !== (options.pageProgressionDirection === "rtl");
  return { kind: event.ctrlKey || event.metaKey ? "chapter" : "page", direction: forward ? 1 : -1 };
}

function isEditable(target: Element): boolean {
  for (let element: Element | null = target; element; element = element.parentElement) {
    const value = element.getAttribute("contenteditable")?.toLowerCase();
    if (value === "false") return false;
    if (value === "" || value === "true" || value === "plaintext-only") return true;
  }
  return false;
}
