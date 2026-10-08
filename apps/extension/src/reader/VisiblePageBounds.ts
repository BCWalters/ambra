/** Iframe-local paint bounds; pagination keeps the layout viewport larger than its visible page. */
export function visiblePageBounds(frame: Pick<HTMLIFrameElement, "style">, height: number): { top: number; bottom: number } {
  const clip = frame.style.clipPath;
  const inset = /^inset\(([^)]+)\)$/.exec(clip);
  if (!inset) return { top: 0, bottom: height };
  const values = inset[1]!.trim().split(/\s+/);
  if (values.length > 4 || values.some(value => !/^(?:-?(?:\d+(?:\.\d+)?|\.\d+)px|0)$/.test(value))) {
    return { top: 0, bottom: height };
  }
  const offsets = values.map(value => parseFloat(value));
  return { top: offsets[0]!, bottom: height - (offsets[2] ?? offsets[0]!) };
}
