export interface NavigationKeyboardOptions {
  interceptSpace?: boolean;
  pageProgressionDirection?: string;
  scope?: "content" | "shell";
  /** App-owned registry replaces, rather than supplements, legacy navigation. */
  keyboardHandler?: (event: KeyboardEvent, document: Document) => void;
}

export interface NavigationCommand {
  kind: "page" | "chapter";
  direction: 1 | -1;
}

const CONTROL_SELECTOR =
  'input, textarea, select, [role="slider"], [role="spinbutton"], ' +
  '[role="textbox"], [role="searchbox"], [role="combobox"], [role="switch"], [role="scrollbar"], ' +
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

  if (!isKeyboardNavigationScope(event, document, options)) return undefined;

  if (space) return { kind: "page", direction: event.shiftKey ? -1 : 1 };
  const forward = (event.key === "ArrowRight") !== (options.pageProgressionDirection === "rtl");
  return { kind: event.ctrlKey || event.metaKey ? "chapter" : "page", direction: forward ? 1 : -1 };
}

/** Shared DOM scope guards; modifier and command policy belong to the caller. */
export function isKeyboardNavigationScope(
  event: KeyboardEvent,
  document: Document,
  options: Pick<NavigationKeyboardOptions, "scope"> & {
    preserveSelection?: boolean;
    allControls?: boolean;
    nestedScroll?: boolean;
    readingImageNavigation?: boolean;
    readingLinkNavigation?: boolean;
  } = {},
): boolean {
  if (event.defaultPrevented || event.isComposing || event.getModifierState?.("AltGraph")) return false;
  if (options.preserveSelection && document.getSelection()?.isCollapsed === false) return false;
  const arrow = event.key === "ArrowLeft" || event.key === "ArrowRight";
  const space = event.key === " ";
  // Event targets belong to the iframe's realm, not necessarily this module's.
  const node = event.target as Node | null;
  const target = node?.nodeType === 1 ? node as Element : node?.parentElement ?? document.activeElement;
  if (target) {
    if (target.closest(CONTROL_SELECTOR)) return false;
    if (isEditable(target)) return false;
    if (options.scope === "shell" && target.closest("nav, aside")) return false;
    if (space || options.allControls) {
      const selector = 'button, a[href], summary, [role="button"], [role="checkbox"], [role="radio"], audio, video';
      const control = target.closest(selector);
      const navigationKey = ["ArrowLeft", "ArrowRight", "PageUp", "PageDown"].includes(event.key);
      // A reader-added zoom affordance must not strand automatic reading focus
      // on an illustration. Space/Enter still belong to image activation.
      const readingImage = options.readingImageNavigation &&
        navigationKey &&
        control?.matches("img[data-ambra-image-zoom]") && !control.parentElement?.closest(selector);
      const role = control?.getAttribute("role");
      const readingLink = options.readingLinkNavigation && navigationKey &&
        control?.matches("a[href]") && (!role || role === "link" || role.startsWith("doc-")) &&
        !control.parentElement?.closest(selector);
      if (control && !readingImage && !readingLink) return false;
    }
    for (let element: Element | null = target; element; element = element.parentElement) {
      const protectNestedScroll = options.allControls || options.nestedScroll;
      if (protectNestedScroll && (element === document.body || element === document.documentElement)) continue;
      const style = document.defaultView?.getComputedStyle(element);
      const scrolls = protectNestedScroll
        ? element.scrollWidth > element.clientWidth && /^(auto|scroll)$/.test(style?.overflowX ?? "") ||
          element.scrollHeight > element.clientHeight && /^(auto|scroll)$/.test(style?.overflowY ?? "")
        : arrow
        ? element.scrollWidth > element.clientWidth && /^(auto|scroll)$/.test(style?.overflowX ?? "")
        : element.scrollHeight > element.clientHeight && /^(auto|scroll)$/.test(style?.overflowY ?? "");
      if (scrolls) return false;
    }
  }

  return true;
}

function isEditable(target: Element): boolean {
  for (let element: Element | null = target; element; element = element.parentElement) {
    const value = element.getAttribute("contenteditable")?.toLowerCase();
    if (value === "false") return false;
    if (value === "" || value === "true" || value === "plaintext-only") return true;
  }
  return false;
}
