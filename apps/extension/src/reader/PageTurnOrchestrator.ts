import { FixedContentHost, PaginatedContentHost, SpreadPaginatedHost } from "@ambra/engine";
import { PageTurnAnimator } from "./PageTurnAnimator.js";
import type { PageTurnAnimatorContext } from "./PageTurnAnimator.js";

/** What `PageTurnOrchestrator` needs from `ReaderController` beyond what
 * `PageTurnAnimator` already asks for — plain getters/setters only, this
 * class owns no reader state of its own. `setAnimatingPageTurn` and
 * `notify` are called separately (not bundled into one setter) because
 * the caller's own start/end pairing isn't symmetric: turning *on*
 * always accompanies a `notify()` so the UI can show turn-in-progress
 * chrome, but turning back *off* deliberately doesn't — the host swap
 * that follows notifies once for both at the same time. */
export interface PageTurnOrchestratorContext extends PageTurnAnimatorContext {
  width(): number;
  setAnimatingPageTurn(isAnimating: boolean): void;
  notify(): void;
}

/** Plain display data for one in-chapter page turn's temporary header/
 * footer overlays, computed by `ReaderController` from book/pagination
 * state — the orchestrator itself never reaches back into spine/TOC/
 * pagination concerns, it just paints what it's given. */
export interface PageTurnFurnitureInfo {
  title: string;
  chapterLabel: string;
  outgoingPage: number | undefined;
  incomingPage: number | undefined;
}

/** Same idea for a two-page spread turn — separate primary/secondary
 * page numbers per side, and separate outgoing/incoming chapter labels
 * because a merge turn's incoming side belongs to the next chapter. */
export interface SpreadPageTurnFurnitureInfo {
  title: string;
  outgoingChapterLabel: string;
  incomingChapterLabel: string;
  outgoingPrimaryPage: number | undefined;
  outgoingSecondaryPage: number | undefined;
  incomingPrimaryPage: number | undefined;
  incomingSecondaryPage: number | undefined;
}

/**
 * Owns the actual turn-orchestration sequence for every animated page
 * turn: which clip-path/height workarounds a style needs, which
 * backdrop/mask/furniture-overlay elements to build, which transition to
 * play, and cleaning up afterward — split into one dedicated method per
 * style (`rotate`/`slide`/`scroll`/`none`) rather than one large function
 * with `if (style === ...)` branches threaded through it, so adding a
 * future style only ever means adding one new method, never touching the
 * existing three.
 *
 * Takes real, already-prepared `oldHost`/`newHost` pairs — deciding
 * *whether* a turn is possible (would it cross a chapter boundary? does a
 * mergeable next chapter exist?) stays a `ReaderController` concern,
 * resolved before this class is ever called into.
 *
 * Deliberately not `PageTurnAnimator` itself (constructed with one,
 * injected): that class stays the pure low-level mechanics (building one
 * overlay element, staging/playing one CSS transition) shared by every
 * turn path, including the drag-gesture ones this class doesn't cover
 * yet — `ReaderController.animateChapterCrossingReveal` (the drag-release
 * chapter-boundary turn) still lives there, its own `if (style === ...)`
 * branches un-split, as the natural next step for whoever picks this up
 * again.
 */
export class PageTurnOrchestrator {
  public constructor(
    private readonly ctx: PageTurnOrchestratorContext,
    private readonly animator: PageTurnAnimator,
  ) {}

  /** Animates an in-chapter single-page turn between two already-open
   * hosts and disposes `oldHost` once it settles. */
  public async animatePageTurn(
    oldHost: PaginatedContentHost,
    newHost: PaginatedContentHost,
    direction: 1 | -1,
    furniture: PageTurnFurnitureInfo,
  ): Promise<void> {
    switch (this.ctx.pageTurnAnimationStyle()) {
      case "rotate":
        return this.rotatePageTurn(oldHost, newHost, direction, furniture);
      case "slide":
        return this.slidePageTurn(oldHost, newHost, direction, furniture);
      case "scroll":
        return this.scrollPageTurn(oldHost, newHost, direction, furniture);
      case "none":
        return this.finishPageTurn(oldHost, newHost, []);
    }
  }

