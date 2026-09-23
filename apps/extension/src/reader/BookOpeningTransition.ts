/** Covers initial layout without hiding content from focus or assistive technology. */
export function prepareBookOpeningTransition(container: HTMLElement): {
  reveal: () => void;
  cancel: () => void;
} {
  const document = container.ownerDocument;
  const motion = document.defaultView!.matchMedia("(prefers-reduced-motion: reduce)");
  const cover = document.createElement("div");
  cover.setAttribute("aria-hidden", "true");
  cover.setAttribute("data-book-opening", "");
  Object.assign(cover.style, {
    position: "absolute",
    inset: "0",
    background: "inherit",
    pointerEvents: "none",
    zIndex: "10",
  });
  container.append(cover);

  let finished = false;
  let animation: Animation | undefined;
  const cancel = (): void => {
    if (finished) return;
    finished = true;
    animation?.removeEventListener("finish", cancel);
    animation?.cancel();
    cover.remove();
    motion.removeEventListener("change", onMotionChange);
    document.removeEventListener("visibilitychange", onVisibilityChange);
  };
  const onMotionChange = (): void => {
    if (motion.matches) cancel();
  };
  const onVisibilityChange = (): void => {
    if (document.hidden) cancel();
  };
  motion.addEventListener("change", onMotionChange);
  document.addEventListener("visibilitychange", onVisibilityChange);

  return {
    reveal() {
      if (finished || animation) return;
      if (motion.matches || document.hidden) {
        cancel();
        return;
      }
      animation = cover.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: 180,
        easing: "ease-out",
      });
      animation.addEventListener("finish", cancel, { once: true });
    },
    cancel,
  };
}
