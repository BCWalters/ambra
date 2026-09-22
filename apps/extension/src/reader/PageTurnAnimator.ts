import { PaginatedContentHost, ReadingTheme, SpreadPaginatedHost } from "@ambra/engine";
import type { PageTheme } from "@ambra/engine";
import { HEADER_TEXT_TOP_OFFSET } from "./furnitureLayout.js";
import type { PageTurnAnimationStyle } from "./PageTurnAnimationStyle.js";

/** What `PageTurnAnimator` needs from `ReaderController` — plain
 * getters only; this class owns no reader state of its own. */
export interface PageTurnAnimatorContext {
  rtl?(): boolean;
  containerEl(): HTMLElement | undefined;
  height(): number;
  pageTheme(): PageTheme;
  pageTurnAnimationStyle(): PageTurnAnimationStyle;
}

/** The pure mechanics behind an animated page turn: building the
 * backdrop/growth-mask/furniture-overlay/rotate-back-face elements a
 * turn needs, staging and playing the CSS transition, and the shared
 * geometry helpers both the click-triggered and drag-gesture turn
 * paths use. Deliberately *not* the turn orchestration itself
 * (`turnPage`/`openSpineItem`, `animatePageTurn`/`animateSpreadTurn`,
 * the drag-gesture lifecycle) — those stay in `ReaderController`,
 * threaded through spine navigation and host swapping. */
export class PageTurnAnimator {
  constructor(private readonly ctx: PageTurnAnimatorContext) {}

  private prefersReducedMotion(): boolean {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  }

  /** Whether to skip the page-turn animation entirely — OS-level
   * `prefers-reduced-motion`, or the reader's own "off" choice (issue
   * #69). */
  public shouldSkipPageTurnAnimation(): boolean {
    return this.ctx.pageTurnAnimationStyle() === "none" || this.prefersReducedMotion();
  }

  /** An opaque backdrop behind the animating side of a "slide" turn,
   * sized to the pane's full height. "slide" leaves the animating host
   * at its own natural (often short) height with `clip-path` dropped
   * for the turn's duration, so without this the static host behind it
   * shows through the gap below a short page (issue #84). */
  public buildTurnBackdrop(matchEl: HTMLElement): HTMLDivElement | undefined {
    const containerEl = this.ctx.containerEl();
    if (!containerEl) {
      return undefined;
    }
    const containerRect = containerEl.getBoundingClientRect();
    const matchRect = matchEl.getBoundingClientRect();
    const backdrop = document.createElement("div");
    backdrop.setAttribute("aria-hidden", "true");
    backdrop.style.position = "absolute";
    backdrop.style.left = `${matchRect.left - containerRect.left}px`;
    backdrop.style.top = `${matchRect.top - containerRect.top}px`;
    backdrop.style.width = `${matchRect.width}px`;
    backdrop.style.height = `${this.ctx.height()}px`;
    backdrop.style.pointerEvents = "none";
    backdrop.style.background = ReadingTheme.PAGE_THEMES[this.ctx.pageTheme()].background;
    return backdrop;
  }

  /** A mask covering the region a "rotate" turn's height-growing
   * exposes below `matchEl`'s natural height, painted over (not
   * behind) the content — growing height also needs `clip-path`
   * dropped, which otherwise bleeds in whatever follows in the source
   * document below the short page (issue #84's rotate counterpart). */
  public buildTurnGrowthMask(matchEl: HTMLElement, naturalHeight: number): HTMLDivElement | undefined {
    const containerEl = this.ctx.containerEl();
    if (!containerEl) {
      return undefined;
    }
    const containerRect = containerEl.getBoundingClientRect();
    const matchRect = matchEl.getBoundingClientRect();
    const maskHeight = this.ctx.height() - naturalHeight;
    if (maskHeight <= 0) {
      return undefined;
    }
    const mask = document.createElement("div");
    mask.setAttribute("aria-hidden", "true");
    mask.style.position = "absolute";
    mask.style.left = `${matchRect.left - containerRect.left}px`;
    mask.style.top = `${matchRect.top - containerRect.top + naturalHeight}px`;
    mask.style.width = `${matchRect.width}px`;
    mask.style.height = `${maskHeight}px`;
    mask.style.pointerEvents = "none";
    mask.style.background = ReadingTheme.PAGE_THEMES[this.ctx.pageTheme()].background;
    return mask;
  }

