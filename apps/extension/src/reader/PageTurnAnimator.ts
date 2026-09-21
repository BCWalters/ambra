import { PaginatedContentHost, ReadingTheme, SpreadPaginatedHost } from "@ambra/engine";
import type { PageTheme } from "@ambra/engine";
import { HEADER_TEXT_TOP_OFFSET } from "./furnitureLayout.js";
import type { PageTurnAnimationStyle } from "./PageTurnAnimationStyle.js";

/** Everything `PageTurnAnimator` needs to read from `ReaderController` —
 * deliberately just plain getters, never a setter: this class only ever
 * builds/measures/transforms DOM elements the caller hands it (or
 * itself just built), it never owns or mutates any reader state of its
 * own. */
export interface PageTurnAnimatorContext {
  containerEl(): HTMLElement | undefined;
  height(): number;
  pageTheme(): PageTheme;
  pageTurnAnimationStyle(): PageTurnAnimationStyle;
}

/** The pure "mechanics" behind every animated page turn — building the
 * backdrop/growth-mask/furniture-overlay/rotate-back-face elements a
 * turn needs, staging and playing the actual CSS transition, and the
 * shared geometry helpers (which element a turn applies its transform
 * to, how a 0–1 drag fraction scales into that style's own natural
 * unit) both the click-triggered and drag-gesture turn paths rely on.
 * Extracted out of `ReaderController` (see `BookmarkManager`'s doc
 * comment for the overall decomposition rationale) as a first, bounded
 * slice of the much larger page-turn/animation engine: deliberately
 * *not* the turn *orchestration* itself (`turnPage`/`openSpineItem`/the
 * drag-gesture lifecycle, `animatePageTurn`/`animateSpreadTurn` and
 * their merged-spread/chapter-crossing variants) — those stay in
 * `ReaderController`, tightly threaded through spine navigation, host
 * swapping, and progress persistence in ways that don't have the same
 * clean, self-contained shape this group does. This class has no
 * reader-session state of its own at all — every method either takes
 * everything it needs as a parameter, or reads the handful of display
 * settings it needs (the reader pane's size/theme/animation-style
 * choice) via `PageTurnAnimatorContext`. */
export class PageTurnAnimator {
  constructor(private readonly ctx: PageTurnAnimatorContext) {}

  /** Whether the user has `prefers-reduced-motion: reduce` set — checked
   * up front by both `animatePageTurn`/`animateSpreadTurn` (to skip
   * building "turn furniture" overlays at all when there'll be no
   * animation to play them alongside) and by `playPageTurnAnimation`
   * itself (to skip the actual transition). See `shouldSkipPageTurnAnimation`
   * for the combined check that also honors the reader's own explicit
   * "off" page-turn-animation-style choice (issue #69). */
  private prefersReducedMotion(): boolean {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  }

