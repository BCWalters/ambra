/** Callbacks `AccessibilityController.attach` invokes for keyboard-driven
 * navigation. What "next"/"previous" mean is up to the caller — typically
 * "turn one page" in paginated mode, or "go to the next/previous chapter"
 * in scroll/fixed-layout mode, where there's no discrete page concept. */
export interface AccessibilityNavigationHandlers {
  onNext: () => void;
  onPrevious: () => void;
}

/**
 * Keyboard navigation and managed focus for the reading surface, shared
 * across paginated, continuous-scroll, and fixed-layout content hosts.
 * ARIA landmarks and live-region announcements for the surrounding shell
 * UI are the reader page's own responsibility (see `apps/extension`'s
 * `ReaderApp`/`Toolbar`) — this class is scoped to the sandboxed content
 * document itself, which the shell doesn't otherwise reach into.
 */
export class AccessibilityController {
  private document: Document | undefined;
  private keydownHandler: ((event: KeyboardEvent) => void) | undefined;

  /**
   * Wires `ArrowLeft`/`ArrowRight` navigation directly onto `document` —
   * the content host's *own* iframe document, not the parent window.
   * Keyboard events don't bubble out of an iframe's browsing context to
   * the parent, so a listener on the parent's `window`/`document` would
   * never fire while focus is inside the reading content, exactly where
   * it needs to be for a screen reader user actually reading the book.
   * This is a legitimate use of the sandbox's `allow-same-origin` grant
   * (the trusted parent shell attaching its own listener to a document it
   * has real DOM access to) — not the untrusted content running any
   * script of its own, which stays fully disabled.
   *
   * Deliberately only intercepts Left/Right: Up/Down/PageUp/PageDown/
   * Space are left untouched so native scrolling keeps working normally
   * in continuous-scroll mode. Replaces any previously attached listener.
   */
  public attach(document: Document, handlers: AccessibilityNavigationHandlers): void {
    this.detach();

    const keydownHandler = (event: KeyboardEvent): void => {
      if (event.key === "ArrowRight") {
        event.preventDefault();
        handlers.onNext();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        handlers.onPrevious();
      }
    };

    document.addEventListener("keydown", keydownHandler);
    this.document = document;
    this.keydownHandler = keydownHandler;
  }

  /** Removes the currently-attached keyboard listener, if any — call
   * before attaching to a new document (e.g. a fresh spine item's iframe;
   * `attach` already does this itself) or when tearing down entirely. */
  public detach(): void {
    if (this.document && this.keydownHandler) {
      this.document.removeEventListener("keydown", this.keydownHandler);
    }
    this.document = undefined;
    this.keydownHandler = undefined;
  }

  /**
   * Moves focus to `target` (or `document.body` if omitted), the standard
   * "managed focus" technique for after a navigation event: without it, a
   * screen reader user's reading cursor stays wherever it was (e.g. a
   * toolbar button), never landing on the new content at all. Elements
   * that aren't naturally focusable (a `<body>`, a heading, ordinary
   * text) need `tabindex="-1"` added first to accept programmatic focus
   * without becoming part of the normal Tab order.
   */
  public focusContent(document: Document, target?: Element): void {
    const element = target ?? document.body;
    if (!element) {
      return;
    }
    if (!element.hasAttribute("tabindex")) {
      element.setAttribute("tabindex", "-1");
    }
    // `preventScroll` is essential here: the content document's scroll
    // position is not a free variable a browser default should ever
    // touch — paginated mode owns it entirely via a `transform` (see
    // `PaginatedContentHost.showCurrentPage`) and scroll mode owns it via
    // `ScrollViewEngine`. Without `preventScroll`, the browser's default
    // scroll-into-view-on-focus behavior fights with (and partially wins
    // against) that transform, silently eating into the reserved
    // `PAGE_INSET_TOP` margin and letting text creep up toward the
    // toolbar on every navigation that moves focus — a real regression
    // caught via real-Chromium measurement, not merely theoretical.
    (element as HTMLElement).focus({ preventScroll: true });
  }
}