  /** The running header/footer overlay for one side of an animated
   * turn — a separate sibling positioned over `matchEl` (an iframe
   * can't hold light-DOM children), since `stagePageTurn`/
   * `setPageTurnTransform` apply the same transform to both so they
   * move as one piece. Sized to the pane's full height rather than
   * `matchEl`'s own (often shorter, e.g. a chapter's last page)
   * height, so the footer band doesn't ride up during the turn. Each
   * `bands` entry is one visual page's header+footer, positioned
   * relative to `matchEl`'s own rect (one entry for a single page or a
   * spread's "rotate" turn, two for a spread's "slide" turn). Header/
   * footer bands use `box-sizing: border-box` since an explicit
   * `width` plus padding otherwise pushes text ~20-40px off from where
   * the static `PageFurniture` places the same text. */
  public buildTurnFurnitureOverlay(
    matchEl: HTMLElement,
    bands: Array<{
      left: number;
      width: number;
      header: { mode: "split"; left: string; right: string } | { mode: "single"; text: string };
      footerText: string | undefined;
    }>,
  ): HTMLDivElement | undefined {
    const containerEl = this.ctx.containerEl();
    if (!containerEl) {
      return undefined;
    }
    const containerRect = containerEl.getBoundingClientRect();
    const matchRect = matchEl.getBoundingClientRect();
    const foreground = ReadingTheme.PAGE_THEMES[this.ctx.pageTheme()].foreground;
    const background = ReadingTheme.PAGE_THEMES[this.ctx.pageTheme()].background;

    const overlay = document.createElement("div");
    overlay.setAttribute("aria-hidden", "true");
    overlay.style.position = "absolute";
    overlay.style.left = `${matchRect.left - containerRect.left}px`;
    overlay.style.top = `${matchRect.top - containerRect.top}px`;
    overlay.style.width = `${matchRect.width}px`;
    overlay.style.height = `${this.ctx.height()}px`;
    overlay.style.pointerEvents = "none";

    // References Fluent's typography tokens as CSS custom properties
    // rather than hardcoding a font stack — a hardcoded stack can
    // resolve to a visibly different typeface than Fluent's own
    // fallback chain on a given OS (issue #85), reading as a font-size
    // change even though the value never changed.
    const textStyle =
      `color: ${foreground}; opacity: 0.55; min-width: 0; ` +
      `font-family: var(--fontFamilyBase); font-size: var(--fontSizeBase200); ` +
      `font-weight: var(--fontWeightRegular); line-height: var(--lineHeightBase200); ` +
      `white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`;

    for (const band of bands) {
      const header = document.createElement("div");
      header.style.cssText =
        `position: absolute; top: 0; left: ${band.left}px; width: ${band.width}px; ` +
        `box-sizing: border-box; height: ${ReadingTheme.PAGE_INSET_TOP}px; display: flex; ` +
        `align-items: flex-start; justify-content: ${band.header.mode === "split" ? "space-between" : "center"}; ` +
        `padding: ${HEADER_TEXT_TOP_OFFSET}px 20px 0; overflow: hidden; background: ${background};`;
      // This opaque background does real work: every caller has
      // dropped `clip-path` on `matchEl` for the turn, which otherwise
      // lets the previous page's last line bleed in above this
      // header band.
      if (band.header.mode === "split") {
        const left = document.createElement("span");
        left.style.cssText = textStyle;
        left.textContent = band.header.left;
        const right = document.createElement("span");
        right.style.cssText = `${textStyle} text-align: right;`;
        right.textContent = band.header.right;
        header.append(left, right);
      } else {
        const span = document.createElement("span");
        span.style.cssText = `${textStyle} text-align: center;`;
        span.textContent = band.header.text;
        header.append(span);
      }
      overlay.appendChild(header);

      if (band.footerText !== undefined) {
        const footer = document.createElement("div");
        footer.style.cssText =
          `position: absolute; bottom: 0; left: ${band.left}px; width: ${band.width}px; ` +
          `box-sizing: border-box; height: ${ReadingTheme.PAGE_INSET_BOTTOM}px; display: flex; ` +
          `align-items: center; justify-content: center; background: ${background};`;
        const span = document.createElement("span");
        span.style.cssText = textStyle;
        span.textContent = band.footerText;
        footer.appendChild(span);
        overlay.appendChild(footer);
      }
    }
    return overlay;
  }

