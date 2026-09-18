/**
 * Layout constants shared between `PageFurniture` (the static, declarative
 * per-page header/footer overlay) and `ReaderController`'s own imperative
 * "turn furniture" overlay (built by `buildTurnFurnitureOverlay` and
 * animated in lockstep with an actual page turn — see
 * `ReaderSnapshot.isAnimatingPageTurn`'s doc comment). Both need to agree
 * on exactly where the running header's text sits so the imperative
 * overlay used *during* a turn and the static one shown immediately
 * before/after it line up pixel-for-pixel, with no visible jump at the
 * handoff. Pulled into its own module (rather than either file importing
 * from the other) to avoid a value import between a `.tsx` component and
 * the plain-TS controller class, which only ever exchange *types*
 * otherwise.
 */

/** How far below the top of the reserved header band (`ReadingTheme.
 * PAGE_INSET_TOP`) the running header's own text sits — deliberately
 * near the *top* of that band (not vertically centered within it) so the
 * text sits well within the toolbar's own footprint when it's shown,
 * rather than peeking out just below it. Paired with the toolbar's own
 * height (see `Toolbar.tsx`) — the two are tuned together so the toolbar
 * always fully covers this text, never partially. */
export const HEADER_TEXT_TOP_OFFSET = 14;
