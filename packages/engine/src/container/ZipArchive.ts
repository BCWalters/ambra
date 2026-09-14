import { BinaryCursor } from "./BinaryCursor.js";
import { crc32 } from "./Crc32.js";

/** Thrown when a buffer is not a well-formed ZIP archive, or uses a feature
 * (e.g. ZIP64, an unsupported compression method) that isn't handled yet. */
export class ZipFormatError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ZipFormatError";
  }
}

/** Thrown when a decompressed entry's contents don't match its recorded
 * CRC-32 checksum, indicating a corrupted or truncated archive. */
export class ZipIntegrityError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ZipIntegrityError";
  }
}

const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_HEADER_SIGNATURE = 0x02014b50;
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;

const END_OF_CENTRAL_DIRECTORY_FIXED_SIZE = 22;
const MAX_COMMENT_LENGTH = 0xffff;

const ZIP64_SENTINEL = 0xffffffff;

const COMPRESSION_METHOD_STORED = 0;
const COMPRESSION_METHOD_DEFLATE = 8;

interface ZipEntryMetadata {
  readonly fileName: string;
  readonly compressionMethod: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly crc32: number;
  readonly localHeaderOffset: number;
}

/**
 * A single entry (file or directory) within a `ZipArchive`. Obtained via
 * `ZipArchive.getEntry`/`ZipArchive.entries` — never constructed directly.
 */
export class ZipEntry {
  public constructor(
    private readonly archive: ZipArchive,
    private readonly metadata: ZipEntryMetadata,
  ) {}

  public get fileName(): string {
    return this.metadata.fileName;
  }

  public get uncompressedSize(): number {
    return this.metadata.uncompressedSize;
  }

  /** True for directory entries (name ends in `/`, zero-length). EPUB
   * containers may include these; they carry no readable content. */
  public get isDirectory(): boolean {
    return this.metadata.fileName.endsWith("/");
  }

  /** Reads and decompresses this entry's full contents, verifying the
   * archive's recorded CRC-32 checksum against the result. */
  public async read(): Promise<Uint8Array> {
    return this.archive.readEntryBytes(this.metadata);
  }

  /** Convenience for text entries (XML/XHTML/OPF/etc.): reads and decodes
   * this entry's contents as UTF-8. */
  public async readText(): Promise<string> {
    const bytes = await this.read();
    return new TextDecoder("utf-8").decode(bytes);
  }
}

/**
 * A parsed ZIP archive — the container format EPUBs are packaged in. Parses
 * the central directory by hand (no third-party zip library) and inflates
 * DEFLATE-compressed entries via the native `DecompressionStream`.
 *
 * Only 32-bit ZIP is supported; ZIP64 archives (needed only past ~4GB, or
 * more than ~65,535 entries) are not — this is a deliberate, documented
 * limitation, since real-world individual EPUB files never approach that
 * size. See `ZipFormatError` for the failure mode.
 */
export class ZipArchive {
  private readonly entriesByName = new Map<string, ZipEntry>();

  private constructor(private readonly bytes: Uint8Array) {}

  /** Parses `data` as a ZIP archive, reading its central directory. Does
   * not decompress any entry contents yet — call `ZipEntry.read()` for that. */
  public static open(data: ArrayBuffer | Uint8Array): ZipArchive {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const archive = new ZipArchive(bytes);
    archive.parseCentralDirectory();
    return archive;
  }

  public get entries(): readonly ZipEntry[] {
    return [...this.entriesByName.values()];
  }

  public getEntry(fileName: string): ZipEntry | undefined {
    return this.entriesByName.get(fileName);
  }

  /** Like `getEntry`, but throws a `ZipFormatError` instead of returning
   * `undefined` when the entry is missing — for callers (like the OPF
   * resolver) where a missing required entry means a malformed EPUB. */
  public requireEntry(fileName: string): ZipEntry {
    const entry = this.getEntry(fileName);
    if (!entry) {
      throw new ZipFormatError(`Zip entry not found: ${fileName}`);
    }
    return entry;
  }

