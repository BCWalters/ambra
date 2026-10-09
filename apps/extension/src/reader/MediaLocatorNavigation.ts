import { EpubCfi, LocatorResolutionError } from "@ambra/engine";
import type { CfiSpatialOffset, ResolvedLocator } from "@ambra/engine";

const RESOURCE_TIMEOUT_MS = 15000;

function waitForResource(
  target: EventTarget,
  events: readonly string[],
  ready: () => boolean,
  signal: AbortSignal,
  description: string,
  start?: () => void,
): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (error?: unknown): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      for (const event of events) target.removeEventListener(event, check);
      target.removeEventListener("error", failed);
      signal.removeEventListener("abort", aborted);
      if (error !== undefined) reject(error);
      else resolve();
    };
    const check = (): void => {
      try {
        if (ready()) finish();
      } catch (error) {
        finish(error);
      }
    };
    const failed = (): void => { finish(new LocatorResolutionError(`Unable to ${description}.`)); };
    const aborted = (): void => { finish(signal.reason); };
    const timeout = setTimeout(() => {
      finish(new LocatorResolutionError(`Timed out attempting to ${description}.`));
    }, RESOURCE_TIMEOUT_MS);
    for (const event of events) target.addEventListener(event, check);
    target.addEventListener("error", failed);
    signal.addEventListener("abort", aborted);
    try {
      start?.();
      check();
    } catch (error) {
      finish(error);
    }
  });
}

function timedMedia(node: Node): HTMLMediaElement {
  if (node.nodeType !== 1 || (node as Element).namespaceURI !== "http://www.w3.org/1999/xhtml" ||
    !["audio", "video"].includes((node as Element).localName)) {
    throw new LocatorResolutionError("The temporal position does not address audio or video.");
  }
  return node as HTMLMediaElement;
}

export async function prepareMediaPosition(point: ResolvedLocator, signal: AbortSignal): Promise<void> {
  const offsets = point.mediaOffsets;
  if (!offsets) return;
  signal.throwIfAborted();
  if (offsets.temporalOffsetSeconds !== undefined || (point.node as Element).localName === "video") {
    const media = timedMedia(point.node);
    if (media.error) throw new LocatorResolutionError(`The referenced media cannot be decoded (code ${media.error.code}).`);
    await waitForResource(media, ["loadedmetadata", "durationchange"], () => media.readyState >= 1,
      signal, "load the referenced media metadata", () => {
        if (media.readyState < 1 && (media.networkState === 0 || media.preload === "none")) media.load();
      });
    signal.throwIfAborted();
    const seconds = offsets.temporalOffsetSeconds;
    if (seconds !== undefined) {
      if (!Number.isFinite(media.duration) || seconds > media.duration) {
        throw new LocatorResolutionError("The temporal position is outside the referenced media's duration.");
      }
      const started = performance.now();
      await waitForResource(media, ["seeked", "timeupdate"], () => !media.seeking &&
        media.currentTime >= seconds - 0.05 &&
        media.currentTime <= seconds + (media.paused ? 0 : (performance.now() - started) * media.playbackRate / 1000) + 0.05,
      signal, "seek to the referenced media position", () => {
        // Seeking is not a playback command: leave paused/playing intent and rate alone.
        media.currentTime = seconds;
        if (Math.abs(media.currentTime - seconds) > 0.05) {
          throw new LocatorResolutionError("The referenced media did not accept the requested temporal position.");
        }
      });
    }
  } else if ((point.node as Element).localName === "img") {
    const image = point.node as HTMLImageElement;
    await waitForResource(image, ["load"], () => {
      if (image.complete && image.naturalWidth === 0) {
        throw new LocatorResolutionError("The referenced image cannot be decoded.");
      }
      return image.complete;
    }, signal, "load the referenced image");
  }
}

export function currentMediaCfi(cfi: string, node: Node): string {
  const parsed = EpubCfi.parse(cfi);
  if (parsed.mediaOffsets?.temporalOffsetSeconds === undefined) return cfi;
  return new EpubCfi(parsed.packageSteps, parsed.contentSteps, undefined, undefined, {
    ...parsed.mediaOffsets, temporalOffsetSeconds: timedMedia(node).currentTime,
  }).toString();
}

function positionedOffset(value: string, available: number): number {
  const number = "[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)(?:e[+-]?\\d+)?";
  const term = `(${number})(%|px)`;
  const plain = new RegExp(`^${term}$`, "i").exec(value);
  const calculated = new RegExp(`^calc\\(\\s*${term}(?:\\s+([+-])\\s+${term})?\\s*\\)$`, "i").exec(value);
  const match = plain ?? calculated;
  if (match) {
    const resolve = (amount: string, unit: string): number =>
      Number(amount) * (unit === "%" ? available / 100 : 1);
    const first = resolve(match[1]!, match[2]!);
    const result = calculated?.[4] === undefined ? first
      : first + (calculated[3] === "-" ? -1 : 1) * resolve(calculated[4], calculated[5]!);
    if (Number.isFinite(result)) return result;
  }
  throw new LocatorResolutionError(`Unsupported spatial media object-position "${value}".`);
}

