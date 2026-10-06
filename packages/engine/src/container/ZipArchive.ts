import { BinaryCursor } from "./BinaryCursor.js";
import { crc32 } from "./Crc32.js";

/** Thrown when a buffer is not a well-formed ZIP archive, or uses a feature
 * (e.g. native encryption or an unsupported compression method) that isn't handled. */
export class ZipFormatError extends Error {
  public constructor(
    message: string,
    public readonly reason: "invalid" | "unsupported" = "invalid",
  ) {
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
const ZIP64_END_SIGNATURE = 0x06064b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_EXTRA_FIELD_ID = 0x0001;
const DATA_DESCRIPTOR_SIGNATURE = 0x08074b50;
const ARCHIVE_EXTRA_DATA_SIGNATURE = 0x08064b50;

const END_OF_CENTRAL_DIRECTORY_FIXED_SIZE = 22;
const CENTRAL_DIRECTORY_HEADER_FIXED_SIZE = 46;
const LOCAL_FILE_HEADER_FIXED_SIZE = 30;
const MAX_COMMENT_LENGTH = 0xffff;

const ZIP64_SENTINEL = 0xffffffff;
const ZIP64_COUNT_SENTINEL = 0xffff;

const COMPRESSION_METHOD_STORED = 0;
const COMPRESSION_METHOD_DEFLATE = 8;

export interface ZipArchiveLimits {
  readonly maxEntryCount: number;
  readonly maxEntryUncompressedBytes: number;
  readonly maxTotalUncompressedBytes: number;
}

export const DEFAULT_ZIP_ARCHIVE_LIMITS: ZipArchiveLimits = Object.freeze({
  maxEntryCount: 1_000_000,
  maxEntryUncompressedBytes: 256 * 1024 * 1024,
  maxTotalUncompressedBytes: 8 * 1024 * 1024 * 1024,
});

interface CentralDirectoryMetadata {
  readonly entryCount: number;
  readonly centralDirectoryOffset: number;
  readonly centralDirectorySize: number;
}

interface ZipEntrySizes {
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
  readonly diskNumber: number;
}

interface ZipEntryMetadata {
  readonly fileName: string;
  readonly extraFieldLength: number;
  readonly versionNeeded: number;
  readonly flags: number;
  readonly compressionMethod: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly crc32: number;
  readonly localHeaderOffset: number;
  readonly usesZip64Sizes: boolean;
}

interface LocalHeader {
  readonly versionNeeded: number;
  readonly flags: number;
  readonly crc32: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly extraFieldLength: number;
  readonly dataStart: number;
  readonly usesZip64Sizes: boolean;
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

  public get localHeaderOffset(): number {
    return this.metadata.localHeaderOffset;
  }

  public get compressionMethod(): number {
    return this.metadata.compressionMethod;
  }

  public get localExtraFieldLength(): number {
    return this.archive.localExtraFieldLength(this.metadata);
  }

  public get centralExtraFieldLength(): number {
    return this.metadata.extraFieldLength;
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
 * ZIP32 and ZIP64 v1 records are supported within safe integer, supplied
 * buffer, and configurable resource limits. Native ZIP encryption and
 * multi-disk archives are rejected.
 */
export class ZipArchive {
  private readonly entriesByName = new Map<string, ZipEntry>();
  private readonly metadata: ZipEntryMetadata[] = [];
  private centralDirectoryOffset = 0;

  private constructor(
    private readonly bytes: Uint8Array,
    private readonly limits: ZipArchiveLimits,
  ) {}

  /** Parses `data` as a ZIP archive, reading its central directory. Does
   * not decompress any entry contents yet — call `ZipEntry.read()` for that. */
  public static open(
    data: ArrayBuffer | Uint8Array,
    overrides: Partial<ZipArchiveLimits> = {},
  ): ZipArchive {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const limits = { ...DEFAULT_ZIP_ARCHIVE_LIMITS, ...overrides };
    for (const [name, value] of [
      ["maxEntryCount", limits.maxEntryCount],
      ["maxEntryUncompressedBytes", limits.maxEntryUncompressedBytes],
      ["maxTotalUncompressedBytes", limits.maxTotalUncompressedBytes],
    ] as const) {
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new RangeError(`ZIP limit ${name} must be a nonnegative safe integer.`);
      }
    }
    const archive = new ZipArchive(bytes, limits);
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
    this.centralDirectoryOffset = eocd.centralDirectoryOffset;
    if (eocd.entryCount > this.limits.maxEntryCount) {
      throw new ZipFormatError("ZIP entry count exceeds the configured limit.", "unsupported");
    }
    const cursor = new BinaryCursor(
      this.dataViewAt(eocd.centralDirectoryOffset, eocd.centralDirectorySize),
    );
    let totalUncompressedSize = 0;

    for (let i = 0; i < eocd.entryCount; i++) {
      if (cursor.position + CENTRAL_DIRECTORY_HEADER_FIXED_SIZE > eocd.centralDirectorySize) {
        throw new ZipFormatError(`Truncated central directory header at entry ${i}.`);
      }
      const signature = cursor.readUint32();
      if (signature !== CENTRAL_DIRECTORY_HEADER_SIGNATURE) {
        throw new ZipFormatError(
          `Malformed central directory: expected header signature at entry ${i}.`,
        );
      }

      cursor.skip(2); // version made by
      const versionNeeded = cursor.readUint16();
      const flags = cursor.readUint16();
      const compressionMethod = cursor.readUint16();
      cursor.skip(2 + 2); // last mod file time, last mod file date
      const crc = cursor.readUint32();
      const compressedSize = cursor.readUint32();
      const uncompressedSize = cursor.readUint32();
      const fileNameLength = cursor.readUint16();
      const extraFieldLength = cursor.readUint16();
      const fileCommentLength = cursor.readUint16();
      const diskNumber = cursor.readUint16();
      cursor.skip(2); // internal file attributes
      cursor.skip(4); // external file attributes
      const localHeaderOffset = cursor.readUint32();

      if (
        cursor.position + fileNameLength + extraFieldLength + fileCommentLength >
        eocd.centralDirectorySize
      ) {
        throw new ZipFormatError(`Truncated central directory fields at entry ${i}.`);
      }
      const fileNameBytes = cursor.readBytes(fileNameLength);
      const extraFields = cursor.readBytes(extraFieldLength);
      cursor.skip(fileCommentLength);

      const sizes = this.resolveZip64Extra(extraFields, {
        compressedSize,
        uncompressedSize,
        localHeaderOffset,
        diskNumber,
      });
      const fileName = this.decodeFileName(fileNameBytes);
      this.validateFeatures(versionNeeded, flags, compressionMethod, fileName);
      if (sizes.diskNumber !== 0) {
        throw new ZipFormatError("Multi-disk ZIP entries are not supported.", "unsupported");
      }
      if (sizes.uncompressedSize > this.limits.maxEntryUncompressedBytes) {
        throw new ZipFormatError(
          `ZIP entry "${fileName}" exceeds the configured uncompressed size limit.`,
          "unsupported",
        );
      }
      if (sizes.uncompressedSize > this.limits.maxTotalUncompressedBytes - totalUncompressedSize) {
        throw new ZipFormatError(
          "ZIP total uncompressed size exceeds the configured limit.",
          "unsupported",
        );
      }
      totalUncompressedSize += sizes.uncompressedSize;
      if (this.entriesByName.has(fileName)) {
        throw new ZipFormatError(`Duplicate ZIP entry name: "${fileName}".`);
      }
      const metadata: ZipEntryMetadata = {
        fileName,
        extraFieldLength,
        versionNeeded,
        flags,
        compressionMethod,
        compressedSize: sizes.compressedSize,
        uncompressedSize: sizes.uncompressedSize,
        crc32: crc,
        localHeaderOffset: sizes.localHeaderOffset,
        usesZip64Sizes: compressedSize === ZIP64_SENTINEL || uncompressedSize === ZIP64_SENTINEL,
      };
      this.metadata.push(metadata);
      this.entriesByName.set(fileName, new ZipEntry(this, metadata));
    }
  }

  /** Scans backward from the end of the buffer for the End of Central
   * Directory signature. The EOCD record is variable-length (it has a
   * trailing comment of up to 65,535 bytes), so its position can't be
   * computed directly and must be searched for. */
  private findEndOfCentralDirectory(): CentralDirectoryMetadata {
    const searchWindowStart = Math.max(
      0,
      this.bytes.length - END_OF_CENTRAL_DIRECTORY_FIXED_SIZE - MAX_COMMENT_LENGTH,
    );

    let invalidRecordReason: string | undefined;
    let invalidRecordKind: "invalid" | "unsupported" = "invalid";
    for (
      let offset = this.bytes.length - END_OF_CENTRAL_DIRECTORY_FIXED_SIZE;
      offset >= searchWindowStart;
      offset--
    ) {
      if (this.dataViewAt(offset).getUint32(0, true) === END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
        const cursor = new BinaryCursor(this.dataViewAt(offset));
        cursor.skip(4); // signature
        cursor.skip(2 + 2 + 2 + 2 + 4 + 4);
        const commentLength = cursor.readUint16();
        if (offset + END_OF_CENTRAL_DIRECTORY_FIXED_SIZE + commentLength !== this.bytes.length) {
          continue;
        }
        try {
          return this.readEndRecord(offset);
        } catch (error) {
          if (!(error instanceof ZipFormatError)) {
            throw error;
          }
          invalidRecordReason = error.message;
          invalidRecordKind = error.reason;
        }
      }
    }

    throw new ZipFormatError(
      invalidRecordReason ?? "Not a valid ZIP archive: End of Central Directory record not found.",
      invalidRecordKind,
    );
  }

  private readEndRecord(offset: number): CentralDirectoryMetadata {
    const view = this.dataViewAt(offset, END_OF_CENTRAL_DIRECTORY_FIXED_SIZE);
    const diskNumber = view.getUint16(4, true);
    const directoryDisk = view.getUint16(6, true);
    const entriesOnDisk = view.getUint16(8, true);
    const entryCount = view.getUint16(10, true);
    const centralDirectorySize = view.getUint32(12, true);
    const centralDirectoryOffset = view.getUint32(16, true);
    const needsZip64 =
      centralDirectorySize === ZIP64_SENTINEL || centralDirectoryOffset === ZIP64_SENTINEL;
    const locatorOffset = offset - 20;
    const hasLocator =
      locatorOffset >= 0 &&
      this.dataViewAt(locatorOffset, 20).getUint32(0, true) === ZIP64_LOCATOR_SIGNATURE &&
      centralDirectoryOffset + centralDirectorySize !== offset;
    if (needsZip64 && !hasLocator) {
      throw new ZipFormatError("Missing ZIP64 End of Central Directory locator.");
    }
    if (hasLocator) {
      const locator = this.dataViewAt(locatorOffset, 20);
      if (locator.getUint32(4, true) !== 0 || locator.getUint32(16, true) !== 1) {
        throw new ZipFormatError("Multi-disk ZIP64 archives are not supported.", "unsupported");
      }
      const recordOffset = this.safeUint64(locator, 8);
      const prefix = this.dataViewAt(recordOffset, 12);
      if (prefix.getUint32(0, true) !== ZIP64_END_SIGNATURE) {
        throw new ZipFormatError("Malformed ZIP64 End of Central Directory signature.");
      }
      const recordSize = this.safeUint64(prefix, 4);
      if (
        recordSize < 44 ||
        recordOffset > locatorOffset - 12 ||
        recordSize !== locatorOffset - recordOffset - 12
      ) {
        throw new ZipFormatError("Malformed ZIP64 End of Central Directory bounds.");
      }
      const record = this.dataViewAt(recordOffset, 12 + recordSize);
      if (record.getUint16(14, true) !== 45) {
        throw new ZipFormatError(
          "Unsupported ZIP64 version-needed-to-extract (only v1 is supported).",
          "unsupported",
        );
      }
      if (
        record.getUint32(16, true) !== 0 ||
        record.getUint32(20, true) !== 0 ||
        this.safeUint64(record, 24) !== this.safeUint64(record, 32)
      ) {
        throw new ZipFormatError("Multi-disk ZIP64 archives are not supported.", "unsupported");
      }
      const result = {
        entryCount: this.safeUint64(record, 32),
        centralDirectorySize: this.safeUint64(record, 40),
        centralDirectoryOffset: this.safeUint64(record, 48),
      };
      for (const [legacy, sentinel, actual] of [
        [diskNumber, ZIP64_COUNT_SENTINEL, 0],
        [directoryDisk, ZIP64_COUNT_SENTINEL, 0],
        [entriesOnDisk, ZIP64_COUNT_SENTINEL, result.entryCount],
        [entryCount, ZIP64_COUNT_SENTINEL, result.entryCount],
        [centralDirectorySize, ZIP64_SENTINEL, result.centralDirectorySize],
        [centralDirectoryOffset, ZIP64_SENTINEL, result.centralDirectoryOffset],
      ]) {
        if (legacy !== sentinel && legacy !== actual) {
          throw new ZipFormatError("ZIP64 and legacy End of Central Directory fields disagree.");
        }
      }
      this.validateDirectoryBounds(result, recordOffset);
      return result;
    }
    if (diskNumber !== 0 || directoryDisk !== 0 || entriesOnDisk !== entryCount) {
      throw new ZipFormatError("Multi-disk ZIP archives are not supported.", "unsupported");
    }
    const result = { entryCount, centralDirectoryOffset, centralDirectorySize };
    this.validateDirectoryBounds(result, offset);
    return result;
  }

  private validateDirectoryBounds(directory: CentralDirectoryMetadata, endOffset: number): void {
    this.requireByteRange(directory.centralDirectoryOffset, directory.centralDirectorySize);
    if (
      directory.centralDirectorySize !== endOffset - directory.centralDirectoryOffset ||
      directory.entryCount >
        Math.floor(directory.centralDirectorySize / CENTRAL_DIRECTORY_HEADER_FIXED_SIZE)
    ) {
      throw new ZipFormatError("Malformed ZIP central directory bounds.");
    }
  }

  private safeUint64(view: DataView, offset: number): number {
    if (offset < 0 || offset > view.byteLength - 8) {
      throw new ZipFormatError("Truncated ZIP64 integer field.");
    }
    const value = view.getBigUint64(offset, true);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new ZipFormatError(
        "ZIP64 value exceeds the supported safe integer range.",
        "unsupported",
      );
    }
    return Number(value);
  }

  private resolveZip64Extra(extra: Uint8Array, fields: ZipEntrySizes): ZipEntrySizes {
    const view = new DataView(extra.buffer, extra.byteOffset, extra.byteLength);
    let zip64: DataView | undefined;
    let position = 0;
    while (position < extra.byteLength) {
      if (position > extra.byteLength - 4) {
        throw new ZipFormatError("Truncated ZIP extra field header.");
      }
      const id = view.getUint16(position, true);
      const length = view.getUint16(position + 2, true);
      position += 4;
      if (length > extra.byteLength - position) {
        throw new ZipFormatError("Truncated ZIP extra field contents.");
      }
      if (id === ZIP64_EXTRA_FIELD_ID) {
        if (zip64) {
          throw new ZipFormatError("Duplicate ZIP64 extended information fields.");
        }
        zip64 = new DataView(extra.buffer, extra.byteOffset + position, length);
      }
      position += length;
    }
    position = 0;
    const expanded = (value: number): number => {
      if (value !== ZIP64_SENTINEL) return value;
      if (!zip64) throw new ZipFormatError("Missing required ZIP64 extended information field.");
      const result = this.safeUint64(zip64, position);
      position += 8;
      return result;
    };
    const uncompressedSize = expanded(fields.uncompressedSize);
    const compressedSize = expanded(fields.compressedSize);
    const localHeaderOffset = expanded(fields.localHeaderOffset);
    let diskNumber = fields.diskNumber;
    if (diskNumber === ZIP64_COUNT_SENTINEL) {
      if (!zip64 || position > zip64.byteLength - 4) {
        throw new ZipFormatError("Missing ZIP64 disk number field.");
      }
      diskNumber = zip64.getUint32(position, true);
    }
    return { uncompressedSize, compressedSize, localHeaderOffset, diskNumber };
  }

  private validateFeatures(version: number, flags: number, method: number, fileName: string): void {
    if (version !== 10 && version !== 20 && version !== 45) {
      throw new ZipFormatError(
        `Unsupported ZIP version-needed-to-extract ${version} for "${fileName}".`,
        "unsupported",
      );
    }
    if ((flags & 0x2041) !== 0) {
      throw new ZipFormatError(
        `Native ZIP encryption is not supported for "${fileName}".`,
        "unsupported",
      );
    }
    if ((flags & 0x20) !== 0) {
      throw new ZipFormatError(
        `Patched ZIP data is not supported for "${fileName}".`,
        "unsupported",
      );
    }
    if (method !== COMPRESSION_METHOD_STORED && method !== COMPRESSION_METHOD_DEFLATE) {
      throw new ZipFormatError(
        `Unsupported compression method ${method} for "${fileName}".`,
        "unsupported",
      );
    }
  }

  private decodeFileName(bytes: Uint8Array): string {
    try {
      return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      throw new ZipFormatError("Invalid UTF-8 ZIP entry name.");
    }
  }

  public localExtraFieldLength(metadata: ZipEntryMetadata): number {
    return this.readLocalHeader(metadata).extraFieldLength;
  }

  public validateOcfHeaders(): void {
    let previousEnd = 0;
    for (const metadata of [...this.metadata].sort(
      (a, b) => a.localHeaderOffset - b.localHeaderOffset,
    )) {
      this.validateRecordGap(previousEnd, metadata.localHeaderOffset);
      const header = this.readLocalHeader(metadata);
      this.requireEntryDataRange(header.dataStart, metadata.compressedSize);
      previousEnd = header.dataStart + metadata.compressedSize;
      if ((header.flags & 8) !== 0) {
        previousEnd = this.dataDescriptorEnd(previousEnd, metadata, header);
      }
    }
    this.validateRecordGap(previousEnd, this.centralDirectoryOffset);
  }

  private validateRecordGap(start: number, end: number): void {
    if (start > end) {
      throw new ZipFormatError("Overlapping ZIP entry records.");
    }
    if (
      end - start >= 4 &&
      this.dataViewAt(start, 4).getUint32(0, true) === ARCHIVE_EXTRA_DATA_SIGNATURE
    ) {
      throw new ZipFormatError(
        "OCF archives cannot contain an Archive extra data record.",
        "unsupported",
      );
    }
  }

  private dataDescriptorEnd(
    start: number,
    metadata: ZipEntryMetadata,
    header: LocalHeader,
  ): number {
    const signed = this.dataViewAt(start, 4).getUint32(0, true) === DATA_DESCRIPTOR_SIGNATURE;
    const offsets = signed ? [start + 4, start] : [start];
    const widths =
      metadata.usesZip64Sizes || header.usesZip64Sizes || header.versionNeeded === 45
        ? [64, 32]
        : [32, 64];
    for (const offset of offsets) {
      for (const width of widths) {
        const length = width === 64 ? 20 : 12;
        if (length > this.centralDirectoryOffset - offset) continue;
        const view = this.dataViewAt(offset, length);
        const compressedSize =
          width === 64 ? view.getBigUint64(4, true) : BigInt(view.getUint32(4, true));
        const uncompressedSize =
          width === 64 ? view.getBigUint64(12, true) : BigInt(view.getUint32(8, true));
        if (
          view.getUint32(0, true) === metadata.crc32 &&
          compressedSize === BigInt(metadata.compressedSize) &&
          uncompressedSize === BigInt(metadata.uncompressedSize)
        ) {
          return offset + length;
        }
      }
    }
    throw new ZipFormatError(`Malformed data descriptor for "${metadata.fileName}".`);
  }

  private readLocalHeader(metadata: ZipEntryMetadata): LocalHeader {
    const cursor = new BinaryCursor(
      this.dataViewAt(metadata.localHeaderOffset, LOCAL_FILE_HEADER_FIXED_SIZE),
    );
    const signature = cursor.readUint32();
    if (signature !== LOCAL_FILE_HEADER_SIGNATURE) {
      throw new ZipFormatError(
        `Malformed local file header for "${metadata.fileName}": bad signature.`,
      );
    }

    const versionNeeded = cursor.readUint16();
    const flags = cursor.readUint16();
    const compressionMethod = cursor.readUint16();
    this.validateFeatures(versionNeeded, flags, compressionMethod, metadata.fileName);
    if (compressionMethod !== metadata.compressionMethod || ((flags ^ metadata.flags) & 8) !== 0) {
      throw new ZipFormatError(`Inconsistent local and central header for "${metadata.fileName}".`);
    }
    cursor.skip(2 + 2); // last mod file time and date
    const crc = cursor.readUint32();
    const compressedSize = cursor.readUint32();
    const uncompressedSize = cursor.readUint32();
    const fileNameLength = cursor.readUint16();
    const extraFieldLength = cursor.readUint16();
    const fields = new BinaryCursor(
      this.dataViewAt(
        metadata.localHeaderOffset + LOCAL_FILE_HEADER_FIXED_SIZE,
        fileNameLength + extraFieldLength,
      ),
    );
    if (this.decodeFileName(fields.readBytes(fileNameLength)) !== metadata.fileName) {
      throw new ZipFormatError(
        `Local and central ZIP entry names disagree for "${metadata.fileName}".`,
      );
    }
    const sizes = this.resolveZip64Extra(fields.readBytes(extraFieldLength), {
      compressedSize,
      uncompressedSize,
      localHeaderOffset: 0,
      diskNumber: 0,
    });
    return {
      versionNeeded,
      flags,
      crc32: crc,
      compressedSize: sizes.compressedSize,
      uncompressedSize: sizes.uncompressedSize,
      extraFieldLength,
      dataStart:
        metadata.localHeaderOffset +
        LOCAL_FILE_HEADER_FIXED_SIZE +
        fileNameLength +
        extraFieldLength,
      usesZip64Sizes: compressedSize === ZIP64_SENTINEL || uncompressedSize === ZIP64_SENTINEL,
    };
  }

  private requireEntryDataRange(offset: number, length: number): void {
    this.requireByteRange(offset, length);
    if (length > this.centralDirectoryOffset - offset) {
      throw new ZipFormatError("ZIP entry data overlaps the central directory.");
    }
  }

  /** Reads the local header, decompresses the bounded payload, and verifies size and CRC. */
  public async readEntryBytes(metadata: ZipEntryMetadata): Promise<Uint8Array> {
    const header = this.readLocalHeader(metadata);
    this.requireEntryDataRange(header.dataStart, metadata.compressedSize);
    if (
      (header.flags & 8) === 0 &&
      (header.compressedSize !== metadata.compressedSize ||
        header.uncompressedSize !== metadata.uncompressedSize ||
        header.crc32 !== metadata.crc32)
    ) {
      throw new ZipIntegrityError(
        `Local and central ZIP sizes or CRC disagree for "${metadata.fileName}".`,
      );
    }
    const compressed = this.bytes.subarray(
      header.dataStart,
      header.dataStart + metadata.compressedSize,
    );

    const decompressed = await this.decompress(compressed, metadata.compressionMethod, metadata);
    if (decompressed.length !== metadata.uncompressedSize) {
      throw new ZipIntegrityError(
        `Uncompressed size mismatch for "${metadata.fileName}": archive is corrupted or truncated.`,
      );
    }

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
      const reader = stream.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value.byteLength > metadata.uncompressedSize - length) {
            await reader.cancel("ZIP output exceeds its declared size.");
            throw new ZipIntegrityError(
              `Deflate output exceeds the declared size for "${metadata.fileName}".`,
            );
          }
          chunks.push(value);
          length += value.byteLength;
        }
      } catch (error) {
        if (
          error instanceof TypeError ||
          (error instanceof DOMException && error.name === "DataError")
        ) {
          throw new ZipIntegrityError(`Invalid Deflate data for "${metadata.fileName}".`);
        }
        throw error;
      } finally {
        reader.releaseLock();
      }
      const result = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return result;
    }

    throw new ZipFormatError(
      `Unsupported compression method ${compressionMethod} for "${metadata.fileName}".`,
      "unsupported",
    );
  }

  private requireByteRange(offset: number, length: number): void {
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset < 0 ||
      length < 0 ||
      offset > this.bytes.length ||
      length > this.bytes.length - offset
    ) {
      throw new ZipFormatError("ZIP record extends beyond the archive's byte range.");
    }
  }

  private dataViewAt(offset: number, length = this.bytes.length - offset): DataView {
    this.requireByteRange(offset, length);
    return new DataView(this.bytes.buffer, this.bytes.byteOffset + offset, length);
  }
}
