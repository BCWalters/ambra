export interface LibraryDownloadProgress {
  readonly receivedBytes: number;
  readonly totalBytes?: number;
}

/** Count the Library's own response, not the separate native download. */
export async function readLibraryDownload(
  response: Response,
  onProgress: (progress: LibraryDownloadProgress) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  const length = response.headers.get("content-length");
  const encoding = response.headers.get("content-encoding");
  const size = length && /^\d+$/.test(length) ? Number(length) : NaN;
  // Fetch exposes decoded bytes; a compressed Content-Length describes wire bytes.
  let totalBytes = (!encoding || encoding.toLowerCase() === "identity") &&
    Number.isSafeInteger(size) && size > 0 ? size : undefined;
  let receivedBytes = 0;
  let lastReported = -Infinity;
  const report = () => onProgress({ receivedBytes, totalBytes });
  report();
  const body = response.body?.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      receivedBytes += chunk.byteLength;
      if (totalBytes !== undefined && receivedBytes > totalBytes) totalBytes = undefined;
      const now = performance.now();
      if (now - lastReported >= 250) {
        report();
        lastReported = now;
      }
      controller.enqueue(chunk);
    },
  }), { signal });
  const blob = body
    ? await new Response(body, { headers: response.headers }).blob()
    : await response.blob();
  receivedBytes = blob.size;
  if (totalBytes !== undefined && receivedBytes !== totalBytes) totalBytes = undefined;
  report();
  return blob;
}
