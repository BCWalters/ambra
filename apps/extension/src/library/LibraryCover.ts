/** Three device pixels per CSS pixel for the Library's 140 x 200 cards. */
export const LIBRARY_COVER_WIDTH = 420;
export const LIBRARY_COVER_HEIGHT = 600;

async function isAnimatedPng(blob: Blob): Promise<boolean> {
  // APNG requires acTL before the first IDAT. Read only chunk headers,
  // never copy/decompress the potentially large pixel payload to inspect it.
  let offset = 8;
  while (offset + 8 <= blob.size) {
    const header = new DataView(await blob.slice(offset, offset + 8).arrayBuffer());
    const type = header.getUint32(4);
    if (type === 0x6163544c) return true; // acTL
    if (type === 0x49444154) return false; // IDAT
    offset += header.getUint32(0) + 12;
  }
  return false;
}

/**
 * Rasterize JPEG, still PNG, and static SVG cards (including embedded artwork).
 * Animated or unknown formats retain their original rendering behavior.
 * Full-resolution/vector originals remain available to details and the reader.
 */
export async function createLibraryCover(blob: Blob): Promise<Blob | undefined> {
  const svg = blob.type === "image/svg+xml";
  const png = blob.type === "image/png";
  if (!svg && !png && blob.type !== "image/jpeg") return blob;
  if (png && await isAnimatedPng(blob)) return blob;
  if (svg) {
    const text = await blob.text();
    const document = new DOMParser().parseFromString(text, "image/svg+xml");
    if (document.querySelector("animate, animateMotion, animateTransform, set, foreignObject") ||
      /@keyframes|animation\s*[-:]/i.test(text)) return blob;
    // Embedded GIF/APNG/WebP and external resources may animate or depend on
    // context. Only flatten embedded still JPEG artwork, like Standard Ebooks.
    for (const image of document.querySelectorAll("image")) {
      const href = image.getAttribute("href") ?? image.getAttributeNS("http://www.w3.org/1999/xlink", "href");
      if (!href?.startsWith("data:image/jpeg")) return blob;
    }
  }
  const url = URL.createObjectURL(blob);
  const image = new Image();
  let canvas: HTMLCanvasElement | undefined;
  try {
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error("The cover has no image dimensions.");
    // ViewBox-only SVGs can report a small default intrinsic viewport even
    // when they embed large raster images. Always render those to the card size.
    const scale = Math.min(svg ? Infinity : 1,
      LIBRARY_COVER_WIDTH / image.naturalWidth, LIBRARY_COVER_HEIGHT / image.naturalHeight);
    if (!svg && scale === 1) return blob;
    canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("A canvas context is unavailable.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas!.toBlob(
        (thumbnail) => thumbnail ? resolve(thumbnail) : reject(new Error("Cover encoding failed.")),
        svg || png ? "image/png" : "image/jpeg", 0.85,
      );
    });
  } catch (error) {
    // A decorative cover must not prevent access to an otherwise readable book.
    console.warn("Ambra could not prepare a library cover. The book title will be shown instead.", error);
    return undefined;
  } finally {
    image.removeAttribute("src");
    URL.revokeObjectURL(url);
    if (canvas) canvas.width = canvas.height = 0;
  }
}
