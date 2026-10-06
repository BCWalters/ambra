export type ResourceConsumer =
  "image" | "font" | "audio" | "video" | "stylesheet" | "object" | "track"   | "document"
  | "auto";

export interface ResourceCapabilities {
  supports(
    mediaType: string,
    consumer: ResourceConsumer,
    read: () => Promise<Uint8Array>,
    signal: AbortSignal,
  ): Promise<boolean>;
}

const FONT_TYPES = new Set([
  "font/otf",
  "font/ttf",
  "font/woff",
  "font/woff2",
  "application/font-sfnt",
  "application/font-woff",
  "application/vnd.ms-opentype",
]);
const PROBE_TIMEOUT_MS = 10_000;

/** Probe the decoder used by the actual consumer, never an encoder, UA string,
 * or a WebCodecs decoder which may differ from <img>/<audio>/<video>. */
export class BrowserResourceCapabilities implements ResourceCapabilities {
  public async supports(
    mediaType: string,
    consumer: ResourceConsumer,
    read: () => Promise<Uint8Array>,
    signal: AbortSignal,
  ): Promise<boolean> {
    signal.throwIfAborted();
    if (consumer === "document") return false;
    const type = mediaType.split(";")[0]!.trim().toLowerCase();
    if (consumer === "auto") {
      consumer = FONT_TYPES.has(type) ? "font" : type === "text/css" ? "stylesheet" : "image";
    }
    if (consumer === "stylesheet") return type === "text/css";
    if (consumer === "track") return type === "text/vtt";
    if (consumer === "object") consumer = "image";
    if (consumer === "font") {
      if (!FONT_TYPES.has(type)) return false;
      const bytes = await read();
      signal.throwIfAborted();
      const font = new FontFace("ambra-resource-probe", Uint8Array.from(bytes).buffer);
      return await this.probe(signal, (complete) => {
        void font.load().then(
          () => complete(true),
          (error) => {
            if (!(error instanceof DOMException) || error.name !== "SyntaxError") {
              complete(error);
            } else {
              complete(false);
            }
          },
        );
        return () => {};
      });
    }
    if (consumer === "image") {
      if (!type.startsWith("image/")) return false;
      const bytes = await read();
      signal.throwIfAborted();
      const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: mediaType }));
      const image = new Image();
      try {
        return await this.probe(signal, (complete) => {
          image.onload = () => complete(image.naturalWidth > 0 && image.naturalHeight > 0);
          image.onerror = () => complete(false);
          image.src = url;
          return () => {
            image.onload = null;
            image.onerror = null;
            image.removeAttribute("src");
          };
        });
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    if (!type.startsWith(`${consumer}/`) && !(consumer === "audio" && type === "application/ogg"))
      return false;
    const media = document.createElement(consumer);
    if (!media.canPlayType(mediaType)) return false;
    const bytes = await read();
    signal.throwIfAborted();
    const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: mediaType }));
    try {
      return await this.probe(signal, (complete) => {
        media.onloadeddata = () => complete(true);
        media.onerror = () => complete(false);
        media.preload = "auto";
        media.src = url;
        media.load();
        return () => {
          media.onloadeddata = null;
          media.onerror = null;
          media.removeAttribute("src");
          media.load();
        };
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  private probe(
    signal: AbortSignal,
    start: (complete: (result: unknown) => void) => () => void,
  ): Promise<boolean> {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      let cleanup = (): void => {};
      let settled = false;
      const finish = (result: unknown): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", aborted);
        cleanup();
        if (typeof result === "boolean") resolve(result);
        else reject(result);
      };
      const aborted = (): void => finish(signal.reason);
      const timer = setTimeout(() => {
        console.warn("Timed out checking a publication resource decoder; trying its fallback.");
        finish(false);
      }, PROBE_TIMEOUT_MS);
      signal.addEventListener("abort", aborted, { once: true });
      try {
        cleanup = start(finish);
        if (settled) cleanup();
      } catch (error) {
        finish(error);
      }
    });
  }
}
