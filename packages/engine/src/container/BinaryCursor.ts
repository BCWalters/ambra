/**
 * Small mutable cursor over a `DataView` for sequentially reading the
 * little-endian integers and byte ranges that make up the ZIP file format.
 */
export class BinaryCursor {
  public constructor(
    private readonly view: DataView,
    private offset: number = 0,
  ) {}

  public get position(): number {
    return this.offset;
  }

  public set position(value: number) {
    this.offset = value;
  }

  public readUint16(): number {
    const value = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return value;
  }

  public readUint32(): number {
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }

  public readBytes(length: number): Uint8Array {
    const bytes = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, length);
    this.offset += length;
    return bytes;
  }

  public skip(length: number): void {
    this.offset += length;
  }
}
