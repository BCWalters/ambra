// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { readLibraryDownload } from "./LibraryDownload.js";

describe("Library response progress", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reports partial bytes before completion and preserves the downloaded data", async () => {
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const response = new Response(new ReadableStream({
      start(controller) { stream = controller; },
    }), { headers: { "content-length": "6", "content-type": "application/epub+zip" } });
    const progress = vi.fn();
    const reading = readLibraryDownload(response, progress);
    stream.enqueue(new TextEncoder().encode("abc"));
    await vi.waitFor(() => expect(progress).toHaveBeenLastCalledWith({ receivedBytes: 3, totalBytes: 6 }));
    stream.enqueue(new TextEncoder().encode("def"));
    stream.close();
    const blob = await reading;
    expect(await blob.text()).toBe("abcdef");
    expect(blob.type).toBe("application/epub+zip");
    expect(progress).toHaveBeenLastCalledWith({ receivedBytes: 6, totalBytes: 6 });
  });

  const unknownSizeHeaders: Record<string, string>[] = [
    {},
    { "content-length": "0" },
    { "content-length": "-1" },
    { "content-length": "2.5" },
    { "content-length": "not-a-size" },
    { "content-length": "9007199254740992" },
    { "content-length": "4", "content-encoding": "gzip" },
    { "content-length": "4", "content-encoding": "br" },
  ];
  it.each(unknownSizeHeaders)("does not invent percentages for unknown or encoded sizes: %j", async (headers) => {
    const progress = vi.fn();
    await readLibraryDownload(new Response("epub", { headers }), progress);
    expect(progress.mock.calls.every(([value]) => value.totalBytes === undefined)).toBe(true);
    expect(progress).toHaveBeenLastCalledWith({ receivedBytes: 4, totalBytes: undefined });
  });

  it.each(["2", "8"])("discards a mismatched total of %s", async (length) => {
    const progress = vi.fn();
    await readLibraryDownload(new Response("epub", { headers: { "content-length": length } }), progress);
    expect(progress).toHaveBeenLastCalledWith({ receivedBytes: 4, totalBytes: undefined });
    expect(progress.mock.calls.every(([value]) => value.totalBytes === undefined || value.receivedBytes <= value.totalBytes)).toBe(true);
  });

  it("coalesces a burst of chunks but always reports the final byte count", async () => {
    vi.spyOn(performance, "now").mockReturnValue(0);
    const progress = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 100; i++) controller.enqueue(new Uint8Array([i]));
        controller.close();
      },
    });
    const blob = await readLibraryDownload(new Response(body), progress);
    expect(blob.size).toBe(100);
    expect(progress.mock.calls.map(([value]) => value.receivedBytes)).toEqual([0, 1, 100]);
  });

  it.each([new Error("Disconnected"), new DOMException("Closed", "AbortError")])(
    "propagates stream failure rather than returning a partial book: %s", async (error) => {
      const response = new Response(new ReadableStream({
        start(controller) { controller.error(error); },
      }));
      await expect(readLibraryDownload(response, vi.fn())).rejects.toBe(error);
    },
  );

  it("handles an empty response without a readable stream", async () => {
    const progress = vi.fn();
    expect((await readLibraryDownload(new Response(null), progress)).size).toBe(0);
    expect(progress).toHaveBeenLastCalledWith({ receivedBytes: 0, totalBytes: undefined });
  });

  it.each(["before reading", "between chunks"])("cancels the response stream %s without returning partial bytes", async (stage) => {
    const abort = new AbortController();
    const cancel = vi.fn();
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const response = new Response(new ReadableStream({
      start(controller) { stream = controller; },
      cancel,
    }));
    const progress = vi.fn();
    if (stage === "before reading") abort.abort();
    const reading = readLibraryDownload(response, progress, abort.signal);
    const rejected = expect(reading).rejects.toMatchObject({ name: "AbortError" });
    if (stage === "between chunks") {
      stream.enqueue(new Uint8Array([1, 2, 3]));
      await vi.waitFor(() => expect(progress).toHaveBeenLastCalledWith({ receivedBytes: 3, totalBytes: undefined }));
      abort.abort();
    }
    await rejected;
    expect(cancel).toHaveBeenCalledExactlyOnceWith(abort.signal.reason);
    const reports = progress.mock.calls.length;
    await Promise.resolve();
    expect(progress).toHaveBeenCalledTimes(reports);
    expect(() => stream.enqueue(new Uint8Array([4]))).toThrow();
  });
});
