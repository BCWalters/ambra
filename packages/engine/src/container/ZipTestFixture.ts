import { crc32 } from "./Crc32.js";

export type Zip64FixtureField =
  "uncompressedSize" | "compressedSize" | "localHeaderOffset" | "diskNumber";

export function zip64Envelope(bytes: Uint8Array, entryCount?: number): Uint8Array {
  const oldEnd = bytes.length - 22;
  const old = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const result = new Uint8Array(bytes.length + 76);
  result.set(bytes.subarray(0, oldEnd));
  result.set(bytes.subarray(oldEnd), oldEnd + 76);
  const view = new DataView(result.buffer);
  const count = entryCount ?? old.getUint16(oldEnd + 10, true);
  view.setUint32(oldEnd, 0x06064b50, true);
  view.setBigUint64(oldEnd + 4, 44n, true);
  view.setUint16(oldEnd + 12, 45, true);
  view.setUint16(oldEnd + 14, 45, true);
  view.setBigUint64(oldEnd + 24, BigInt(count), true);
  view.setBigUint64(oldEnd + 32, BigInt(count), true);
  view.setBigUint64(oldEnd + 40, BigInt(old.getUint32(oldEnd + 12, true)), true);
  view.setBigUint64(oldEnd + 48, BigInt(old.getUint32(oldEnd + 16, true)), true);
  view.setUint32(oldEnd + 56, 0x07064b50, true);
  view.setBigUint64(oldEnd + 64, BigInt(oldEnd), true);
  view.setUint32(oldEnd + 72, 1, true);
  view.setUint16(oldEnd + 76 + 8, 0xffff, true);
  view.setUint16(oldEnd + 76 + 10, 0xffff, true);
  view.setUint32(oldEnd + 76 + 12, 0xffffffff, true);
  view.setUint32(oldEnd + 76 + 16, 0xffffffff, true);
  return result;
}