  /** "rotate": suppresses clip-path on both hosts (overlapping clipped
   * iframes do not composite correctly in Chromium), grows the animating
   * host to full height (measured before suppression drops its own
   * clip), and turns a real 3D page so it lands visibly instead of
   * freezing edge-on. */
  private async rotatePageTurn(
    oldHost: PaginatedContentHost,
    newHost: PaginatedContentHost,
    direction: 1 | -1,
    furniture: PageTurnFurnitureInfo,
  ): Promise<void> {
    const containerEl = this.ctx.containerEl()!;
    const entering = direction === -1;
    const animatingHost = entering ? newHost : oldHost;
    const otherHost = entering ? oldHost : newHost;
    animatingHost.suppressClipPathForAnimation();
    const animatingNaturalHeight = animatingHost.element.getBoundingClientRect().height;
    animatingHost.growToFullHeight(this.ctx.height());
    otherHost.suppressClipPathForAnimation();

    let turnGrowthMask: HTMLDivElement | undefined;
    let outgoingOverlay: HTMLDivElement | undefined;
    let incomingOverlay: HTMLDivElement | undefined;
    if (!this.animator.shouldSkipPageTurnAnimation()) {
      turnGrowthMask = this.animator.buildTurnGrowthMask(animatingHost.element, animatingNaturalHeight);
      if (turnGrowthMask) {
        turnGrowthMask.style.zIndex = "2";
        animatingHost.element.parentElement?.insertBefore(turnGrowthMask, animatingHost.element.nextSibling);
      }
      ({ outgoing: outgoingOverlay, incoming: incomingOverlay } = this.buildInChapterOverlays(
        oldHost.element,
        newHost.element,
        furniture,
      ));
      this.stackOverlays(containerEl, outgoingOverlay, incomingOverlay, entering, false);
      this.ctx.setAnimatingPageTurn(true);
      this.ctx.notify();
    }

    const turnEl = entering ? newHost.element : oldHost.element;
    const animatedOverlay = entering ? incomingOverlay : outgoingOverlay;
    await this.animator.playPageTurnAnimation(
      turnEl,
      turnEl,
      direction,
      [...(animatedOverlay ? [animatedOverlay] : []), ...(turnGrowthMask ? [turnGrowthMask] : [])],
      entering,
    );

    this.finishPageTurn(oldHost, newHost, [outgoingOverlay, incomingOverlay, turnGrowthMask]);
  }

  /** "slide": drops clip-path from both hosts the same way "rotate"
   * does, plus an opaque backdrop behind the animating side — "slide"
   * leaves a short page at its own natural height, so without a
   * backdrop the static host underneath shows through the gap. */
  private async slidePageTurn(
    oldHost: PaginatedContentHost,
    newHost: PaginatedContentHost,
    direction: 1 | -1,
    furniture: PageTurnFurnitureInfo,
  ): Promise<void> {
    const containerEl = this.ctx.containerEl()!;
    const entering = direction === -1;
    const animatingHost = entering ? newHost : oldHost;
    const otherHost = entering ? oldHost : newHost;
    animatingHost.suppressClipPathForAnimation();
    otherHost.suppressClipPathForAnimation();

    let turnBackdrop: HTMLDivElement | undefined;
    let outgoingOverlay: HTMLDivElement | undefined;
    let incomingOverlay: HTMLDivElement | undefined;
    if (!this.animator.shouldSkipPageTurnAnimation()) {
      turnBackdrop = this.animator.buildTurnBackdrop(animatingHost.element);
      if (turnBackdrop) {
        turnBackdrop.style.zIndex = "2";
        animatingHost.element.parentElement?.insertBefore(turnBackdrop, animatingHost.element);
      }
      ({ outgoing: outgoingOverlay, incoming: incomingOverlay } = this.buildInChapterOverlays(
        oldHost.element,
        newHost.element,
        furniture,
      ));
      this.stackOverlays(containerEl, outgoingOverlay, incomingOverlay, entering, false);
      this.ctx.setAnimatingPageTurn(true);
      this.ctx.notify();
    }

    const turnEl = entering ? newHost.element : oldHost.element;
    const animatedOverlay = entering ? incomingOverlay : outgoingOverlay;
    await this.animator.playPageTurnAnimation(
      turnEl,
      turnEl,
      direction,
      [...(animatedOverlay ? [animatedOverlay] : []), ...(turnBackdrop ? [turnBackdrop] : [])],
      entering,
    );

    this.finishPageTurn(oldHost, newHost, [outgoingOverlay, incomingOverlay, turnBackdrop]);
  }

