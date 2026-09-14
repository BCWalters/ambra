/**
 * Parses and exposes the EPUB3 Nav Document (toc/page-list/landmarks), with
 * NCX fallback for hybrid/legacy-authored content. See the `nav-parser` work
 * item for the implementation of this class.
 */
export class NavigationDocument {
  // TODO(nav-parser): parse nav.xhtml via DOMParser; fall back to NCX when a
  // Nav Document is absent or incomplete.
}