  /** The actual gate every page-turn animation call site should check
   * before playing a transition — true whenever `prefersReducedMotion()`
   * is set *or* the reader has explicitly chosen the "none" page-turn
   * animation style (issue #69). Kept as its own method (rather than
   * folding the style check directly into `prefersReducedMotion`) since
   * the two are conceptually distinct: one reflects an OS-level
   * accessibility preference the reader never has to think about, the
   * other an explicit in-app choice — but every actual call site wants
   * both honored together, so callers should use this, not
   * `prefersReducedMotion` directly, unless they specifically mean the
   * OS preference alone. */
  public shouldSkipPageTurnAnimation(): boolean {
    return this.ctx.pageTurnAnimationStyle() === "none" || this.prefersReducedMotion();
  }
  /** Builds an opaque, page-themed backdrop rectangle for the *animating*
   * side of a "slide" turn — a real, reported bug (issue #84) otherwise:
   * "slide" deliberately leaves the animating host at its own natural
   * (often short) height rather than growing it (see the `slide` branch
   * right below in `animatePageTurn`/`animateSpreadTurn`, and
   * `suppressClipPathForAnimation`'s doc comment) — but with `clip-path`
   * also gone for the whole turn's duration, a short page's iframe
   * simply doesn't paint anything below its own (short) box. Without
   * this backdrop, whatever's directly behind it — the *other*, static
   * host, sitting fully rendered and unclipped at its own final resting
   * page — visibly shows through that gap for as long as the animating
   * page is short of the pane's full height, reading as "the wrong
   * page's content" instead of the current one.
   *
   * A plain sibling (like `buildTurnFurnitureOverlay`'s own overlay),
   * sized to `matchEl`'s width but the pane's *full* height (same
   * reasoning as that overlay's own height fix), filled with the active
   * `ReadingTheme` page background. Callers must insert this *before*
   * `matchEl` in DOM order, as a sibling — i.e. via
   * `matchEl.parentElement!.insertBefore(backdrop, matchEl)`, never
   * assuming that parent is `this.ctx.containerEl()` itself: `matchEl` may
   * instead be nested one level deeper inside `stageHiddenHostElement`'s
   * wrapper (any host still active from a normal, non-animated
   * `openSpineItem` mount, e.g. the very first page turn after opening a
   * book) — but that wrapper is always `inset: 0` within `containerEl`,
   * so positioning this backdrop from `containerEl`'s own rect (below)
   * still lines up correctly either way. This ordering makes it paint
   * *underneath* `matchEl`'s own content at the same z-index — covering
   * only the gap beyond `matchEl`'s own box, never the real content
   * itself — and callers must add it to `playPageTurnAnimation`'s
   * `extraTurnEls` so it slides away in lockstep with `matchEl`, exactly
   * like the furniture overlay already does. */
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