function objectPositionOffsets(value: string, width: number, height: number): { x: number; y: number } {
  // Computed edge positions are serialized as calc(percentage +/- pixels).
  const components = /^(calc\([^()]*\)|\S+)\s+(calc\([^()]*\)|\S+)$/.exec(value.trim());
  if (!components) {
    throw new LocatorResolutionError(`Unsupported spatial media object-position "${value}".`);
  }
  return { x: positionedOffset(components[1]!, width), y: positionedOffset(components[2]!, height) };
}

/** Coordinates are in the target iframe, before any shell-level canvas scaling. */
export function spatialMediaPoint(node: Node, position: CfiSpatialOffset): { x: number; y: number } {
  const element = node as Element;
  const view = node.ownerDocument?.defaultView;
  if (node.nodeType !== 1 || !view) throw new LocatorResolutionError("The spatial position has no rendered media.");
  const box = element.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0) throw new LocatorResolutionError("The referenced visual media has no visible dimensions.");
  let result: { x: number; y: number };
  if (element.namespaceURI === "http://www.w3.org/2000/svg" && element.localName === "svg") {
    const svg = element as SVGSVGElement;
    const matrix = svg.getScreenCTM();
    if (!matrix) throw new LocatorResolutionError("The SVG spatial position has no viewport transform.");
    const bounds = svg.viewBox.baseVal;
    const width = bounds.width || svg.width.baseVal.value;
    const height = bounds.height || svg.height.baseVal.value;
    if (width <= 0 || height <= 0) throw new LocatorResolutionError("The SVG spatial position has no intrinsic dimensions.");
    const x = (bounds.width ? bounds.x : 0) + width * position.x / 100;
    const y = (bounds.height ? bounds.y : 0) + height * position.y / 100;
    result = { x: matrix.a * x + matrix.c * y + matrix.e, y: matrix.b * x + matrix.d * y + matrix.f };
  } else {
    let flipX = false;
    let flipY = false;
    for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
      const transform = view.getComputedStyle(ancestor).transform;
      if (!transform || transform === "none") continue;
      const matrix = new view.DOMMatrix(transform);
      if (!matrix.is2D || matrix.b !== 0 || matrix.c !== 0) {
        throw new LocatorResolutionError("Spatial navigation into rotated or perspective-transformed media is not supported.");
      }
      flipX = flipX !== (matrix.a < 0);
      flipY = flipY !== (matrix.d < 0);
    }
    const style = view.getComputedStyle(element);
    const horizontalInset = parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
    const verticalInset = parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop);
    const contentWidth = parseFloat(style.width) - (style.boxSizing === "border-box"
      ? horizontalInset + parseFloat(style.borderRightWidth) + parseFloat(style.paddingRight) : 0);
    const contentHeight = parseFloat(style.height) - (style.boxSizing === "border-box"
      ? verticalInset + parseFloat(style.borderBottomWidth) + parseFloat(style.paddingBottom) : 0);
    const scaleX = box.width / (contentWidth + horizontalInset + parseFloat(style.borderRightWidth) + parseFloat(style.paddingRight));
    const scaleY = box.height / (contentHeight + verticalInset + parseFloat(style.borderBottomWidth) + parseFloat(style.paddingBottom));
    const intrinsic = element.localName === "img"
      ? { width: (element as HTMLImageElement).naturalWidth, height: (element as HTMLImageElement).naturalHeight }
      : { width: (element as HTMLVideoElement).videoWidth, height: (element as HTMLVideoElement).videoHeight };
    if (intrinsic.width <= 0 || intrinsic.height <= 0) {
      throw new LocatorResolutionError("The referenced visual media has no decoded image dimensions.");
    }
    const contain = Math.min(contentWidth / intrinsic.width, contentHeight / intrinsic.height);
    const fit = style.objectFit;
    let width = contentWidth;
    let height = contentHeight;
    if (fit !== "fill") {
      const scale = fit === "cover" ? Math.max(contentWidth / intrinsic.width, contentHeight / intrinsic.height)
        : fit === "none" ? 1 : fit === "scale-down" ? Math.min(1, contain) : contain;
      width = intrinsic.width * scale;
      height = intrinsic.height * scale;
    }
    const placement = objectPositionOffsets(style.objectPosition, contentWidth - width, contentHeight - height);
    const x = placement.x + width * position.x / 100;
    const y = placement.y + height * position.y / 100;
    if (x < -0.01 || y < -0.01 || x > contentWidth + 0.01 || y > contentHeight + 0.01) {
      throw new LocatorResolutionError("The requested spatial point is outside the media's visible crop.");
    }
    result = {
      x: box.left + (flipX ? box.width - (horizontalInset + x) * scaleX : (horizontalInset + x) * scaleX),
      y: box.top + (flipY ? box.height - (verticalInset + y) * scaleY : (verticalInset + y) * scaleY),
    };
  }
  if (!Number.isFinite(result.x) || !Number.isFinite(result.y) ||
    result.x < box.left - 0.01 || result.x > box.right + 0.01 ||
    result.y < box.top - 0.01 || result.y > box.bottom + 0.01) {
    throw new LocatorResolutionError("The requested spatial point is outside the media's rendered viewport.");
  }
  return result;
}
