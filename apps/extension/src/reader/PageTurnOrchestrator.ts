import { FixedContentHost, PaginatedContentHost, SpreadPaginatedHost, ReadingTheme } from "@ambra/engine";
import type { MetadataTextContext } from "@ambra/engine";
import { PageTurnAnimator } from "./PageTurnAnimator.js";
import type { PageTurnAnimatorContext } from "./PageTurnAnimator.js";
import { CurledPageTurn } from "./CurledPageTurn.js";
import type { ControlledPageTurn } from "./ControlledPageTurn.js";

/** What `PageTurnOrchestrator` needs from `ReaderController` beyond what
 * `PageTurnAnimator` already asks for — plain getters/setters only, this
 * class owns no reader state of its own. `setAnimatingPageTurn` and
 * `notify` are called separately (not bundled into one setter) because
 * the caller's own start/end pairing isn't symmetric: turning *on*
 * always accompanies a `notify()` so the UI can show turn-in-progress
 * chrome, but turning back *off* deliberately doesn't — the host swap
 * that follows notifies once for both at the same time. */
export interface PageTurnOrchestratorContext extends PageTurnAnimatorContext {
  controlledTurn?(): ControlledPageTurn | undefined;
  width(): number;
  setAnimatingPageTurn(isAnimating: boolean): void;
  notify(): void;
}

/** Plain display data for one in-chapter page turn's temporary header/
 * footer overlays, computed by `ReaderController` from book/pagination
 * state — the orchestrator itself never reaches back into spine/TOC/
 * pagination concerns, it just paints what it's given. */
export interface PageTurnFurnitureInfo {
  titleContext?: MetadataTextContext | undefined;
  title: string;
  chapterLabel: string;
  incomingChapterLabel?: string | undefined;
  outgoingPage: number | undefined;
  incomingPage: number | undefined;
}

/** Same idea for a two-page spread turn — separate primary/secondary
 * page numbers per side, and separate outgoing/incoming chapter labels
 * because a merge turn's incoming side belongs to the next chapter. */
export interface SpreadPageTurnFurnitureInfo {
  titleContext?: MetadataTextContext | undefined;
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

  private createCurledLeaf(background: string): CurledPageTurn {
    return new CurledPageTurn(this.ctx.containerEl()!, background);
  }

  private async flatTurn(animate: () => Promise<void>): Promise<void> {
    const container = this.ctx.containerEl();
    const overflowX = container?.style.overflowX ?? "";
    const overflowY = container?.style.overflowY ?? "";
    if (container) container.style.overflow = "hidden";
    try {
      await animate();
    } finally {
      if (container) {
        container.style.overflowX = overflowX;
        container.style.overflowY = overflowY;
      }
    }
  }

  /** Animates an in-chapter single-page turn between two already-open
   * hosts. Host ownership and adoption remain with the caller. */
  public async animatePageTurn(
    oldHost: PaginatedContentHost,
    newHost: PaginatedContentHost,
    direction: 1 | -1,
    furniture: PageTurnFurnitureInfo,
  ): Promise<void> {
    this.ctx.controlledTurn?.()?.stopPreparationPreview();
    switch (this.ctx.pageTurnAnimationStyle()) {
      case "rotate":
        return this.rotatePageTurn(oldHost, newHost, direction, furniture);
      case "slide":
        return this.flatTurn(() => this.slidePageTurn(oldHost, newHost, direction, furniture));
      case "scroll":
        return this.flatTurn(() => this.scrollPageTurn(oldHost, newHost, direction, furniture));
      case "none":
        return this.finishPageTurn(oldHost, newHost, []);
    }
  }