  /** Builds a plain, page-themed rectangle covering exactly the region
   * `growToFullHeight`/`growColumnToFullHeight` newly exposed on
   * `matchEl` — from its own natural height (`naturalHeight`, measured
   * *before* growing it) down to the pane's full height — for the
   * duration of a "rotate" turn. A real, reported bug otherwise
   * (matching "slide"'s own short-page bleed, issue #84, but via a
   * different mechanism): growing height needs `clip-path` dropped
   * too (see `growToFullHeight`'s own doc comment on why the two can't
   * be separated), and without it, a short page's iframe doesn't just
   * sit at a shorter box — enlarging it exposes however much more of
   * that *same* document's own subsequent flow happens to fit in the
   * newly available height (the next paragraph, or an unrelated image
   * immediately following it in the source document — confirmed
   * directly: a chapter's image-right-after-a-short-page layout showed
   * the image bleeding in below the short page's own text during a
   * rotate turn). Painted *on top* of `matchEl` (unlike
   * `buildTurnBackdrop`, which sits *behind* the animating side to mask
   * a gap the *other* host would otherwise show through) — the bleed
   * here is `matchEl`'s own content, not something behind it. Callers
   * must append this *after* `matchEl` in DOM order (so it paints over
   * it, not under it) and give it the same z-index, and add it to
   * `playPageTurnAnimation`'s `extraTurnEls` so it rotates in lockstep
   * — exactly like the furniture overlay and `buildTurnBackdrop`
   * already do. */
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
  /** Builds the running header/footer overlay for one side of an
   * animated page turn — either the outgoing page's current furniture or
   * the incoming page's furniture-to-be, depending on which host/element
   * the caller passes in. Returns `undefined` if `this.ctx.containerEl()` isn't
   * mounted (shouldn't happen mid-turn, just defensive).
   *
   * Positioned via `matchEl.getBoundingClientRect()` rather than by
   * reasoning about `matchEl`'s own layout/transform state — this is
   * deliberately a *separate* sibling element, not a child of `matchEl`
   * itself (an iframe, for a single page or a spread's "rotate" turn
   * element, can't hold light-DOM overlay children at all), so the only
   * way to line it up exactly is to measure where `matchEl` currently
   * sits on screen and place this overlay directly on top of it, in
   * `this.ctx.containerEl()`'s own coordinate space. Once placed, `stagePageTurn`/
   * `setPageTurnTransform` apply the *exact same* transform to this
   * overlay as to `matchEl` (see `playPageTurnAnimation`'s `extraTurnEls`),
   * so the two move as if they were one piece despite being independent
   * elements.
   *
   * The overlay's own *height*, though, deliberately uses `this.ctx.height()`
   * (the reader pane's full fixed height) rather than `matchEl`'s own
   * measured height — a real, reported bug otherwise: `matchEl` (an
   * iframe) is sized to *this specific page's* own content height (see
   * `PaginatedContentHost.showCurrentPage`), often noticeably shorter
   * than a full page — most commonly a chapter's last page. The footer
   * band below is positioned `bottom: 0` *within this overlay*, so
   * sizing the overlay to match a short `matchEl` pulled the footer's
   * "Page N" text up toward the visible text instead of leaving it at
   * the reader pane's actual bottom edge, snapping back down the moment
   * the turn settled and the static `PageFurniture` (which *does*
   * position against the full pane, never against any one host's own
   * height) took back over. Safe regardless of `matchEl`'s own height,
   * since every host is always top-aligned within the reader pane (see
   * `stageHiddenHostElement`'s `alignItems: "flex-start"`) — `matchEl`'s
   * top edge and the pane's own top edge always coincide.
   *
   * `bands` describes one visual "page" worth of header+footer content —
   * one entry for a single page or a spread's "rotate" turn (which only
   * ever animates one column), two for a spread's "slide" turn (the
   * whole two-page unit moves as one, so both columns' furniture rides
   * along together). Each band's `left`/`width` are relative to
   * `matchEl`'s own rect, not the whole container — for the single-band
   * cases that's just `{ left: 0, width: matchEl's full width }`; for
   * the two-band spread case it's each column's offset within the whole
   * spread, exactly mirroring `PageFurniture`'s own `columnBands` (just
   * computed against `matchEl`'s own measured width rather than the full
   * pane width, since there's no side margin to account for once we're
   * already positioned to coincide with the spread element itself).
   *
   * Both the header and footer bands below set `box-sizing: border-box`
   * explicitly — a real, reported bug otherwise (the "jump" at the end
   * of a turn, in both single-page and spread mode): with the default
   * `content-box` sizing, an explicit `width` plus non-zero horizontal
   * `padding` (the header band always has 20px each side) adds the
   * padding *outside* that width, so a "space-between"/"center" header
   * actually lays its text out across `band.width + 40px`, not
   * `band.width` — 20px further right than intended on each side. The
   * *static* `PageFurniture` never hits this, since it positions its
   * bands via `left`/`right` (not an explicit `width`) — box-sizing only
   * matters when `width` is one of the properties in play — so the
   * overlay's text visibly sat ~20-40px off from where `PageFurniture`
   * placed the same text the instant the turn settled and control
   * handed back to it. */
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

