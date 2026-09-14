/**
 * Represents a parsed EPUB container: the ZIP archive plus its
 * `META-INF/container.xml` entry point and the resolved OPF package document
 * (metadata, manifest, spine).
 *
 * Implementation note: the ZIP central directory is parsed by hand (no
 * third-party zip library); compressed entries are inflated via the native
 * `DecompressionStream('deflate-raw')` API. See the `zip-container-parser`
 * and `opf-parser` work items for the implementation of this class.
 */
export class EpubContainer {
  // TODO(zip-container-parser, opf-parser): load from an ArrayBuffer/Blob,
  // parse the ZIP central directory, resolve META-INF/container.xml, and
  // parse the OPF package document (metadata, manifest, spine).
}
