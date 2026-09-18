/** Callbacks `AccessibilityController.attach` invokes for keyboard-driven
 * navigation. What "next"/"previous" mean is up to the caller — typically
 * "turn one page" in paginated mode, or "go to the next/previous chapter"
 * in scroll/fixed-layout mode, where there's no discrete page concept. */
export interface AccessibilityNavigationHandlers {
  onNext: () => void;
  onPrevious: () => void;
  /** Jump a whole chapter forward/backward, bound to Ctrl/Cmd+ArrowRight/
   * ArrowLeft — unlike `onNext`/`onPrevious`, this always means "chapter"
   * regardless of view mode, distinct from a plain page turn. Optional
   * (and simply not wired up) for any future caller that has no notion
   * of chapters at all; every current caller provides both. */
  onNextChapter?: () => void;
  onPreviousChapter?: () => void;
}

/**
 * Keyboard navigation and managed focus for the reading surface, shared
 * across paginated, continuous-scroll, and fixed-layout content hosts.
 * ARIA landmarks and live-region announcements for the surrounding shell
 * UI are the reader page's own responsibility (see `apps/extension`'s
 * `ReaderApp`/`Toolbar`) — this class is scoped to the sandboxed content
 * document itself, which the shell doesn't otherwise reach into.
 *
 * Usually manages exactly one attached document (whichever content host
 * is current), but supports more than one at once — see `attachments` —
 * for a two-page spread's companion column.
 */
export class AccessibilityController {
  /** One keydown handler per currently-attached document — almost always
   * just the single primary content document, but a two-page spread (see
   * `SpreadPaginatedHost`) attaches a *second* entry for its companion
   * column too, so that a reader who clicks into the right-hand page (to
   * read it, or to select text there) still has working keyboard page
   * navigation — see `ReaderController.reattachKeyboardNav`. Keyed by
   * `Document` rather than a single field so `attach`ing a new document
   * never disturbs whichever other document(s) already have their own
   * listener. */
  private readonly attachments = new Map<Document, (event: KeyboardEvent) => void>();

  /**
   * Wires `ArrowLeft`/`ArrowRight` (and, unless `interceptSpace` is
   * `false`, `Space`/`Shift+Space`) navigation directly onto `document` —
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
   * `interceptSpace` defaults to `true` (matching Space's conventional
   * "advance" meaning in essentially every reading app) but the caller
   * passes `false` for continuous-scroll content specifically, where
   * Space's native "scroll down one viewport" behavior already serves
   * the exact same "move forward through the book" purpose *and* is a
   * more useful, finer-grained action than a hypothetical "next chapter"
   * would be — overriding it there would take away a well-understood
   * browser behavior for a strictly worse replacement. Up/Down/PageUp/
   * PageDown are always left untouched for the same "don't fight native
   * scrolling" reasoning. Replaces any previously attached listener *for
   * this same document* — other documents already attached (see the
   * class doc comment on `attachments`) are left alone.
   *
   * Also wires Ctrl/Cmd+ArrowRight and Ctrl/Cmd+ArrowLeft to
   * `onNextChapter`/`onPreviousChapter` (when provided) — a standard,
   * discoverable "jump a whole chapter" shortcut, checked before the
   * plain-arrow branch so the modifier key changes what the arrow does
   * rather than triggering both. Added to replace the toolbar's old
   * compass "Navigate" menu (issue follow-up: that menu's Chapter
   * prev/next buttons were removed as redundant screen-clutter now that
   * this shortcut exists, alongside the Table of Contents and progress
   * scrubber for the same purpose).
   */
  public attach(
    document: Document,
    handlers: AccessibilityNavigationHandlers,
    options: { interceptSpace?: boolean } = {},
  ): void {
    this.detach(document);
    const interceptSpace = options.interceptSpace ?? true;

    const keydownHandler = (event: KeyboardEvent): void => {
      const chapterModifier = event.ctrlKey || event.metaKey;
      if (chapterModifier && event.key === "ArrowRight") {
        event.preventDefault();
        handlers.onNextChapter?.();
      } else if (chapterModifier && event.key === "ArrowLeft") {
        event.preventDefault();
        handlers.onPreviousChapter?.();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        handlers.onNext();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        handlers.onPrevious();
      } else if (interceptSpace && event.key === " ") {
        event.preventDefault();
        if (event.shiftKey) {
          handlers.onPrevious();
        } else {
          handlers.onNext();
        }
      }
    };

    document.addEventListener("keydown", keydownHandler);
    this.attachments.set(document, keydownHandler);
  }

  /** Removes the keyboard listener for `document`, if any — or, when
   * called with no argument, every currently-attached document at once
   * (the common case: tearing down before a fresh spine item's iframe(s)
   * take over, or on full controller disposal). */
  public detach(document?: Document): void {
    if (document) {
      const handler = this.attachments.get(document);
      if (handler) {
        document.removeEventListener("keydown", handler);
        this.attachments.delete(document);
      }
      return;
    }
    for (const [attachedDocument, handler] of this.attachments) {
      attachedDocument.removeEventListener("keydown", handler);
    }
    this.attachments.clear();
  }

  /**
   * Moves focus to `target` (or `document.body` if omitted), the standard
   * "managed focus" technique for after a navigation event: without it, a
   * screen reader user's reading cursor stays wherever it was (e.g. a
   * toolbar button), never landing on the new content at all. Elements
   * that aren't naturally focusable (a `<body>`, a heading, ordinary
   * text) need `tabindex="-1"` added first to accept programmatic focus
   * without becoming part of the normal Tab order.
   *
   * Also explicitly focuses the content iframe *element itself* (in the
   * parent document, via `document.defaultView.frameElement` — accessible
   * here because the sandboxed iframe is same-origin, just script-
   * disabled) before focusing anything inside it. This was a real,
   * reported bug found via testing in real Chromium: focusing an element
   * *inside* a cross-document iframe from the parent's context updates
   * that inner document's own `activeElement` correctly, but does *not*
   * reliably also transfer the browser's page-level "active frame" to
   * that iframe if some *other* element in the parent document (e.g. a
   * just-clicked toolbar/panel button) currently holds it — leaving the
   * parent's `document.activeElement` on that button. Since
   * `AccessibilityController.attach`'s Left/Right keyboard listener is
   * itself attached to the content document (keyboard events don't
   * bubble out of an iframe), a reader closing any parent-document
   * overlay with the mouse would find arrow-key navigation silently do
   * nothing afterward, with no visible sign of why.
   */
  public focusContent(document: Document, target?: Element): void {
    const element = target ?? document.body;
    if (!element) {
      return;
    }
    if (!element.hasAttribute("tabindex")) {
      element.setAttribute("tabindex", "-1");
    }
    const frameElement = document.defaultView?.frameElement;
    if (frameElement instanceof HTMLElement) {
      frameElement.focus({ preventScroll: true });
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
