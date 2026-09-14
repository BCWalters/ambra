import { ZipArchive, ZipEntry } from "./ZipArchive.js";

const CONTAINER_XML_PATH = "META-INF/container.xml";
const CONTAINER_NAMESPACE = "urn:oasis:names:tc:opendocument:xmlns:container";

/** Thrown when an EPUB's OCF container (the ZIP archive's top-level
 * structure — `META-INF/container.xml` and its rootfile) is missing or
 * malformed, as opposed to `ZipFormatError` which covers ZIP-level
 * corruption. */
export class EpubContainerError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "EpubContainerError";
  }
}

/**
 * Represents a parsed EPUB container: the ZIP archive plus its resolved
 * `META-INF/container.xml` rootfile path (pointing at the OPF package
 * document). Parsing the OPF's metadata/manifest/spine is the `opf-parser`
 * work item's responsibility, layered on top of this class.
 */
export class EpubContainer {
  private constructor(
    private readonly archive: ZipArchive,
    public readonly rootFilePath: string,
  ) {}

  /** Opens `data` as a ZIP archive and resolves the OCF rootfile path from
   * `META-INF/container.xml`. Does not parse the OPF package document
   * itself — see the `opf-parser` work item. */
  public static async open(data: ArrayBuffer | Uint8Array): Promise<EpubContainer> {
    const archive = ZipArchive.open(data);
    const rootFilePath = await EpubContainer.resolveRootFilePath(archive);
    return new EpubContainer(archive, rootFilePath);
  }

  private static async resolveRootFilePath(archive: ZipArchive): Promise<string> {
    const containerEntry = archive.getEntry(CONTAINER_XML_PATH);
    if (!containerEntry) {
      throw new EpubContainerError(`Missing required OCF entry: ${CONTAINER_XML_PATH}`);
    }

    const xml = await containerEntry.readText();
    const doc = new DOMParser().parseFromString(xml, "application/xml");

    if (doc.getElementsByTagName("parsererror").length > 0) {
      throw new EpubContainerError(`Malformed XML in ${CONTAINER_XML_PATH}.`);
    }

    const rootFile = doc.getElementsByTagNameNS(CONTAINER_NAMESPACE, "rootfile")[0];
    const fullPath = rootFile?.getAttribute("full-path");
    if (!fullPath) {
      throw new EpubContainerError(
        `${CONTAINER_XML_PATH} does not declare a <rootfile full-path="...">.`,
      );
    }

    return fullPath;
  }

  /** The OPF package document entry, resolved from the container's
   * rootfile path. */
  public getRootFileEntry(): ZipEntry {
    return this.archive.requireEntry(this.rootFilePath);
  }

  public getEntry(path: string): ZipEntry | undefined {
    return this.archive.getEntry(path);
  }

  public requireEntry(path: string): ZipEntry {
    return this.archive.requireEntry(path);
  }
}
