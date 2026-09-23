import { navigationCommand, type NavigationKeyboardOptions } from "./NavigationKeyboard.js";

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
    if (!element.hasAttribute("tabindex")) element.setAttribute("tabindex", "-1");

    // Focusing inside an iframe alone does not reliably transfer the active frame.
    const frameElement = document.defaultView?.frameElement;
    if (frameElement instanceof HTMLElement) frameElement.focus({ preventScroll: true });
    // Native scroll-into-view would fight the reader's page transform or saved scroll position.
    (element as HTMLElement).focus({ preventScroll: true });
  }
}
