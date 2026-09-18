/** The page-turn animation styles a reader can choose between: a 3D
 * "rotate" flip (the outgoing page lifts and turns away from its hinge
 * edge, like a physical page), a flatter "slide" (the outgoing page
 * slides sideways off-screen to reveal the next/previous page sitting
 * underneath, which stays completely static), "scroll" (issue #63: the
 * outgoing *and* incoming pages both slide together, in the same
 * direction, at the same time — like scrolling through a continuous
 * horizontal filmstrip of pages rather than a single page being lifted
 * off a motionless stack), or "none" (an instant page swap, no
 * animation at all — issue #69, for readers who find the motion
 * distracting or simply prefer speed; distinct from
 * `prefers-reduced-motion`, which the reader already always respects
 * regardless of this setting, since a reader might want animations off
 * here without having set that OS-level preference at all). Defined in
 * its own module (rather than alongside `ReaderController`) so
 * `LibraryDatabase`'s preference storage can depend on it without the
 * library module depending on the reader module, which owns the actual
 * reading behavior — same reasoning as `ViewMode`. */
export type PageTurnAnimationStyle = "rotate" | "slide" | "scroll" | "none";

export const DEFAULT_PAGE_TURN_ANIMATION_STYLE: PageTurnAnimationStyle = "rotate";