  /** Which element a turn's transform actually applies to — the host's
   * own element, except a spread's "rotate" style, which turns only
   * the column nearest the spine rather than the whole two-page unit.
   * Falls back to the whole spread if that column can't be resolved
   * (defensive; not observed in practice). */
  public elementToTurn(host: PaginatedContentHost | SpreadPaginatedHost): HTMLElement {
    if (!(host instanceof SpreadPaginatedHost) || this.ctx.pageTurnAnimationStyle() !== "rotate") {
      return host.element;
    }
    return this.spreadColumnElement(host, 1);
  }

  /** Resolves one column's iframe element out of a `SpreadPaginatedHost`
   * — delegates to `columnElement`, which correctly resolves "left" to
   * whichever element occupies that slot even while merged (unlike
   * indexing into `contentDocuments()`, which can have three entries
   * while merged). */
  public spreadColumnElement(host: SpreadPaginatedHost, columnIndex: 0 | 1): HTMLElement {
    return host.columnElement((columnIndex === 0) !== !!this.ctx.rtl?.() ? "left" : "right");
  }

  /** The plain page-themed "back face" a spread's rotate turn needs to
   * complete the flip past 90° instead of visibly vanishing mid-air
   * (issue #81) — a sibling of `turnEl` (never a wrapper; `turnEl`
   * itself must never be reparented, which reloads an iframe in most
   * browsers), with an inner layer fixed at `rotateY(180deg)` so it
   * faces the viewer exactly as `turnEl`'s own face turns away. */
  public buildRotateBackFace(turnEl: HTMLElement): HTMLDivElement | undefined {
    const parent = turnEl.parentElement;
    if (!parent) {
      return undefined;
    }
    const doc = parent.ownerDocument;
    const parentRect = parent.getBoundingClientRect();
    const turnRect = turnEl.getBoundingClientRect();

    const outer = doc.createElement("div");
    outer.style.position = "absolute";
    outer.style.left = `${turnRect.left - parentRect.left}px`;
    outer.style.top = `${turnRect.top - parentRect.top}px`;
    outer.style.width = `${turnRect.width}px`;
    outer.style.height = `${turnRect.height}px`;
    outer.style.transformStyle = "preserve-3d";
    outer.style.pointerEvents = "none";

    const inner = doc.createElement("div");
    inner.style.position = "absolute";
    inner.style.inset = "0";
    inner.style.background = ReadingTheme.PAGE_THEMES[this.ctx.pageTheme()].background;
    inner.style.backfaceVisibility = "hidden";
    inner.style.transform = "rotateY(180deg)";
    outer.appendChild(inner);

    parent.appendChild(outer);
    return outer;
  }