    // Matches `PageFurniture`'s own `Caption1` text exactly by
    // referencing Fluent's typography tokens as CSS custom properties
    // (`--fontFamilyBase`/`--fontSizeBase200`/`--fontWeightRegular`/
    // `--lineHeightBase200` — see `Caption1`'s own generated styles)
    // rather than hardcoding literal values here — a real, reported bug
    // otherwise (issue #85): a hardcoded font *stack* that happens to
    // share the same first choice ("Segoe UI") as Fluent's real
    // `--fontFamilyBase` can still resolve to a visibly different actual
    // typeface once that first choice isn't installed (as on macOS,
    // where this fell through to "Helvetica Neue" here but to Fluent's
    // own next fallback, `-apple-system`/San Francisco, in the real
    // static furniture) — different typefaces at the same nominal pixel
    // size don't share the same x-height/stroke weight, reading as "the
    // font size changed" even though the CSS `font-size` value never did.
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
      // This band's own opaque `background` (added above) is doing real
      // work, not just matching the page theme for looks: every call
      // site that builds this overlay has *also* called
      // `suppressClipPathForAnimation` on `matchEl` (a prerequisite for
      // dropping `clip-path`, itself required to work around the
      // Chromium overlapping-iframe compositing bug — see that
      // method's own doc comment), which leaves this exact top inset
      // band (`PAGE_INSET_TOP` tall) as part of `matchEl`'s box with
      // nothing clipping it anymore. That band is only blank *by
      // convention* — the previous page's last line sits just above it
      // in the underlying linear flow, routinely far less than
      // `PAGE_INSET_TOP` away — so without an opaque cover here, the
      // previous page's tail visibly bled in above this page's own
      // running header for the whole animation (a real, reported bug:
      // "content above ... the page that should be clipped"). The
      // symmetric bottom-band equivalent of this same risk is handled
      // separately, by `buildTurnGrowthMask`/shrinking `matchEl` itself
      // — but *this* band exists on every animated host regardless of
      // style or which side is moving, unlike that one, so it's fixed
      // once here rather than duplicated at every call site.
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
  /** Which element a page turn actually applies its `transform` to —
   * always the relevant host's own `.element`, *except* for a spread's
   * "rotate" style, which turns only the single column nearest the
   * spine (see `animateSpreadTurn`'s doc comment) rather than the whole
   * two-page unit. `host` is whichever side is actually animating —
   * the *outgoing* host for a forward (exiting) turn, or the *incoming*
   * host for a backward (entering) turn (see `playPageTurnAnimation`'s
   * doc comment) — always the *right* column: for a forward exit
   * that's the outgoing spread's right column turning away (hinged at
   * its own left/spine edge); for a backward entry that's the incoming
   * (previous) spread's right column — the page immediately before the
   * current view — swinging back down into place over the current
   * spread's left column, hinged the same way. Resolved via
   * `spreadColumnElement`. Falls back to the whole spread if that
   * somehow can't be resolved (never observed in practice, just
   * defensive) — degrading to the same "whole unit" motion "slide"
   * already uses is a reasonable fallback, not a broken one. */
  public elementToTurn(host: PaginatedContentHost | SpreadPaginatedHost): HTMLElement {
    if (!(host instanceof SpreadPaginatedHost) || this.ctx.pageTurnAnimationStyle() !== "rotate") {
      return host.element;
    }
    return this.spreadColumnElement(host, 1);
  }

