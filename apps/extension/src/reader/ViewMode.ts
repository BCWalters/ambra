/** The two reflowable reading presentations — discrete page turns vs.
 * continuous scrolling. Defined in its own module (rather than alongside
 * `ReaderController`) so `LibraryDatabase`'s preference storage can
 * depend on it without the library module depending on the reader
 * module, which owns the actual reading behavior. */
export type ViewMode = "paginated" | "scroll";
