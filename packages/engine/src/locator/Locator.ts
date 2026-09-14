/**
 * A `Locator` is an immutable value object wrapping an EPUB Canonical
 * Fragment Identifier (CFI) string that identifies a position or range
 * within a book.
 *
 * CFI/`Locator` is the central concept nearly every other subsystem depends
 * on: resume-reading, resize/font-size re-layout (the locator — not a page
 * number — is the source of truth), accessibility focus targets, deep
 * links, and (wave 2) annotations. See the `cfi-engine` and
 * `cfi-test-suite` work items.
 */
export class Locator {
  public constructor(public readonly cfi: string) {}

  public toString(): string {
    return this.cfi;
  }
}

/**
 * Generates and resolves `Locator`s against a book's DOM. Co-designed
 * alongside the pagination and scroll-view engines rather than built as a
 * downstream consumer of them. See the `cfi-engine` work item.
 */
export class LocatorResolver {
  // TODO(cfi-engine): generate a Locator for a given DOM position/range, and
  // resolve a Locator back to a DOM position/range, across both the
  // paginated and continuous-scroll view modes.
}