  /** Resolves one column's actual iframe element out of a
   * `SpreadPaginatedHost` — used both by `elementToTurn` (which column
   * a "rotate" turn actually applies its transform to) and by
   * `animateSpreadTurn` (to find the *incoming* spread's matching
   * column, to position that side's furniture overlay against).
   * Delegates directly to `SpreadPaginatedHost.columnElement`, which
   * (unlike indexing into `contentDocuments()`) correctly resolves
   * "left" to whichever element is actually occupying that slot right
   * now even while merged (see that class's doc comment) — a plain
   * index into `contentDocuments()` doesn't hold up there, since that
   * array can have three entries (`mergedTailHost`, `left`, `right`)
   * while merged, not always exactly two. */
  public spreadColumnElement(host: SpreadPaginatedHost, columnIndex: 0 | 1): HTMLElement {
    return host.columnElement(columnIndex === 0 ? "left" : "right");
  }
  /** Builds the "back face" a spread's rotate turn (issue #81) needs to
   * complete the flip past 90° instead of stopping just short of it —
   * see `animateSpreadTurn`'s doc comment on `rotateBackFace` for why.
   * Currently a plain page-themed sheet (no mirrored text of its own —
   * genuinely rendering the *other* side of the same leaf would mean
   * loading and paginating that content a second time purely for this
   * ~380ms animation, a real cost not worth paying yet); still reads as
   * an actual, opaque page landing into place rather than the turning
   * column simply vanishing mid-air, which is what happened before.
   *
   * A plain sibling of `turnEl` (not a wrapper around it — `turnEl`
   * itself, an already-loaded iframe, must never be reparented; see
   * `stageHiddenHostElement`'s doc comment on why that silently reloads
   * an iframe's content in most browsers), sized and positioned to
   * exactly overlay it. Two nested layers: an *outer* div — added to
   * `playPageTurnAnimation`'s `extraTurnEls` by the caller, so it
   * receives the exact same `rotateY` angle/transition/transform-origin
   * as `turnEl` every frame, for free — containing an *inner* div with
   * its own fixed, never-animated `rotateY(180deg)`. Same-axis
   * rotations compose additively, so the inner's effective on-screen
   * angle is always exactly 180° ahead of the outer's (and therefore of
   * `turnEl`'s own): invisible (facing away, `backface-visibility:
   * hidden`) while the outer sits at 0° (matching `turnEl`'s own
   * resting, fully-visible state), and facing the viewer square-on
   * exactly when the outer reaches 180° (matching `turnEl`'s own
   * fully-turned-away, invisible state) — i.e. precisely the "shows up
   * once the front disappears past the midpoint, finishes facing the
   * viewer as the turn completes" behavior the front and back of a
   * single physical sheet actually have. */
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
  /** The shared "play the turn, wait for it to finish" mechanics behind
   * both `animatePageTurn` and `animateSpreadTurn`: elevates `hostEl`
   * (the whole outgoing unit — one page, or a whole spread) above the
   * incoming content already waiting underneath it (see
   * `stagePageTurn`), animates `turnEl`'s `transform` (usually the same
   * element as `hostEl`, except a spread's "rotate" style — see
   * `elementToTurn`), and resolves once that transition actually
   * finishes (or a safety-net timeout, or immediately at all if
   * `prefers-reduced-motion` is set). Leaves `this.ctx.containerEl()`'s
   * `perspective` reset back to empty afterward either way. Does *not*
   * dispose anything or swap in the new host — every caller does that
   * itself immediately after, since exactly what "the new host" means
   * differs between single-page and spread turns.
   *
   * `extraTurnEls` — the outgoing "turn furniture" overlay(s) built by
   * `buildTurnFurnitureOverlay`, if any — get every style mutation
   * `turnEl` itself gets (staging, transform, shadow, transition),
   * applied in the same tick, so the running header/footer visually
   * turns as one piece with the content beneath it rather than staying
   * still while only the page moves. Only `turnEl` is actually listened
   * to for `transitionend`/the safety-net timeout — one reliable signal
   * is enough to resolve the whole turn, and every element here always
   * shares the same 380ms duration regardless.
   *
   * `entering` (used for a *backward* turn — see `animatePageTurn`'s doc
   * comment on why backward flips which side actually animates) reverses
   * the whole sequence: instead of `turnEl` starting at rest and turning
   * away to reveal what's underneath, it starts already fully turned
   * away (the mirror image of what a forward turn's *end* position looks
   * like — since a backward turn is conceptually "un-doing" whichever
   * forward turn originally got here) and animates *down to* rest,
   * sliding/rotating into view on top of whatever's underneath. */
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

    // Rotating slightly past 90° (rather than stopping exactly at it)
    // reads as a page continuing its motion out of view rather than
    // freezing edge-on to the viewer — so "fully turned" overshoots to
    // 100 (translate %, or rotate degrees) rather than stopping at 90.
    // `fullTurnDegrees` (issue #81) overrides this to a full 180 for a
    // spread's "rotate" turn specifically, continuing the same motion
    // all the way down flat onto its own "back face" (see
    // `animateSpreadTurn`'s `rotateBackFace`) instead of stopping just
    // past vertical — every other style/case keeps the original 100.
    const fullyTurnedAmount = direction === 1 ? -(fullTurnDegrees ?? 100) : (fullTurnDegrees ?? 100);

