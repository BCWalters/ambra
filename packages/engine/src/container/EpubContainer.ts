import { ZipArchive, ZipEntry } from "./ZipArchive.js";
import { PackageDocument } from "./PackageDocument.js";
import { getFirstDescendantElementByNS } from "./Xml.js";
import { EncryptionDocument } from "../encryption/EncryptionDocument.js";

const CONTAINER_XML_PATH = "META-INF/container.xml";
const ENCRYPTION_XML_PATH = "META-INF/encryption.xml";
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
 * `META-INF/container.xml` rootfile path, parsed OPF package document
 * (metadata, manifest, spine), and — if present — parsed
 * `META-INF/encryption.xml` (almost always used only to declare font
 * obfuscation in non-DRM books; see `FontDeobfuscator`).
 */
export class EpubContainer {
  private packageDocument: PackageDocument | undefined;
  private encryptionDocument: EncryptionDocument | null | undefined;

  private constructor(
    private readonly archive: ZipArchive,
    public readonly rootFilePath: string,
  ) {}

  /** Opens `data` as a ZIP archive and resolves the OCF rootfile path from
   * `META-INF/container.xml`. Does not parse the OPF package document
   * itself — call `getPackageDocument()` for that, lazily. */
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

    const rootFile = getFirstDescendantElementByNS(doc, CONTAINER_NAMESPACE, "rootfile");
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

  /** Parses (and caches) this container's OPF package document. */
  public async getPackageDocument(): Promise<PackageDocument> {
    if (!this.packageDocument) {
      const xml = await this.getRootFileEntry().readText();
      this.packageDocument = PackageDocument.parse(xml, this.rootFilePath);
    }
    return this.packageDocument;
  }

  /** Parses (and caches) this container's `META-INF/encryption.xml`, if
   * present — `undefined` for the (common) case of a container with no
   * encrypted/obfuscated resources at all. */
  public async getEncryptionDocument(): Promise<EncryptionDocument | undefined> {
    if (this.encryptionDocument === undefined) {
      const entry = this.archive.getEntry(ENCRYPTION_XML_PATH);
      this.encryptionDocument = entry ? EncryptionDocument.parse(await entry.readText()) : null;
    }
    return this.encryptionDocument ?? undefined;
  }

  /** Every entry in the underlying ZIP archive, in the order they appear
   * in the archive's central directory — the raw "file structure" of the
   * EPUB, for the EPUB-author-facing inspection feature (issue #46).
   * Includes directory entries (see `ZipEntry.isDirectory`); callers that
   * only want actual files should filter those out themselves. */
  public get entries(): readonly ZipEntry[] {
    return this.archive.entries;
  }

  public getEntry(path: string): ZipEntry | undefined {
    return this.archive.getEntry(path);
  }

  public requireEntry(path: string): ZipEntry {
    return this.archive.requireEntry(path);
  }
}