  /** "scroll": both the outgoing and incoming page move together, a
   * page-width apart throughout, like two train cars — no clip-path or
   * height workaround needed, just a flat `translateX` on both. */
  private async scrollPageTurn(
    oldHost: PaginatedContentHost,
    newHost: PaginatedContentHost,
    direction: 1 | -1,
    furniture: PageTurnFurnitureInfo,
  ): Promise<void> {
    const containerEl = this.ctx.containerEl()!;
    let outgoingOverlay: HTMLDivElement | undefined;
    let incomingOverlay: HTMLDivElement | undefined;
    if (!this.animator.shouldSkipPageTurnAnimation()) {
      ({ outgoing: outgoingOverlay, incoming: incomingOverlay } = this.buildInChapterOverlays(
        oldHost.element,
        newHost.element,
        furniture,
      ));
      this.stackOverlays(containerEl, outgoingOverlay, incomingOverlay, direction === -1, true);
      this.ctx.setAnimatingPageTurn(true);
      this.ctx.notify();
    }

    const oldGroup = [oldHost.element, ...(outgoingOverlay ? [outgoingOverlay] : [])];
    const newGroup = [newHost.element, ...(incomingOverlay ? [incomingOverlay] : [])];
    await this.animator.playScrollTurn(oldGroup, newGroup, direction);

    this.finishPageTurn(oldHost, newHost, [outgoingOverlay, incomingOverlay]);
  }

  /** Builds the shared "split" header overlay (book title on one side,
   * chapter label on the other) both sides of an in-chapter turn use —
   * every style except "rotate"'s spread variant, which has its own
   * per-column layout instead. */
  private buildInChapterOverlays(
    oldEl: HTMLElement,
    newEl: HTMLElement,
    furniture: PageTurnFurnitureInfo,
  ): { outgoing: HTMLDivElement | undefined; incoming: HTMLDivElement | undefined } {
    const header = { mode: "split" as const, left: furniture.title, right: furniture.chapterLabel };
    const outgoing = this.animator.buildTurnFurnitureOverlay(oldEl, [
      {
        left: 0,
        width: oldEl.getBoundingClientRect().width,
        header,
        footerText: furniture.outgoingPage !== undefined ? `Page ${furniture.outgoingPage}` : undefined,
      },
    ]);
    const incoming = this.animator.buildTurnFurnitureOverlay(newEl, [
      {
        left: 0,
        width: newEl.getBoundingClientRect().width,
        header,
        footerText: furniture.incomingPage !== undefined ? `Page ${furniture.incomingPage}` : undefined,
      },
    ]);
    return { outgoing, incoming };
  }

  /** Stacks a pair of overlays: "scroll" moves both together (append
   * both, same z-index, no ordering needed since they never overlap),
   * while the other styles put whichever one is actually moving on top
   * of the static one underneath. */
  private stackOverlays(
    containerEl: HTMLElement,
    outgoing: HTMLDivElement | undefined,
    incoming: HTMLDivElement | undefined,
    entering: boolean,
    isScroll: boolean,
  ): void {
    if (isScroll) {
      if (outgoing) {
        outgoing.style.zIndex = "2";
        containerEl.appendChild(outgoing);
      }
      if (incoming) {
        incoming.style.zIndex = "2";
        containerEl.appendChild(incoming);
      }
      return;
    }
    const animated = entering ? incoming : outgoing;
    const stationary = entering ? outgoing : incoming;
    if (stationary) {
      stationary.style.zIndex = "1";
      containerEl.appendChild(stationary);
    }
    if (animated) {
      animated.style.zIndex = "2";
      containerEl.appendChild(animated);
    }
  }