  /** Plays and awaits the turn transition: stages `hostEl`/`turnEl`,
   * animates `turnEl`'s transform to fully-turned (or resets it to 0
   * for `entering`, a backward turn's mirrored start-from-turned-away
   * sequence), and resolves on `transitionend` or a 600ms safety-net
   * timeout. Does not swap in the new host — callers do that after.
   * `extraTurnEls` (the furniture overlay, if any) get every style
   * mutation `turnEl` gets, so header/footer move with the page. */
  public async playPageTurnAnimation(
    hostEl: HTMLElement,
    turnEl: HTMLElement,
    direction: 1 | -1,
    extraTurnEls: HTMLElement[] = [],
    entering = false,
    fullTurnDegrees?: number,
  ): Promise<void> {
    if (this.shouldSkipPageTurnAnimation()) {
      return;
    }
    this.stagePageTurn(hostEl, turnEl, direction, extraTurnEls, entering);

    // Overshoots to 100 (not 90) so the page reads as continuing out of
    // view rather than freezing edge-on. `fullTurnDegrees` (issue #81)
    // overrides this to 180 for a spread's rotate turn, continuing flat
    // onto its own back face.
    const fullyTurnedAmount = this.physicalDirection(direction) * -(fullTurnDegrees ?? 100);

    if (entering) {
      this.setPageTurnTransform(turnEl, -fullyTurnedAmount, 1, extraTurnEls);
      // Forces layout to commit the starting transform before the
      // transition below changes it — otherwise the whole transition
      // collapses into an instant jump (confirmed via DOM inspection).
      for (const el of [turnEl, ...extraTurnEls]) {
        void el.offsetHeight;
      }
    }

    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) {
          return;
        }
        settled = true;
        turnEl.removeEventListener("transitionend", onTransitionEnd);
        resolve();
      };
      const onTransitionEnd = (event: TransitionEvent): void => {
        if (event.target === turnEl && event.propertyName === "transform") {
          finish();
        }
      };
      turnEl.addEventListener("transitionend", onTransitionEnd);
      const transition = "transform 380ms cubic-bezier(0.4, 0, 0.2, 1), box-shadow 380ms ease";
      for (const el of [turnEl, ...extraTurnEls]) {
        // Same offsetHeight-forced-layout reasoning as above, for any
        // freshly-inserted furniture overlay.
        void el.offsetHeight;
        el.style.transition = transition;
      }
      requestAnimationFrame(() => {
        this.setPageTurnTransform(turnEl, entering ? 0 : fullyTurnedAmount, entering ? 0 : 1, extraTurnEls);
      });
      // Safety net in case transitionend never fires (e.g. the element
      // was removed mid-transition).
      setTimeout(finish, 600);
    });
    const containerEl = this.ctx.containerEl();
    if (containerEl) {
      containerEl.style.perspective = "";
    }
  }

  /** The "scroll"/filmstrip turn style (issue #63): unlike
   * "rotate"/"slide", both the outgoing and incoming content move
   * together, a page-width apart throughout, like two train cars — no
   * elevation/3D staging needed, just a flat `translateX` on both. */
  public async playScrollTurn(
    oldGroup: readonly HTMLElement[],
    newGroup: readonly HTMLElement[],
    direction: 1 | -1,
  ): Promise<void> {
    if (this.shouldSkipPageTurnAnimation()) {
      return;
    }
    const exitAmount = this.physicalDirection(direction) * -100;
    const enterStart = this.physicalDirection(direction) * 100;

    for (const el of newGroup) {
      el.style.transform = `translateX(${enterStart}%)`;
    }
    // Forces a reflow so the transition below has a committed "before"
    // state to animate away from.
    for (const el of [...oldGroup, ...newGroup]) {
      void el.offsetHeight;
    }

    const transition = "transform 380ms cubic-bezier(0.4, 0, 0.2, 1)";
    const primaryEl = oldGroup[0];
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) {
          return;
        }
        settled = true;
        primaryEl?.removeEventListener("transitionend", onTransitionEnd);
        resolve();
      };
      const onTransitionEnd = (event: TransitionEvent): void => {
        if (event.target === primaryEl && event.propertyName === "transform") {
          finish();
        }
      };
      if (primaryEl) {
        primaryEl.addEventListener("transitionend", onTransitionEnd);
      }
      for (const el of [...oldGroup, ...newGroup]) {
        el.style.transition = transition;
      }
      requestAnimationFrame(() => {
        for (const el of oldGroup) {
          el.style.transform = `translateX(${exitAmount}%)`;
        }
        for (const el of newGroup) {
          el.style.transform = "translateX(0%)";
        }
      });
      setTimeout(finish, 600);
    });
  }

  /** Puts `hostEl` into "ready to turn" state — elevated above the
   * incoming content underneath — without touching any `transform`
   * yet. Shared setup for both click-triggered and drag-driven turns.
   * `turnEl` is what will actually animate: the same as `hostEl` except
   * a spread's "rotate" style, where it's just the spine-side column
   * (see `elementToTurn`) while `hostEl` (the whole spread) still gets
   * elevated so its non-turning companion column stays on top too.
   * "rotate" needs 3D perspective/hinge/backface setup; "slide" and
   * "none" are flat 2D translates needing none of that. */
  public stagePageTurn(
    hostEl: HTMLElement,
    turnEl: HTMLElement,
    direction: 1 | -1,
    extraTurnEls: HTMLElement[] = [],
    entering = false,
  ): void {
    const containerEl = this.ctx.containerEl();
    if (!containerEl) {
      return;
    }
    // A backward (entering) turn's hostEl is the incoming host, already
    // positioned `absolute` to overlap the outgoing one — downgrading
    // that to `relative` here would drop it back into normal flex flow
    // as a sibling instead (confirmed bug: both rendered side by side).
    if (hostEl.style.position !== "absolute") {
      hostEl.style.position = "relative";
    }
    hostEl.style.zIndex = "2";
    if (this.ctx.pageTurnAnimationStyle() !== "rotate") {
      return;
    }
    containerEl.style.perspective = "2200px";
    hostEl.style.transformStyle = "preserve-3d";
    // A backward turn's entering element is the same page a forward
    // turn would send away in the opposite direction, so its hinge
    // mirrors plain `direction`.
    const physical = this.physicalDirection(direction);
    const hingeDirection = entering ? -physical : physical;
    const transformOrigin = `${hingeDirection === 1 ? "left" : "right"} center`;
    for (const el of [turnEl, ...extraTurnEls]) {
      el.style.backfaceVisibility = "hidden";
      el.style.transformOrigin = transformOrigin;
    }
  }

  /** Scales a 0–1 drag fraction into the current style's own unit:
   * degrees for "rotate" (quarter turn at 1), percent for "slide"/
   * "none" (full page-width at 1) — signed so the outgoing page always
   * moves "out of view" the same way for a given direction. */
  public pageTurnPartialAmount(direction: 1 | -1, fraction: number): number {
    const scale = this.ctx.pageTurnAnimationStyle() !== "rotate" ? 100 : 90;
    return this.physicalDirection(direction) * -scale * fraction;
  }

  /** The entering page's transform during a "scroll"-style drag (issue
   * #63) — starts fully off-screen and approaches 0 as `fraction`
   * nears 1, in lockstep with the outgoing page leaving. Only called
   * for the "scroll" style; every other style leaves the entering page
   * untouched during a drag. */
  public scrollDragEnterAmount(direction: 1 | -1, fraction: number): number {
    return this.physicalDirection(direction) * 100 * (1 - fraction);
  }

  private physicalDirection(direction: 1 | -1): number {
    return this.ctx.rtl?.() ? -direction : direction;
  }

  /** Sets `el`'s in-progress transform directly (no transition) for
   * the current style, plus a shadow that deepens with `fraction` so a
   * partial drag reads as physically lifting/sliding. `extraEls` get
   * the same treatment in lockstep. */
  public setPageTurnTransform(el: HTMLElement, amount: number, fraction: number, extraEls: HTMLElement[] = []): void {
    for (const target of [el, ...extraEls]) {
      if (this.ctx.pageTurnAnimationStyle() !== "rotate") {
        target.style.transform = `translateX(${amount}%)`;
        // Shadow falls on the trailing (most recently uncovered) edge.
        const edge = amount < 0 ? "" : "-";
        target.style.boxShadow = `${edge}16px 0 32px rgba(0, 0, 0, ${(0.3 * fraction).toFixed(3)})`;
        continue;
      }
      target.style.transform = `rotateY(${amount}deg)`;
      // A real page catches its own shadow as it turns away from the
      // light (issue #81) — an added inset shadow alongside the usual
      // drop shadow, both deepening with `fraction`.
      const selfShade = (0.3 * fraction).toFixed(3);
      target.style.boxShadow =
        `0 12px 40px rgba(0, 0, 0, ${(0.35 * fraction).toFixed(3)}), ` +
        `inset 0 0 ${Math.round(60 * fraction)}px rgba(0, 0, 0, ${selfShade})`;
    }
  }
}
