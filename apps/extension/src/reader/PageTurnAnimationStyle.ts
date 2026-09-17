/** The two page-turn animation styles a reader can choose between: a 3D
 * "rotate" flip (the outgoing page lifts and turns away from its hinge
 * edge, like a physical page) or a flatter "slide" (the outgoing page
 * slides sideways off-screen to reveal the next/previous page sitting
 * underneath). Defined in its own module (rather than alongside
 * `ReaderController`) so `LibraryDatabase`'s preference storage can
 * depend on it without the library module depending on the reader
 * module, which owns the actual reading behavior — same reasoning as
 * `ViewMode`. */
export type PageTurnAnimationStyle = "rotate" | "slide";

export const DEFAULT_PAGE_TURN_ANIMATION_STYLE: PageTurnAnimationStyle = "rotate";