  /** Shared cleanup for every in-chapter single-page turn style: removes
   * whatever transient overlay/backdrop/mask elements were built, ends
   * the animating state, and resets the surviving host back to normal
   * positioning. */
  private finishPageTurn(
    oldHost: PaginatedContentHost,
    newHost: PaginatedContentHost,
    transientEls: readonly (HTMLElement | undefined)[],
  ): void {
    for (const el of transientEls) {
      el?.remove();
    }
    this.ctx.setAnimatingPageTurn(false);
    newHost.restoreNaturalHeight();
    oldHost.dispose();
    const newEl = newHost.element;
    newEl.style.position = "";
    newEl.style.top = "";
    newEl.style.left = "";
    newEl.style.transform = "";
    newEl.style.zIndex = "";
  }

  /** Animates an in-chapter two-page-spread turn between two
   * already-open hosts and disposes `oldHost` once it settles. */
  public async animateSpreadTurn(
    oldHost: SpreadPaginatedHost,
    newHost: SpreadPaginatedHost,
    direction: 1 | -1,
    furniture: SpreadPageTurnFurnitureInfo,
  ): Promise<void> {
    switch (this.ctx.pageTurnAnimationStyle()) {
      case "rotate":
        return this.rotateSpreadTurn(oldHost, newHost, direction, furniture);
      case "slide":
        return this.slideSpreadTurn(oldHost, newHost, direction, furniture);
      case "scroll":
        return this.scrollSpreadTurn(oldHost, newHost, direction, furniture);
      case "none":
        return this.finishSpreadTurn(oldHost, newHost, [], false);
    }
  }

