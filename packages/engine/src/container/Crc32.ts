// Standard table-based CRC-32 (ISO 3309 / ITU-T V.42), the checksum used by
// the ZIP format to detect corrupted entries. Implemented from scratch since
// it's a small, well-known, self-contained algorithm — not a reason to pull
// in a third-party dependency.

let crcTable: Uint32Array | undefined;

function getCrcTable(): Uint32Array {
  if (crcTable) {
    return crcTable;
  }

  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? (0xedb88320 ^ (c >>> 1)) >>> 0 : c >>> 1;
    }
    table[n] = c;
  }

  crcTable = table;
  return table;
}

/** Computes the CRC-32 checksum of `bytes`, as used by the ZIP format. */
export function crc32(bytes: Uint8Array): number {
  const table = getCrcTable();
  let crc = 0xffffffff;

  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i] as number;
    crc = (table[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}
