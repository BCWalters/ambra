/**
 * Continuous-scroll presentation of reflowable content, sharing the same
 * linear DOM as `PaginationEngine` but rendering it in normal document
 * flow. See the `scroll-view-mode` work item.
 */
export class ScrollViewEngine {
  // TODO(scroll-view-mode): render linear-flow content, derive a Locator
  // from scroll offset, and restore scroll position from a Locator.
}

/**
 * Renders fixed-layout content: viewport sizing/scaling per OPF `rendition`
 * properties, single vs synthetic-spread page display. See the
 * `fixed-layout-rendering` work item.
 */
export class FixedLayoutRenderer {
  // TODO(fixed-layout-rendering): implement viewport/scale handling per OPF
  // rendition properties.
}