  /** "rotate" only turns the spine-side (right) column, growing just
   * that column to full height and adding a back face so it lands
   * visibly past 90° instead of vanishing edge-on — the left column
   * stays put but still needs clip-path suppressed on both hosts (see
   * `animatePageTurn`'s own rotate case) and its own furniture overlay,
   * since it stays stacked above/below the other spread the whole time. */
  private async rotateSpreadTurn(
    oldHost: SpreadPaginatedHost,
    newHost: SpreadPaginatedHost,
    direction: 1 | -1,
    furniture: SpreadPageTurnFurnitureInfo,
  ): Promise<void> {
    const containerEl = this.ctx.containerEl()!;
    const entering = direction === -1;
    const turnHost = entering ? newHost : oldHost;
    const otherHost = entering ? oldHost : newHost;

    turnHost.suppressColumnClipPathForAnimation("right");
    const turnColumnNaturalHeight = this.animator.spreadColumnElement(turnHost, 1).getBoundingClientRect().height;
    turnHost.growColumnToFullHeight("right", this.ctx.height());
    turnHost.suppressColumnClipPathForAnimation("left");
    otherHost.suppressColumnClipPathForAnimation("left");
    otherHost.suppressColumnClipPathForAnimation("right");
    const turnEl = this.animator.spreadColumnElement(turnHost, 1);

    let turnGrowthMask: HTMLDivElement | undefined;
    let rotateBackFace: HTMLDivElement | undefined;
    let outgoingOverlay: HTMLDivElement | undefined;
    let incomingOverlay: HTMLDivElement | undefined;
    let outgoingLeftOverlay: HTMLDivElement | undefined;
    let incomingLeftOverlay: HTMLDivElement | undefined;
    if (!this.animator.shouldSkipPageTurnAnimation()) {
      turnGrowthMask = this.animator.buildTurnGrowthMask(turnEl, turnColumnNaturalHeight);
      if (turnGrowthMask) {
        turnGrowthMask.style.zIndex = "2";
        turnEl.parentElement?.insertBefore(turnGrowthMask, turnEl.nextSibling);
      }
      rotateBackFace = this.animator.buildRotateBackFace(turnEl);

      const oldColumnEl = this.animator.spreadColumnElement(oldHost, 1);
      const newColumnEl = this.animator.spreadColumnElement(newHost, 1);
      outgoingOverlay = this.buildSpreadColumnOverlay(oldColumnEl, furniture.outgoingChapterLabel, furniture.outgoingSecondaryPage);
      incomingOverlay = this.buildSpreadColumnOverlay(newColumnEl, furniture.incomingChapterLabel, furniture.incomingSecondaryPage);

      const oldLeftColumnEl = this.animator.spreadColumnElement(oldHost, 0);
      const newLeftColumnEl = this.animator.spreadColumnElement(newHost, 0);
      outgoingLeftOverlay = this.buildSpreadColumnOverlay(oldLeftColumnEl, furniture.title, furniture.outgoingPrimaryPage);
      incomingLeftOverlay = this.buildSpreadColumnOverlay(newLeftColumnEl, furniture.title, furniture.incomingPrimaryPage);

      this.stackOverlays(containerEl, outgoingOverlay, incomingOverlay, entering, false);
      this.stackSpreadLeftOverlays(containerEl, outgoingLeftOverlay, incomingLeftOverlay, entering);
      this.ctx.setAnimatingPageTurn(true);
      this.ctx.notify();
    }

    const animatedOverlayEl = entering ? incomingOverlay : outgoingOverlay;
    await this.animator.playPageTurnAnimation(
      turnHost.element,
      turnEl,
      direction,
      [
        ...(animatedOverlayEl ? [animatedOverlayEl] : []),
        ...(rotateBackFace ? [rotateBackFace] : []),
        ...(turnGrowthMask ? [turnGrowthMask] : []),
      ],
      entering,
      rotateBackFace ? 180 : undefined,
    );

    this.finishSpreadTurn(
      oldHost,
      newHost,
      [rotateBackFace, outgoingOverlay, incomingOverlay, outgoingLeftOverlay, incomingLeftOverlay, turnGrowthMask],
      true,
    );
  }

  /** "slide" moves the whole spread as one unit — both columns drop
   * clip-path together, and a single full-width backdrop (not a
   * per-column one) covers the gap behind a short turning spread. */
  private async slideSpreadTurn(
    oldHost: SpreadPaginatedHost,
    newHost: SpreadPaginatedHost,
    direction: 1 | -1,
    furniture: SpreadPageTurnFurnitureInfo,
  ): Promise<void> {
    const containerEl = this.ctx.containerEl()!;
    const entering = direction === -1;
    const turnHost = entering ? newHost : oldHost;
    const otherHost = entering ? oldHost : newHost;

    turnHost.suppressColumnClipPathForAnimation("left");
    turnHost.suppressColumnClipPathForAnimation("right");
    otherHost.suppressColumnClipPathForAnimation("left");
    otherHost.suppressColumnClipPathForAnimation("right");
    const turnEl = this.animator.elementToTurn(turnHost);

    let turnBackdrop: HTMLDivElement | undefined;
    let outgoingOverlay: HTMLDivElement | undefined;
    let incomingOverlay: HTMLDivElement | undefined;
    if (!this.animator.shouldSkipPageTurnAnimation()) {
      turnBackdrop = this.animator.buildTurnBackdrop(turnHost.element);
      if (turnBackdrop) {
        turnBackdrop.style.zIndex = "2";
        turnHost.element.parentElement?.insertBefore(turnBackdrop, turnHost.element);
      }
      ({ outgoing: outgoingOverlay, incoming: incomingOverlay } = this.buildSpreadBandOverlays(
        oldHost.element,
        newHost.element,
        furniture,
      ));
      this.stackOverlays(containerEl, outgoingOverlay, incomingOverlay, entering, false);
      this.ctx.setAnimatingPageTurn(true);
      this.ctx.notify();
    }

    const animatedOverlayEl = entering ? incomingOverlay : outgoingOverlay;
    await this.animator.playPageTurnAnimation(
      turnHost.element,
      turnEl,
      direction,
      [...(animatedOverlayEl ? [animatedOverlayEl] : []), ...(turnBackdrop ? [turnBackdrop] : [])],
      entering,
    );

    this.finishSpreadTurn(oldHost, newHost, [outgoingOverlay, incomingOverlay, turnBackdrop], true);
  }

