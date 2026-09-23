import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContentLoader, PackageDocument } from "@ambra/engine";
import { EpubInspectionSession } from "./EpubInspectionSession.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

function makeSession(readArchiveFileBytes: ContentLoader["readArchiveFileBytes"]) {
  return new EpubInspectionSession(
    { readArchiveFileBytes } as ContentLoader, {} as PackageDocument, "content.opf",
  );
}

describe("EpubInspectionSession preview ownership", () => {
  beforeEach(() => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("shares in-flight preview creation and revokes the resulting URL exactly once", async () => {
    const bytes = deferred<Uint8Array>();
    const read = vi.fn().mockReturnValue(bytes.promise);
    const session = makeSession(read);
    const first = session.getInspectionFilePreviewUrl("image.png", "image/png");
    const second = session.getInspectionFilePreviewUrl("image.png", "image/png");
    expect(second).toBe(first);
    expect(read).toHaveBeenCalledOnce();
    bytes.resolve(new Uint8Array([1]));
    expect(await first).toBe("blob:preview");
    expect(await second).toBe("blob:preview");
    expect(await session.getInspectionFilePreviewUrl("image.png", "image/png")).toBe("blob:preview");
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    session.dispose();
    session.dispose();
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:preview");
    await expect(session.getInspectionFilePreviewUrl("image.png", "image/png")).rejects.toThrow("closed");
  });

  it("never creates an object URL when disposed during the archive read", async () => {
    const bytes = deferred<Uint8Array>();
    const session = makeSession(vi.fn().mockReturnValue(bytes.promise));
    const pending = session.getInspectionFilePreviewUrl("image.png", "image/png");
    const rejection = expect(pending).rejects.toThrow("closed");
    session.dispose();
    bytes.resolve(new Uint8Array([1]));
    await rejection;
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("evicts rejected in-flight reads so a retry can succeed", async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error("Read failed"))
      .mockResolvedValueOnce(new Uint8Array([1]));
    const session = makeSession(read);
    await expect(session.getInspectionFilePreviewUrl("image.png", "image/png")).rejects.toThrow("Read failed");
    expect(await session.getInspectionFilePreviewUrl("image.png", "image/png")).toBe("blob:preview");
    expect(read).toHaveBeenCalledTimes(2);
    session.dispose();
  });
});
