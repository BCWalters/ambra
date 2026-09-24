import { navigationCommand, type NavigationKeyboardOptions } from "./NavigationKeyboard.js";
import type { DomBreakPoint } from "../layout/Page.js";

export interface AccessibilityNavigationHandlers {
  onNext: () => void;
  onPrevious: () => void;
  onNextChapter?: () => void;
  onPreviousChapter?: () => void;
}

/** Owns keyboard listeners and managed focus across content documents. */
export class AccessibilityController {
  private readonly attachments = new Map<Document, (event: KeyboardEvent) => void>();

  /** Iframe key events do not bubble to the shell; each document needs a listener. */
  public attach(
    document: Document,
    handlers: AccessibilityNavigationHandlers,
    options: NavigationKeyboardOptions = {},
  ): void {
    this.detach(document);
    const keydownHandler = (event: KeyboardEvent): void => {
      if (options.keyboardHandler) {
        options.keyboardHandler(event, document);
        return;
      }
      const command = navigationCommand(event, document, options);
      if (!command) return;
      const handler = command.kind === "chapter"
        ? command.direction === 1 ? handlers.onNextChapter : handlers.onPreviousChapter
        : command.direction === 1 ? handlers.onNext : handlers.onPrevious;
      if (!handler) return;
      event.preventDefault();
      handler();
    };
    document.addEventListener("keydown", keydownHandler);
    this.attachments.set(document, keydownHandler);
  }

  public detach(document?: Document): void {
    if (document) {
      const handler = this.attachments.get(document);
      if (handler) document.removeEventListener("keydown", handler);
      this.attachments.delete(document);
      return;
    }
    for (const [attachedDocument, handler] of this.attachments) {
      attachedDocument.removeEventListener("keydown", handler);
    }
    this.attachments.clear();
  }

  public focusContent(document: Document, target?: Element): void {
    const element = target ?? document.body;
    if (!element) return;
    const focusTarget = element as HTMLElement;
    const needsTabIndex = focusTarget.tabIndex < 0 || element.matches("a:not([href]), area:not([href])");
    if (!element.hasAttribute("tabindex") && !focusTarget.isContentEditable && needsTabIndex) {
      // Navigation targets aren't controls; preserve authored control indicators.
      if (!focusTarget.hasAttribute("role")) {
        focusTarget.setAttribute("data-ambra-reading-focus", "");
        focusTarget.addEventListener("blur", () => {
          focusTarget.removeAttribute("data-ambra-reading-focus");
          if (focusTarget.getAttribute("tabindex") === "-1") focusTarget.removeAttribute("tabindex");
        }, { once: true });
      }
      element.setAttribute("tabindex", "-1");
    }

    // Focusing inside an iframe alone does not reliably transfer the active frame.
    const frameElement = document.defaultView?.frameElement;
    if (frameElement instanceof HTMLElement) frameElement.focus({ preventScroll: true });
    // Native scroll-into-view would fight the reader's page transform or saved scroll position.
    (element as HTMLElement).focus({ preventScroll: true });
  }

  /** Exposes a native reading caret; the screen reader still owns its virtual cursor. */
  public focusReadingPosition(document: Document, position: DomBreakPoint): void {
    if (position.node.ownerDocument !== document || !position.node.isConnected) {
      throw new Error("The reading position must belong to the current content document.");
    }
    const selection = document.getSelection();
    const retained = selection && !selection.isCollapsed && selection.anchorNode && selection.focusNode
      ? {
          anchorNode: selection.anchorNode,
          anchorOffset: selection.anchorOffset,
          focusNode: selection.focusNode,
          focusOffset: selection.focusOffset,
          range: selection.getRangeAt(0),
        }
      : undefined;
    let node = retained?.range.startContainer ?? position.node;
    let offset = retained?.range.startOffset ?? position.offset ?? 0;
    if (node.nodeType === 1 && node.childNodes[offset]) {
      node = node.childNodes[offset]!;
      offset = 0;
    }
    const target = node.nodeType === 1 ? node as Element : node.parentElement;
    this.focusContent(document, target ?? undefined);
    if (retained && selection) {
      selection.setBaseAndExtent(
        retained.anchorNode, retained.anchorOffset, retained.focusNode, retained.focusOffset,
      );
    } else {
      selection?.collapse(node, offset);
    }
  }
}