  private parseCentralDirectory(): void {
    const eocd = this.findEndOfCentralDirectory();
    const cursor = new BinaryCursor(this.dataViewAt(eocd.centralDirectoryOffset));

    for (let i = 0; i < eocd.entryCount; i++) {
      const signature = cursor.readUint32();
      if (signature !== CENTRAL_DIRECTORY_HEADER_SIGNATURE) {
        throw new ZipFormatError(
          `Malformed central directory: expected header signature at entry ${i}.`,
        );
      }

      cursor.skip(2 + 2); // version made by, version needed to extract
      cursor.skip(2); // general purpose bit flag
      const compressionMethod = cursor.readUint16();
      cursor.skip(2 + 2); // last mod file time, last mod file date
      const crc = cursor.readUint32();
      const compressedSize = cursor.readUint32();
      const uncompressedSize = cursor.readUint32();
      const fileNameLength = cursor.readUint16();
      const extraFieldLength = cursor.readUint16();
      const fileCommentLength = cursor.readUint16();
      cursor.skip(2); // disk number start
      cursor.skip(2); // internal file attributes
      cursor.skip(4); // external file attributes
      const localHeaderOffset = cursor.readUint32();

      const fileNameBytes = cursor.readBytes(fileNameLength);
      cursor.skip(extraFieldLength);
      cursor.skip(fileCommentLength);

      if (
        compressedSize === ZIP64_SENTINEL ||
        uncompressedSize === ZIP64_SENTINEL ||
        localHeaderOffset === ZIP64_SENTINEL
      ) {
        throw new ZipFormatError(
          "ZIP64 archives are not supported (entry size/offset exceeds 32-bit range).",
        );
      }

      const fileName = new TextDecoder("utf-8").decode(fileNameBytes);
      const metadata: ZipEntryMetadata = {
        fileName,
        compressionMethod,
        compressedSize,
        uncompressedSize,
        crc32: crc,
        localHeaderOffset,
      };
      this.entriesByName.set(fileName, new ZipEntry(this, metadata));
    }
  }

  /** Scans backward from the end of the buffer for the End of Central
   * Directory signature. The EOCD record is variable-length (it has a
   * trailing comment of up to 65,535 bytes), so its position can't be
   * computed directly and must be searched for. */
  private findEndOfCentralDirectory(): {
    entryCount: number;
    centralDirectoryOffset: number;
  } {
    const searchWindowStart = Math.max(
      0,
      this.bytes.length - END_OF_CENTRAL_DIRECTORY_FIXED_SIZE - MAX_COMMENT_LENGTH,
    );

    for (
      let offset = this.bytes.length - END_OF_CENTRAL_DIRECTORY_FIXED_SIZE;
      offset >= searchWindowStart;
      offset--
    ) {
      if (this.dataViewAt(offset).getUint32(0, true) === END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
        const cursor = new BinaryCursor(this.dataViewAt(offset));
        cursor.skip(4); // signature
        cursor.skip(2 + 2); // disk number, disk where central directory starts
        cursor.skip(2); // central directory records on this disk
        const entryCount = cursor.readUint16();
        cursor.skip(4); // size of central directory
        const centralDirectoryOffset = cursor.readUint32();
        return { entryCount, centralDirectoryOffset };
      }
    }

    throw new ZipFormatError("Not a valid ZIP archive: End of Central Directory record not found.");
  }

  /** Reads and decompresses a single entry's file data, given its central
   * directory metadata. Reads the local file header first: its variable
   * name/extra-field lengths can differ from the central directory's, so
   * they must be read from the local header to locate the actual data. */
  public async readEntryBytes(metadata: ZipEntryMetadata): Promise<Uint8Array> {
    const cursor = new BinaryCursor(this.dataViewAt(metadata.localHeaderOffset));
    const signature = cursor.readUint32();
    if (signature !== LOCAL_FILE_HEADER_SIGNATURE) {
      throw new ZipFormatError(
        `Malformed local file header for "${metadata.fileName}": bad signature.`,
      );
    }

    cursor.skip(2 + 2 + 2 + 2 + 2 + 4 + 4 + 4); // up through uncompressed size
    const fileNameLength = cursor.readUint16();
    const extraFieldLength = cursor.readUint16();
    cursor.skip(fileNameLength + extraFieldLength);

    const dataStart = metadata.localHeaderOffset + cursor.position;
    const compressed = this.bytes.subarray(dataStart, dataStart + metadata.compressedSize);

    const decompressed = await this.decompress(compressed, metadata.compressionMethod, metadata);

    const actualCrc = crc32(decompressed);
    if (actualCrc !== metadata.crc32) {
      throw new ZipIntegrityError(
        `CRC-32 mismatch for "${metadata.fileName}": archive is corrupted or truncated.`,
      );
    }

    return decompressed;
  }

  private async decompress(
    compressed: Uint8Array,
    compressionMethod: number,
    metadata: ZipEntryMetadata,
  ): Promise<Uint8Array> {
    if (compressionMethod === COMPRESSION_METHOD_STORED) {
      return compressed;
    }

    if (compressionMethod === COMPRESSION_METHOD_DEFLATE) {
      // Copy into a plain ArrayBuffer-backed Uint8Array: `compressed` is a
      // subarray view whose buffer type is widened to `ArrayBufferLike`
      // (which includes SharedArrayBuffer), but BlobPart requires a
      // definite `ArrayBuffer`.
      const owned = Uint8Array.from(compressed);
      const stream = new Blob([owned]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      const buffer = await new Response(stream).arrayBuffer();
      return new Uint8Array(buffer);
    }

    throw new ZipFormatError(
      `Unsupported compression method ${compressionMethod} for "${metadata.fileName}".`,
    );
  }

  private dataViewAt(offset: number): DataView {
    return new DataView(this.bytes.buffer, this.bytes.byteOffset + offset);
  }
}