  /** "scroll" moves the whole outgoing and incoming spread together,
   * like `scrollPageTurn` but for two-column groups. */
  private async scrollSpreadTurn(
    oldHost: SpreadPaginatedHost,
    newHost: SpreadPaginatedHost,
    direction: 1 | -1,
    furniture: SpreadPageTurnFurnitureInfo,
  ): Promise<void> {
    const containerEl = this.ctx.containerEl()!;
    let outgoingOverlay: HTMLDivElement | undefined;
    let incomingOverlay: HTMLDivElement | undefined;
    if (!this.animator.shouldSkipPageTurnAnimation()) {
      ({ outgoing: outgoingOverlay, incoming: incomingOverlay } = this.buildSpreadBandOverlays(
        oldHost.element,
        newHost.element,
        furniture,
      ));
      this.stackOverlays(containerEl, outgoingOverlay, incomingOverlay, direction === -1, true);
      this.ctx.setAnimatingPageTurn(true);
      this.ctx.notify();
    }

    const oldGroup = [oldHost.element, ...(outgoingOverlay ? [outgoingOverlay] : [])];
    const newGroup = [newHost.element, ...(incomingOverlay ? [incomingOverlay] : [])];
    await this.animator.playScrollTurn(oldGroup, newGroup, direction);

    this.finishSpreadTurn(oldHost, newHost, [outgoingOverlay, incomingOverlay], false);
  }

  /** The "slide"/"scroll" furniture overlay: one two-band overlay per
   * side (left column's own title/page-number, right column's own
   * chapter-label/page-number), spanning the whole spread width. */
  private buildSpreadBandOverlays(
    oldEl: HTMLElement,
    newEl: HTMLElement,
    furniture: SpreadPageTurnFurnitureInfo,
  ): { outgoing: HTMLDivElement | undefined; incoming: HTMLDivElement | undefined } {
    const columnWidth = SpreadPaginatedHost.effectiveColumnWidth(this.ctx.width());
    const gutter = SpreadPaginatedHost.GUTTER_WIDTH;
    const bands = (chapterLabel: string, primary: number | undefined, secondary: number | undefined) => [
      {
        left: 0,
        width: columnWidth,
        header: { mode: "single" as const, text: furniture.title },
        footerText: primary !== undefined ? `Page ${primary}` : undefined,
      },
      {
        left: columnWidth + gutter,
        width: columnWidth,
        header: { mode: "single" as const, text: chapterLabel },
        footerText: secondary !== undefined ? `Page ${secondary}` : undefined,
      },
    ];
    const outgoing = this.animator.buildTurnFurnitureOverlay(
      oldEl,
      bands(furniture.outgoingChapterLabel, furniture.outgoingPrimaryPage, furniture.outgoingSecondaryPage),
    );
    const incoming = this.animator.buildTurnFurnitureOverlay(
      newEl,
      bands(furniture.incomingChapterLabel, furniture.incomingPrimaryPage, furniture.incomingSecondaryPage),
    );
    return { outgoing, incoming };
  }

  /** The "rotate" furniture overlay for a single column (right or
   * left), sized to that column's own current width. */
  private buildSpreadColumnOverlay(
    columnEl: HTMLElement,
    text: string,
    pageNumber: number | undefined,
  ): HTMLDivElement | undefined {
    return this.animator.buildTurnFurnitureOverlay(columnEl, [
      {
        left: 0,
        width: columnEl.getBoundingClientRect().width,
        header: { mode: "single" as const, text },
        footerText: pageNumber !== undefined ? `Page ${pageNumber}` : undefined,
      },
    ]);
  }

