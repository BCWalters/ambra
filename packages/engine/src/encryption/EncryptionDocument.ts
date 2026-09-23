import { getDescendantElementsByNS, getFirstChildElementByNS } from "../container/Xml.js";
import { resolveEpubPath } from "../container/EpubPath.js";

const CONTAINER_NAMESPACE = "urn:oasis:names:tc:opendocument:xmlns:container";
const XMLENC_NAMESPACE = "http://www.w3.org/2001/04/xmlenc#";

/** Thrown when `META-INF/encryption.xml` is present but malformed. */
export class EncryptionDocumentError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "EncryptionDocumentError";
  }
}

/** One `<EncryptedData>` entry: an archive-relative resource path, and the
 * URI identifying which algorithm was used to encrypt/obfuscate it. */
export interface EncryptedResourceEntry {
  readonly path: string;
  readonly algorithmUri: string;
}

/**
 * Parses `META-INF/encryption.xml` — the OCF-standard manifest of which
 * resources in the container are encrypted or obfuscated, and by which
 * algorithm. In practice, for non-DRM EPUBs, this almost always exists
 * solely to declare *font obfuscation* (see `FontDeobfuscator`); this
 * class only parses the manifest itself and leaves interpreting/reversing
 * any given algorithm to its caller.
 */
export class EncryptionDocument {
  private readonly entriesByPath: ReadonlyMap<string, EncryptedResourceEntry>;

  private constructor(entries: readonly EncryptedResourceEntry[]) {
    this.entriesByPath = new Map(entries.map((entry) => [entry.path, entry]));
  }

  public get entries(): readonly EncryptedResourceEntry[] {
    return [...this.entriesByPath.values()];
  }

  public getEntry(path: string): EncryptedResourceEntry | undefined {
    return this.entriesByPath.get(path);
  }

  /** Parses `xml` (the raw text of `META-INF/encryption.xml`). Resource
   * URIs are resolved relative to the archive root, per the OCF spec
   * (unlike manifest hrefs, which are relative to the OPF's directory). */
  public static parse(xml: string): EncryptionDocument {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    if (doc.getElementsByTagName("parsererror").length > 0) {
      throw new EncryptionDocumentError("Malformed XML in META-INF/encryption.xml.");
    }

    const encryptionRoot = doc.documentElement;
    if (
      encryptionRoot.namespaceURI !== CONTAINER_NAMESPACE ||
      encryptionRoot.localName !== "encryption"
    ) {
      throw new EncryptionDocumentError(
        "META-INF/encryption.xml does not have an <encryption> root element in the OCF container namespace.",
      );
    }

    const encryptedDataElements = getDescendantElementsByNS(
      encryptionRoot,
      XMLENC_NAMESPACE,
      "EncryptedData",
    );

    const entries = encryptedDataElements.map((encryptedDataEl) =>
      EncryptionDocument.parseEncryptedData(encryptedDataEl),
    );

    return new EncryptionDocument(entries);
  }

  private static parseEncryptedData(encryptedDataEl: Element): EncryptedResourceEntry {
    const methodEl = getFirstChildElementByNS(
      encryptedDataEl,
      XMLENC_NAMESPACE,
      "EncryptionMethod",
    );
    const algorithmUri = methodEl?.getAttribute("Algorithm");
    if (!algorithmUri) {
      throw new EncryptionDocumentError(
        '<EncryptedData> is missing a required <EncryptionMethod Algorithm="...">.',
      );
    }

    const cipherDataEl = getFirstChildElementByNS(encryptedDataEl, XMLENC_NAMESPACE, "CipherData");
    const cipherReferenceEl = cipherDataEl
      ? getFirstChildElementByNS(cipherDataEl, XMLENC_NAMESPACE, "CipherReference")
      : undefined;
    const uri = cipherReferenceEl?.getAttribute("URI");
    if (!uri) {
      throw new EncryptionDocumentError(
        '<EncryptedData> is missing a required <CipherData><CipherReference URI="...">.',
      );
    }

    return { path: resolveEpubPath("", uri), algorithmUri };
  }
}