    if (entering) {
      // Establish the "fully turned away" starting point *before* the
      // transition is even set up — mirrored sign, since this is the
      // reverse of whichever forward turn originally sent this same
      // page away. Forcing a reflow (see the loop below) ensures the
      // *next* style change (the transition + final transform) has a
      // real committed "before" state to animate away from, exactly the
      // same reasoning as for a freshly-inserted furniture overlay.
      this.setPageTurnTransform(turnEl, -fullyTurnedAmount, 1, extraTurnEls);
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
        // A freshly-created-and-inserted element (the "turn furniture"
        // overlays built by `buildTurnFurnitureOverlay` always are —
        // `turnEl` itself never is, it was already mounted well before
        // this turn started) hasn't had a style/layout pass committed
        // for its *current* (untransformed) state yet. Setting
        // `transition` and then changing `transform` in the very next
        // frame, with no committed "before" state in between, collapses
        // the whole transition into an instant jump to the final value
        // — confirmed via direct mid-animation DOM inspection, not just
        // guessed at. Reading `offsetHeight` forces the browser to
        // actually compute and commit layout for the element's current
        // style *now*, giving the upcoming transform change something
        // real to animate away from.
        void el.offsetHeight;
        el.style.transition = transition;
      }
      requestAnimationFrame(() => {
        this.setPageTurnTransform(turnEl, entering ? 0 : fullyTurnedAmount, entering ? 0 : 1, extraTurnEls);
      });
      // A safety net in case `transitionend` never fires (e.g. the
      // element was removed mid-transition by a rapid subsequent
      // action) — never leave the turn hung indefinitely.
      setTimeout(finish, 600);
    });
    const containerEl = this.ctx.containerEl();
    if (containerEl) {
      containerEl.style.perspective = "";
    }
  }
  /** The distinct "scroll"/filmstrip page-turn animation (issue #63):
   * unlike "rotate"/"slide" (`playPageTurnAnimation`, above) — where
   * only *one* side ever visibly moves, turning/sliding away to reveal a
   * completely static page waiting underneath — "scroll" moves *both*
   * the outgoing and incoming content simultaneously, by the same
   * amount, in the same direction, so it reads as one continuous
   * horizontal filmstrip the reader is scrolling through rather than a
   * page being lifted off a motionless stack. `oldGroup`/`newGroup` are
   * each the page (or spread) element plus its own "turn furniture"
   * overlay, if built — every element within a group always moves in
   * perfect lockstep, so a page's header/footer visibly travels with it
   * instead of staying behind.
   *
   * The two groups never overlap on screen at any point during the
   * transition (they stay a constant page-width apart throughout, like
   * two train cars), so unlike `playPageTurnAnimation` there's no
   * "elevate above what's underneath" staging step, no 3D perspective,
   * and no box-shadow (see `animatePageTurn`'s `growToFullHeight` call
   * being skipped for this style) — just a plain, flat `translateX` on
   * both sides at once. */
  public async playScrollTurn(
    oldGroup: readonly HTMLElement[],
    newGroup: readonly HTMLElement[],
    direction: 1 | -1,
  ): Promise<void> {
    if (this.shouldSkipPageTurnAnimation()) {
      return;
    }
    // Forward (direction 1): old exits left (-100%), new enters from the
    // right (starts at +100%). Backward (direction -1): mirrored. Both
    // groups always stay exactly 100% (one page-width) apart, so they
    // never visually overlap mid-transition.
    const exitAmount = direction * -100;
    const enterStart = direction * 100;

    for (const el of newGroup) {
      el.style.transform = `translateX(${enterStart}%)`;
    }
    // Forces a reflow so the upcoming transition has a real committed
    // "before" state to animate away from — same reasoning as
    // `playPageTurnAnimation`'s identical step for freshly-inserted
    // furniture overlays.
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
      // Same safety net as `playPageTurnAnimation` — never leave the
      // turn hung indefinitely if `transitionend` somehow never fires.
      setTimeout(finish, 600);
    });
  }
  /** Puts `hostEl` (the whole outgoing unit) into "ready to turn" state
   * — elevated above the incoming content already waiting underneath it
   * — without yet touching anyone's `transform`. Shared setup between
   * the click-triggered (`animatePageTurn`/`animateSpreadTurn`) and
   * drag-driven (`beginDragPageTurn`, single-page only — see
   * `setUpDragPageTurn`'s doc comment on why a spread has no drag
   * gesture) turn mechanics, for whichever style
   * `this.ctx.pageTurnAnimationStyle()` is currently set to.
   *
   * `turnEl` is the element that will actually receive the animated
   * `transform` — the same as `hostEl` for a single page, or for a
   * spread's "slide" style (the *whole* two-page unit slides together,
   * per explicit product direction: it should read as one sheet moving,
   * not each page independently); but for a spread's "rotate" style,
   * `turnEl` is just the one column nearest the spine (see
   * `elementToTurn`), while `hostEl` is still the whole spread — needed
   * so `hostEl`'s *companion* column (which never animates at all) stays
   * elevated above the incoming spread underneath it too, not just the
   * column that's actually turning.
   *
   * "rotate" needs perspective on the container (and `transform-style:
   * preserve-3d` on `hostEl`, so that perspective still reaches `turnEl`
   * when it's a grandchild — a spread's column iframes sit one level
   * inside the spread's own wrapper element), the correct hinge edge for
   * `direction`, and a hidden backface; "slide" needs none of that —
   * it's a flat 2D translate of something that's already sitting in the
   * exact same spot the incoming content occupies underneath it (see
   * `prepareIncomingPage`/`prepareIncomingSpread`), so simply sliding it
   * aside reveals what's next with no 3D setup at all.
   *
   * `extraTurnEls` (see `playPageTurnAnimation`'s own doc comment) get
   * the exact same rotate-specific staging as `turnEl` itself — they're
   * always a separate sibling element (the "turn furniture" overlay
   * built by `buildTurnFurnitureOverlay`), positioned to exactly
   * coincide with `turnEl`'s own on-screen rect, so treating them
   * identically keeps them moving as if they were part of it. */
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
    // For a forward (exiting) turn, `hostEl` is the outgoing host,
    // still sitting in normal flex flow (never explicitly positioned) —
    // `position: relative` elevates it via `z-index` without removing it
    // from flow. For a backward (entering) turn, `hostEl` is the
    // *incoming* host instead, which `prepareIncomingPage`/
    // `prepareIncomingSpread` already made `position: absolute; left:
    // 50%; transform: translateX(-50%)` specifically to overlap the
    // outgoing host exactly — downgrading that to `relative` here would
    // drop it back into normal flex flow as a *sibling* of the outgoing
    // host instead (a real bug, caught via direct DOM inspection: both
    // ended up rendering side by side, each squeezed to half width,
    // instead of stacked on top of each other). Only ever assign
    // `position` when it isn't already meaningfully set.
    if (hostEl.style.position !== "absolute") {
      hostEl.style.position = "relative";
    }
    hostEl.style.zIndex = "2";
    // "none" gets the same flat (non-3D) treatment as "slide" here —
    // there's no sensible "no animation" analogue of a 3D perspective
    // flip for the *live*, pointer-driven drag preview (something has
    // to visually track the pointer while actively dragging), so it
    // falls back to the least flourish-y option rather than showing a
    // 3D flip mid-drag only to then snap instantly on release.
    if (this.ctx.pageTurnAnimationStyle() !== "rotate") {
      return;
    }
    containerEl.style.perspective = "2200px";
    hostEl.style.transformStyle = "preserve-3d";
    // The physical hinge never moves for a given page — only which way
    // it's currently swinging does. A backward turn's `entering` element
    // is the *same page* a forward turn would have sent away in the
    // opposite direction, so its hinge is the mirror of what plain
    // `direction` alone would compute (see `playPageTurnAnimation`'s doc
    // comment on why backward flips the whole sequence).
    const hingeDirection = entering ? (direction === 1 ? -1 : 1) : direction;
    const transformOrigin = `${hingeDirection === 1 ? "left" : "right"} center`;
    for (const el of [turnEl, ...extraTurnEls]) {
      el.style.backfaceVisibility = "hidden";
      // The hinge is the spine edge the page turns away from: the left
      // edge turning forward (the right/free edge lifts up and toward
      // the viewer, like turning the right-hand page of a physical
      // book), the right edge turning back (the left/free edge lifts
      // toward the viewer instead). Confirmed empirically against an
      // isolated CSS 3D transform test — `rotateY`'s sign only reads as
      // "toward the viewer" when paired with the hinge on the *opposite*
      // side from the edge that's lifting. Still correct for a spread's
      // single-column "rotate" turn: the right column's own left edge,
      // and the left column's own right edge, both *are* the spine,
      // exactly where a real page's hinge sits.
      el.style.transformOrigin = transformOrigin;
    }
  }
  /** Scales a 0–1 drag fraction into `this.ctx.pageTurnAnimationStyle()`'s own
   * natural unit for `setPageTurnTransform` — degrees for "rotate" (a
   * quarter turn at `fraction=1`), percent for "slide"/"none" (a full
   * page-width translate at `fraction=1` — see `stagePageTurn`'s doc
   * comment on why "none" shares "slide"'s flatter treatment here) —
   * signed so the outgoing page always moves the same "out of view" way
   * for a given `direction` regardless of which style is active. */
  public pageTurnPartialAmount(direction: 1 | -1, fraction: number): number {
    const scale = this.ctx.pageTurnAnimationStyle() !== "rotate" ? 100 : 90;
    return direction * -scale * fraction;
  }
  /** The *entering* page's own transform amount during a "scroll"-style
   * drag (issue #63) — the mirror image of `pageTurnPartialAmount`'s
   * exiting-page amount: starts fully off-screen on the entering side
   * (`direction * 100`) and approaches `0` (fully at rest, arrived) as
   * `fraction` nears 1, so the incoming page arrives in perfect
   * lockstep with the outgoing page leaving. Every other style leaves
   * the entering page completely untouched during a drag — it's
   * revealed statically underneath the one actually moving, not itself
   * animated — so this is only ever called when `this.ctx.pageTurnAnimationStyle()
   * === "scroll"`. */
  public scrollDragEnterAmount(direction: 1 | -1, fraction: number): number {
    return direction * 100 * (1 - fraction);
  }
  /** Sets `el`'s in-progress transform directly (no transition) for
   * whichever style is active — `amount` is degrees (rotate) or percent
   * (slide); `fraction` (0 to 1) scales a deepening drop shadow (and,
   * for "rotate" specifically, a self-shading inset shadow — see the
   * "rotate" branch below) alongside it, so a partial drag reads as the
   * page physically lifting/sliding, not just moving in place. `el` is whatever
   * `stagePageTurn`'s own `turnEl` was — an iframe for a single page, or
   * (for a spread's "rotate" style) a single column's iframe rather than
   * the whole spread wrapper; the plain `HTMLElement` type here doesn't
   * care which. `extraEls` (see `playPageTurnAnimation`) get the exact
   * same transform/shadow applied in lockstep. */
  public setPageTurnTransform(el: HTMLElement, amount: number, fraction: number, extraEls: HTMLElement[] = []): void {
    for (const target of [el, ...extraEls]) {
      if (this.ctx.pageTurnAnimationStyle() !== "rotate") {
        target.style.transform = `translateX(${amount}%)`;
        // The shadow falls on the trailing edge — the side most recently
        // uncovered — which is the opposite side from the direction of
        // travel (negative `amount` = moving left = shadow on the right).
        const edge = amount < 0 ? "" : "-";
        target.style.boxShadow = `${edge}16px 0 32px rgba(0, 0, 0, ${(0.3 * fraction).toFixed(3)})`;
        continue;
      }
      target.style.transform = `rotateY(${amount}deg)`;
      // Two shadows: the outer one (unchanged) casts the page's lift
      // onto whatever's behind it; the *inset* one is new (issue #81,
      // "the page seems transparent as it turns... it needs to look
      // more solid") — a real page catches its own shadow as it turns
      // away from the light, growing visibly darker toward a full
      // profile-on turn, not just thinner. A flat 2D rotation with no
      // shading of its own reads as a thin, glassy pane rather than a
      // sheet of paper with actual weight. Scales with the same
      // `fraction` as the outer shadow so both deepen together.
      const selfShade = (0.3 * fraction).toFixed(3);
      target.style.boxShadow =
        `0 12px 40px rgba(0, 0, 0, ${(0.35 * fraction).toFixed(3)}), ` +
        `inset 0 0 ${Math.round(60 * fraction)}px rgba(0, 0, 0, ${selfShade})`;
    }
  }
}
