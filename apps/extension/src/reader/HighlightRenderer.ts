import { HighlightTheme } from "@ambra/engine";
import type { HighlightStyle } from "@ambra/engine";

/** TypeScript's DOM lib declares `CSS`/`Highlight` as bare ambient
 * globals (so a normal same-realm script can just write `CSS.highlights`
 * directly), but doesn't model `Window.CSS`/`Window.Highlight` as actual
 * properties of the `Window` interface — a real gap, not a design choice
 * on our end. Since every highlight here must be created against the
 * *content iframe's own* window (`CSS.highlights` is scoped per-document
 * — using the parent's own global would render into the wrong document
 * entirely, or nothing at all), accessing it through `doc.defaultView`
 * needs this narrow cast rather than the ambient globals working as-is. */
interface HighlightCapableWindow extends Window {
  readonly CSS: { readonly highlights: Map<string, InstanceType<typeof Highlight>> };
  readonly Highlight: new (...ranges: Range[]) => InstanceType<typeof Highlight>;
}

/** Applies `groups` (`Range`s grouped by style) to `doc`'s own CSS Custom
 * Highlight registry — see `HighlightTheme`'s doc comment for why
 * highlights render this way (a pure CSSOM/rendering feature, no DOM
 * mutation) rather than by wrapping ranges in elements. Replaces
 * whatever this document's registry held before entirely (one call
 * covers every style at once), so a removed highlight never lingers
 * from a previous call. A no-op if `doc` has no attached window (e.g.
 * called against a detached/disposed document) or the browser lacks
 * Custom Highlight API support — silently degrading to "no highlights
 * visible" rather than throwing, since this is a presentational nicety,
 * not something that should ever be able to break reading. */
export function applyHighlightRanges(doc: Document, groups: ReadonlyMap<HighlightStyle, Range[]>): void {
  const win = doc.defaultView as HighlightCapableWindow | null;
  if (!win?.CSS?.highlights || !win.Highlight) {
    return;
  }
  for (const style of Object.keys(HighlightTheme.STYLES) as HighlightStyle[]) {
    const name = HighlightTheme.highlightName(style);
    const ranges = groups.get(style);
    if (ranges && ranges.length > 0) {
      win.CSS.highlights.set(name, new win.Highlight(...ranges));
    } else {
      win.CSS.highlights.delete(name);
    }
  }
}