export function singleEntryZipFixture({
  name = "file.txt",
  data = new TextEncoder().encode("hello"),
  compressedData = data,
  method = 0,
  zip64 = false,
  fields = ["uncompressedSize", "compressedSize", "localHeaderOffset"],
  descriptor,
  signedDescriptor = true,
  nameBytes = new TextEncoder().encode(name),
}: {
  name?: string;
  data?: Uint8Array;
  compressedData?: Uint8Array;
  method?: number;
  zip64?: boolean;
  fields?: readonly Zip64FixtureField[];
  descriptor?: 32 | 64;
  signedDescriptor?: boolean;
  nameBytes?: Uint8Array;
} = {}) {
  const has = (field: Zip64FixtureField) => zip64 && fields.includes(field);
  const localFields = (["uncompressedSize", "compressedSize"] as const).filter(has);
  const centralFields = (
    ["uncompressedSize", "compressedSize", "localHeaderOffset", "diskNumber"] as const
  ).filter(has);
  const values = {
    uncompressedSize: data.byteLength,
    compressedSize: compressedData.byteLength,
    localHeaderOffset: 0,
    diskNumber: 0,
  };
  const extra = (selected: readonly Zip64FixtureField[], local: boolean): Uint8Array => {
    if (selected.length === 0) return new Uint8Array();
    const length = selected.reduce((sum, field) => sum + (field === "diskNumber" ? 4 : 8), 0);
    const bytes = new Uint8Array(4 + length);
    const view = new DataView(bytes.buffer);
    view.setUint16(0, 1, true);
    view.setUint16(2, length, true);
    let offset = 4;
    for (const field of selected) {
      const value = local && descriptor ? 0 : values[field];
      if (field === "diskNumber") {
        view.setUint32(offset, value, true);
        offset += 4;
      } else {
        view.setBigUint64(offset, BigInt(value), true);
        offset += 8;
      }
    }
    return bytes;
  };
  const localExtra = extra(localFields, true);
  const centralExtra = extra(centralFields, false);
  const dataStart = 30 + nameBytes.byteLength + localExtra.byteLength;
  const descriptorOffset = dataStart + compressedData.byteLength;
  const descriptorLength = descriptor
    ? (signedDescriptor ? 4 : 0) + (descriptor === 64 ? 20 : 12)
    : 0;
  const directoryOffset = descriptorOffset + descriptorLength;
  const directorySize = 46 + nameBytes.byteLength + centralExtra.byteLength;
  const oldEnd = directoryOffset + directorySize;
  const bytes = new Uint8Array(oldEnd + 22);
  const view = new DataView(bytes.buffer);
  const checksum = crc32(data);
  const version = zip64 || descriptor === 64 ? 45 : method === 8 || descriptor ? 20 : 10;
  const flags = 0x800 | (descriptor ? 8 : 0);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, version, true);
  view.setUint16(6, flags, true);
  view.setUint16(8, method, true);
  view.setUint32(14, descriptor ? 0 : checksum, true);
  view.setUint32(
    18,
    has("compressedSize") ? 0xffffffff : descriptor ? 0 : compressedData.byteLength,
    true,
  );
  view.setUint32(22, has("uncompressedSize") ? 0xffffffff : descriptor ? 0 : data.byteLength, true);
  view.setUint16(26, nameBytes.byteLength, true);
  view.setUint16(28, localExtra.byteLength, true);
  bytes.set(nameBytes, 30);
  bytes.set(localExtra, 30 + nameBytes.byteLength);
  bytes.set(compressedData, dataStart);
  if (descriptor) {
    let offset = descriptorOffset;
    if (signedDescriptor) {
      view.setUint32(offset, 0x08074b50, true);
      offset += 4;
    }
    view.setUint32(offset, checksum, true);
    if (descriptor === 64) {
      view.setBigUint64(offset + 4, BigInt(compressedData.byteLength), true);
      view.setBigUint64(offset + 12, BigInt(data.byteLength), true);
    } else {
      view.setUint32(offset + 4, compressedData.byteLength, true);
      view.setUint32(offset + 8, data.byteLength, true);
    }
  }
  view.setUint32(directoryOffset, 0x02014b50, true);
  view.setUint16(directoryOffset + 4, version, true);
  view.setUint16(directoryOffset + 6, version, true);
  view.setUint16(directoryOffset + 8, flags, true);
  view.setUint16(directoryOffset + 10, method, true);
  view.setUint32(directoryOffset + 16, checksum, true);
  view.setUint32(
    directoryOffset + 20,
    has("compressedSize") ? 0xffffffff : compressedData.byteLength,
    true,
  );
  view.setUint32(
    directoryOffset + 24,
    has("uncompressedSize") ? 0xffffffff : data.byteLength,
    true,
  );
  view.setUint16(directoryOffset + 28, nameBytes.byteLength, true);
  view.setUint16(directoryOffset + 30, centralExtra.byteLength, true);
  view.setUint16(directoryOffset + 34, has("diskNumber") ? 0xffff : 0, true);
  view.setUint32(directoryOffset + 42, has("localHeaderOffset") ? 0xffffffff : 0, true);
  bytes.set(nameBytes, directoryOffset + 46);
  bytes.set(centralExtra, directoryOffset + 46 + nameBytes.byteLength);
  view.setUint32(oldEnd, 0x06054b50, true);
  view.setUint16(oldEnd + 8, 1, true);
  view.setUint16(oldEnd + 10, 1, true);
  view.setUint32(oldEnd + 12, directorySize, true);
  view.setUint32(oldEnd + 16, directoryOffset, true);
  return {
    bytes: zip64 ? zip64Envelope(bytes) : bytes,
    directoryOffset,
    centralExtraOffset: directoryOffset + 46 + nameBytes.byteLength,
    localExtraOffset: 30 + nameBytes.byteLength,
    descriptorOffset,
    endOffset: zip64 ? oldEnd + 76 : oldEnd,
    zip64EndOffset: oldEnd,
    zip64LocatorOffset: oldEnd + 56,
  };
}