  /** The single leaf leaves the viewport, revealing the next page underneath. */
  private async rotatePageTurn(
    oldHost: PaginatedContentHost,
    newHost: PaginatedContentHost,
    direction: 1 | -1,
    furniture: PageTurnFurnitureInfo,
    captureDestination?: () => () => void,
  ): Promise<void> {
    const containerEl = this.ctx.containerEl()!;
    if (this.animator.shouldSkipPageTurnAnimation()) {
      await this.ctx.controlledTurn?.()?.play(() => {}, this.ctx.operationSignal?.(), true);
      this.finishPageTurn(oldHost, newHost, []);
      return;
    }
    const { outgoing, incoming } = this.buildInChapterOverlays(oldHost.element, newHost.element, furniture);
    const leaf = this.createCurledLeaf(ReadingTheme.PAGE_THEMES[this.ctx.pageTheme()].background);
    const physical = this.ctx.rtl?.() ? -direction : direction;
    try {
      for (const overlay of [outgoing, incoming]) {
        if (overlay) {
          overlay.style.opacity = "0";
          containerEl.append(overlay);
        }
      }
      await leaf.prepare(
        { element: oldHost.element, furniture: outgoing },
        { element: newHost.element, furniture: incoming, capture: captureDestination },
        physical === 1 ? 1 : -1, this.ctx.operationSignal?.(),
        { element: newHost.element, furniture: incoming, capture: captureDestination }, "single",
      );
      leaf.hide(oldHost.element);
      this.ctx.setAnimatingPageTurn(true);
      this.ctx.notify();
      const gesture = this.ctx.controlledTurn?.();
      if (gesture) await gesture.play(progress => leaf.paint(progress), this.ctx.operationSignal?.());
      else await leaf.settle(0, 1, this.ctx.operationSignal?.());
    } finally {
      leaf.dispose();
      this.finishPageTurn(oldHost, newHost, [outgoing, incoming]);
    }
  }

  public async animateReusablePageTurn(
    host: PaginatedContentHost,
    direction: 1 | -1,
    furniture: PageTurnFurnitureInfo,
    captureDestination: () => () => void,
  ): Promise<void> {
    await this.rotatePageTurn(host, host, direction, furniture, captureDestination);
  }

