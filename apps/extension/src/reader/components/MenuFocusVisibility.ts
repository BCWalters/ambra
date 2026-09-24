export function scrollMenuFocusIntoView(popover: HTMLElement, target: Element): void {
  const surface = popover.getBoundingClientRect();
  const item = target.getBoundingClientRect();
  const style = getComputedStyle(popover);
  const top = surface.top + parseFloat(style.borderTopWidth) + 1;
  const bottom = surface.bottom - parseFloat(style.borderBottomWidth) - 1;
  // Native/menu scrolling can round fractional heights into the popover's border.
  if (item.bottom > bottom) popover.scrollTop += Math.ceil(item.bottom - bottom);
  else if (item.top < top) popover.scrollTop -= Math.ceil(top - item.top);
}