  /** The left-column overlay pair for a "rotate" spread turn stacks the
   * same way the turning side's own overlay does — matching whichever
   * host stays visually on top for the whole animation. */
  private stackSpreadLeftOverlays(
    containerEl: HTMLElement,
    outgoingLeft: HTMLDivElement | undefined,
    incomingLeft: HTMLDivElement | undefined,
    entering: boolean,
  ): void {
    const turnSide = entering ? incomingLeft : outgoingLeft;
    const otherSide = entering ? outgoingLeft : incomingLeft;
    if (otherSide) {
      otherSide.style.zIndex = "1";
      containerEl.appendChild(otherSide);
    }
    if (turnSide) {
      turnSide.style.zIndex = "2";
      containerEl.appendChild(turnSide);
    }
  }

  /** Shared cleanup for every in-chapter spread turn style.
   * `restoreColumnHeights` is skipped for "scroll" (and "none", which
   * never calls this with transient elements at all), which never grows
   * or clip-suppresses either column in the first place. */
  private finishSpreadTurn(
    oldHost: SpreadPaginatedHost,
    newHost: SpreadPaginatedHost,
    transientEls: readonly (HTMLElement | undefined)[],
    restoreColumnHeights: boolean,
  ): void {
    for (const el of transientEls) {
      el?.remove();
    }
    this.ctx.setAnimatingPageTurn(false);
    if (restoreColumnHeights) {
      newHost.restoreColumnNaturalHeight("left");
      newHost.restoreColumnNaturalHeight("right");
    }
    oldHost.dispose();
    const newEl = newHost.element;
    newEl.style.position = "";
    newEl.style.top = "";
    newEl.style.left = "";
    newEl.style.transform = "";
    newEl.style.zIndex = "";
  }

  /** Animates a fixed-layout spread turn using the current page-turn
   * style. Unlike the reflowable paths, this only moves whole staged
   * spread wrappers and does not need pagination-specific clip-path
   * workarounds, so there's no need to split it per style the way
   * `animatePageTurn`/`animateSpreadTurn` are — one `isScroll` branch
   * covers every case. Returns `false` when animation is skipped. */
  public async animateFixedSpreadTurn(
    previousWrapperEl: HTMLDivElement | undefined,
    stagingEl: HTMLDivElement,
    direction: 1 | -1,
  ): Promise<boolean> {
    if (!this.ctx.containerEl() || !previousWrapperEl || this.animator.shouldSkipPageTurnAnimation()) {
      return false;
    }
    const oldEl = previousWrapperEl;
    const newEl = stagingEl;
    const isScroll = this.ctx.pageTurnAnimationStyle() === "scroll";
    const entering = direction === -1;
    const animatingEl = entering ? newEl : oldEl;

    // Reveal the staging element so it can participate in the animation.
    stagingEl.style.opacity = "";
    stagingEl.style.pointerEvents = "";

    // Non-scroll turns stack the wrappers, so give the animating one an
    // opaque background to keep letterboxed margins from showing the
    // other spread through them.
    if (!isScroll) {
      animatingEl.style.background = FixedContentHost.LETTERBOX_BACKGROUND;
    }

    this.ctx.setAnimatingPageTurn(true);
    this.ctx.notify();

    if (isScroll) {
      await this.animator.playScrollTurn([oldEl], [newEl], direction);
    } else {
      await this.animator.playPageTurnAnimation(animatingEl, animatingEl, direction, [], entering);
    }

    animatingEl.style.background = "";
    this.ctx.setAnimatingPageTurn(false);
    // Reset animation-only styles on the surviving staging wrapper.
    stagingEl.style.transform = "";
    stagingEl.style.zIndex = "";
    stagingEl.style.boxShadow = "";
    stagingEl.style.transition = "";
    if (animatingEl === oldEl) {
      // Defensive: clear `oldEl`'s z-index too in case its lifecycle changes.
      oldEl.style.zIndex = "";
    }
    return true;
  }
}