  /** "slide": moves clipping inside both hosts as "rotate" does,
   * retaining an opaque backdrop behind the animating paper. */
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
    try {
      await this.animator.playPageTurnAnimation(
        turnEl,
        turnEl,
        direction,
        [...(animatedOverlay ? [animatedOverlay] : []), ...(turnBackdrop ? [turnBackdrop] : [])],
        entering,
      );
    } finally {
      this.finishPageTurn(oldHost, newHost, [outgoingOverlay, incomingOverlay, turnBackdrop]);
    }
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
    try {
      await this.animator.playScrollTurn(oldGroup, newGroup, direction);
    } finally {
      this.finishPageTurn(oldHost, newHost, [outgoingOverlay, incomingOverlay]);
    }
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
    const header = { mode: "split" as const, left: furniture.title, right: furniture.chapterLabel, leftContext: furniture.titleContext };
    const outgoing = this.animator.buildTurnFurnitureOverlay(oldEl, [
      {
        left: 0,
        width: oldEl.getBoundingClientRect().width,
        header,
        footerText:
          furniture.outgoingPage !== undefined ? `Page ${furniture.outgoingPage}` : undefined,
      },
    ]);
    const incoming = this.animator.buildTurnFurnitureOverlay(newEl, [
      {
        left: 0,
        width: newEl.getBoundingClientRect().width,
        header: furniture.incomingChapterLabel === undefined ? header :
          { ...header, right: furniture.incomingChapterLabel },
        footerText:
          furniture.incomingPage !== undefined ? `Page ${furniture.incomingPage}` : undefined,
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
    oldHost.restoreNaturalHeight();
    this.resetTurnStyles(oldHost.element);
    const newEl = newHost.element;
    newEl.style.position = "";
    newEl.style.top = "";
    newEl.style.left = "";
    newEl.style.transform = "";
    newEl.style.zIndex = "";
    this.resetTurnStyles(newEl);
  }

  private resetTurnStyles(element: HTMLElement): void {
    Object.assign(element.style, {
      position: "",
      zIndex: "",
      transform: "",
      transition: "",
      boxShadow: "",
      transformOrigin: "",
      backfaceVisibility: "",
      transformStyle: "",
    });
  }

  /** Animates an in-chapter two-page-spread turn between two
   * already-open hosts, without transferring ownership. */
  public async animateSpreadTurn(
    oldHost: SpreadPaginatedHost,
    newHost: SpreadPaginatedHost,
    direction: 1 | -1,
    furniture: SpreadPageTurnFurnitureInfo,
  ): Promise<void> {
    this.ctx.controlledTurn?.()?.stopPreparationPreview();
    switch (this.ctx.pageTurnAnimationStyle()) {
      case "rotate":
        return this.curledSpreadTurn(oldHost, newHost, direction, furniture);
      case "slide":
        return this.flatTurn(() => this.slideSpreadTurn(oldHost, newHost, direction, furniture));
      case "scroll":
        return this.flatTurn(() => this.scrollSpreadTurn(oldHost, newHost, direction, furniture));
      case "none":
        return this.finishSpreadTurn(oldHost, newHost, [], false);
    }
  }

  private async curledSpreadTurn(
    oldHost: SpreadPaginatedHost,
    newHost: SpreadPaginatedHost,
    direction: 1 | -1,
    furniture: SpreadPageTurnFurnitureInfo,
    captureDestination?: () => () => void,
  ): Promise<void> {
    if (this.animator.shouldSkipPageTurnAnimation()) {
      await this.ctx.controlledTurn?.()?.play(() => {}, this.ctx.operationSignal?.(), true);
      this.finishSpreadTurn(oldHost, newHost, [], false);
      return;
    }
    const physical = this.ctx.rtl?.() ? -direction : direction;
    const side = physical === 1 ? "right" : "left";
    const opposite = side === "right" ? "left" : "right";
    const front = oldHost.columnElement(side);
    const back = newHost.columnElement(opposite);
    const forward = direction === 1;
    const outgoing = this.buildSpreadColumnOverlay(front,
      forward ? furniture.outgoingChapterLabel : furniture.title,
      forward ? furniture.outgoingSecondaryPage : furniture.outgoingPrimaryPage, furniture.titleContext);
    const incoming = this.buildSpreadColumnOverlay(back,
      forward ? furniture.title : furniture.incomingChapterLabel,
      forward ? furniture.incomingPrimaryPage : furniture.incomingSecondaryPage, furniture.titleContext);
    const stationary = this.buildSpreadColumnOverlay(oldHost.columnElement(opposite),
      forward ? furniture.title : furniture.outgoingChapterLabel,
      forward ? furniture.outgoingPrimaryPage : furniture.outgoingSecondaryPage, furniture.titleContext);
    const destination = this.buildSpreadColumnOverlay(newHost.columnElement(side),
      forward ? furniture.incomingChapterLabel : furniture.title,
      forward ? furniture.incomingSecondaryPage : furniture.incomingPrimaryPage, furniture.titleContext);
    const leaf = this.createCurledLeaf(ReadingTheme.PAGE_THEMES[this.ctx.pageTheme()].background);
    const incomingGutter = oldHost === newHost ? undefined : newHost.gutterElement;
    const gutterOpacity = incomingGutter?.style.opacity ?? "";
    const incomingElement = oldHost === newHost ? undefined : newHost.element;
    const incomingOpacity = incomingElement?.style.opacity ?? "";
    const incomingClip = incomingElement?.style.clipPath ?? "";
    try {
      if (incomingElement) incomingElement.style.opacity = "0";
      if (incomingGutter) incomingGutter.style.opacity = "0";
      for (const overlay of [outgoing, incoming, stationary, destination]) {
        if (overlay) {
          overlay.style.zIndex = "-1";
          overlay.style.opacity = "0";
          this.ctx.containerEl()!.append(overlay);
        }
      }
      await leaf.prepare({ element: front, furniture: outgoing },
        { element: back, furniture: incoming, capture: captureDestination },
        physical === 1 ? 1 : -1, this.ctx.operationSignal?.(),
        captureDestination ? { element: front, furniture: destination, capture: captureDestination } : undefined);
      if (incomingElement) {
        const incomingBounds = incomingElement.getBoundingClientRect();
        const movingBounds = front.getBoundingClientRect();
        incomingElement.style.clipPath = `inset(0 ${Math.max(0, incomingBounds.right - movingBounds.right)}px 0 ${Math.max(0, movingBounds.left - incomingBounds.left)}px)`;
        incomingElement.style.opacity = incomingOpacity;
      }
      if (stationary) {
        stationary.style.zIndex = "3";
        stationary.style.opacity = "1";
      }
      if (destination && !captureDestination) {
        destination.style.zIndex = "1";
        destination.style.opacity = "1";
      }
      leaf.hide(front);
      this.ctx.setAnimatingPageTurn(true);
      this.ctx.notify();
      const gesture = this.ctx.controlledTurn?.();
      if (gesture) await gesture.play(p => leaf.paint(p), this.ctx.operationSignal?.());
      else await leaf.settle(0, 1, this.ctx.operationSignal?.());
    } finally {
      leaf.dispose();
      if (incomingGutter) incomingGutter.style.opacity = gutterOpacity;
      if (incomingElement) {
        incomingElement.style.opacity = incomingOpacity;
        incomingElement.style.clipPath = incomingClip;
      }
      this.finishSpreadTurn(oldHost, newHost, [outgoing, incoming, stationary, destination], false);
    }
  }

  public async animateReusableSpreadTurn(
    host: SpreadPaginatedHost,
    direction: 1 | -1,
    furniture: SpreadPageTurnFurnitureInfo,
    captureDestination: () => () => void,
  ): Promise<void> {
    await this.curledSpreadTurn(host, host, direction, furniture, captureDestination);
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
    try {
      await this.animator.playPageTurnAnimation(
        turnHost.element,
        turnEl,
        direction,
        [
          ...(animatedOverlayEl ? [animatedOverlayEl] : []),
          ...(turnBackdrop ? [turnBackdrop] : []),
        ],
        entering,
      );
    } finally {
      this.finishSpreadTurn(
        oldHost,
        newHost,
        [outgoingOverlay, incomingOverlay, turnBackdrop],
        true,
      );
    }
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
    try {
      await this.animator.playScrollTurn(oldGroup, newGroup, direction);
    } finally {
      this.finishSpreadTurn(oldHost, newHost, [outgoingOverlay, incomingOverlay], false);
    }
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
    const bands = (
      chapterLabel: string,
      primary: number | undefined,
      secondary: number | undefined,
    ) => [
      {
        left: this.ctx.rtl?.() ? columnWidth + gutter : 0,
        width: columnWidth,
        header: { mode: "single" as const, text: furniture.title, context: furniture.titleContext },
        footerText: primary !== undefined ? `Page ${primary}` : undefined,
      },
      {
        left: this.ctx.rtl?.() ? 0 : columnWidth + gutter,
        width: columnWidth,
        header: { mode: "single" as const, text: chapterLabel },
        footerText: secondary !== undefined ? `Page ${secondary}` : undefined,
      },
    ];
    const outgoing = this.animator.buildTurnFurnitureOverlay(
      oldEl,
      bands(
        furniture.outgoingChapterLabel,
        furniture.outgoingPrimaryPage,
        furniture.outgoingSecondaryPage,
      ),
    );
    const incoming = this.animator.buildTurnFurnitureOverlay(
      newEl,
      bands(
        furniture.incomingChapterLabel,
        furniture.incomingPrimaryPage,
        furniture.incomingSecondaryPage,
      ),
    );
    return { outgoing, incoming };
  }

  /** The "rotate" furniture overlay for a single column (right or
   * left), sized to that column's own current width. */
  private buildSpreadColumnOverlay(
    columnEl: HTMLElement,
    text: string,
    pageNumber: number | undefined,
    context?: MetadataTextContext | undefined,
  ): HTMLDivElement | undefined {
    return this.animator.buildTurnFurnitureOverlay(columnEl, [
      {
        left: 0,
        width: columnEl.getBoundingClientRect().width,
        header: { mode: "single" as const, text, context },
        footerText: pageNumber !== undefined ? `Page ${pageNumber}` : undefined,
      },
    ]);
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
      oldHost.restoreColumnNaturalHeight("left");
      oldHost.restoreColumnNaturalHeight("right");
    }
    for (const host of [oldHost, newHost]) {
      this.resetTurnStyles(host.element);
      for (const column of ["left", "right"] as const) {
        // Column positioning is structural; reset only animation styles.
        const el = host.columnElement(column);
        Object.assign(el.style, {
          transform: "",
          transition: "",
          boxShadow: "",
          transformOrigin: "",
          backfaceVisibility: "",
        });
      }
    }
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
    this.ctx.controlledTurn?.()?.stopPreparationPreview();
    if (this.animator.shouldSkipPageTurnAnimation()) {
      await this.ctx.controlledTurn?.()?.play(() => {}, this.ctx.operationSignal?.(), true);
      return false;
    }
    if (
      !this.ctx.containerEl() ||
      !previousWrapperEl
    ) {
      return false;
    }
    const oldEl = previousWrapperEl;
    const newEl = stagingEl;
    if (this.ctx.pageTurnAnimationStyle() === "rotate") {
      return this.curledFixedSpreadTurn(oldEl, newEl, direction);
    }
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

    try {
      await this.flatTurn(async () => {
      if (isScroll) {
        await this.animator.playScrollTurn([oldEl], [newEl], direction);
      } else {
        await this.animator.playPageTurnAnimation(
          animatingEl,
          animatingEl,
          direction,
          [],
          entering,
        );
      }
      });
    } finally {
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
      for (const el of [oldEl, newEl]) {
        Object.assign(el.style, {
          transform: "",
          transition: "",
          boxShadow: "",
          zIndex: "",
          transformOrigin: "",
          backfaceVisibility: "",
        });
      }
    }
    return true;
  }

  private async curledFixedSpreadTurn(oldEl: HTMLElement, newEl: HTMLElement, direction: 1 | -1): Promise<boolean> {
    const physical = this.ctx.rtl?.() ? -direction : direction;
    const oldFrames = Array.from(oldEl.querySelectorAll("iframe")).sort((a, b) =>
      a.getBoundingClientRect().left - b.getBoundingClientRect().left);
    const newFrames = Array.from(newEl.querySelectorAll("iframe")).sort((a, b) =>
      a.getBoundingClientRect().left - b.getBoundingClientRect().left);
    const front = oldFrames[physical === 1 ? oldFrames.length - 1 : 0];
    const back = newFrames[physical === 1 ? 0 : newFrames.length - 1];
    if (!front || !back) throw new Error("Fixed-layout page turn has no rendered page.");
    const leaf = this.createCurledLeaf(FixedContentHost.LETTERBOX_BACKGROUND);
    const originalZ = oldEl.style.zIndex;
    try {
      const single = oldFrames.length === 1 && newFrames.length === 1;
      await leaf.prepare({ element: front }, { element: back }, physical === 1 ? 1 : -1,
        this.ctx.operationSignal?.(), single ? { element: back } : undefined,
        single ? "single" : "spread");
      newEl.style.opacity = "";
      newEl.style.pointerEvents = "";
      oldEl.style.zIndex = "2";
      leaf.hide(front);
      this.ctx.setAnimatingPageTurn(true);
      this.ctx.notify();
      const gesture = this.ctx.controlledTurn?.();
      if (gesture) await gesture.play(p => leaf.paint(p), this.ctx.operationSignal?.());
      else await leaf.settle(0, 1, this.ctx.operationSignal?.());
      return true;
    } finally {
      leaf.dispose();
      oldEl.style.zIndex = originalZ;
      this.ctx.setAnimatingPageTurn(false);
    }
  }
}
