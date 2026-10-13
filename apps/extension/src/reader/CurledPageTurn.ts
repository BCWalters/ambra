import { SandboxedContentHost } from "@ambra/engine";

export interface LeafPage {
  element: HTMLElement;
  furniture?: HTMLElement | undefined;
  capture?: (() => () => void) | undefined;
}

interface Segment {
  element: HTMLElement;
  shades: HTMLElement[];
}

interface FurnitureInk {
  element: HTMLElement;
  furniture: HTMLElement;
}

const SEGMENTS = 20;
const STRIP_OVERLAP = 1.5;
const XHTML = "http://www.w3.org/1999/xhtml";
const INK_BAND_PAINT =
  "[data-ambra-frozen-ink-band]{background:transparent!important;}" +
  "[data-ambra-frozen-ink-clip]{will-change:transform;}";
const MUTABLE_FURNITURE_PAINT = new Set([
  "inset-inline-start", "inset-inline-end", "inset-block-start", "inset-block-end",
  "left", "top", "right", "bottom", "z-index", "color", "opacity",
]);

function serializePaint(declarations: ReadonlyMap<string, string>): string {
  const parts: string[] = [];
  declarations.forEach((value, property) => {
    parts.push(`${property}:${value} !important;`);
  });
  return parts.join("");
}

/** Display-only copies stay inside a script-disabled publication sandbox. */
export class CurledPageTurn {
  private readonly surface: SandboxedContentHost;
  private readonly segments: Segment[] = [];
  private readonly savedOpacity = new Map<HTMLElement, string>();
  private readonly initialPaintStyles = new WeakMap<Document, ReadonlyMap<string, string>>();
  private readonly paintClasses = new Map<string, string>();
  private readonly paintRules: string[] = [];
  private readonly spacers = new WeakMap<
    Node,
    { top: number; bottom: number; marginBottom: string }
  >();
  private width = 0;
  private side: 1 | -1 = 1;
  private disposed = false;
  private flatFaces: [HTMLElement, HTMLElement] | undefined;

  public constructor(
    private readonly container: HTMLElement,
    private readonly background: string,
  ) {
    this.surface = new SandboxedContentHost(container.ownerDocument);
  }

  public async prepare(
    front: LeafPage,
    back: LeafPage,
    side: 1 | -1,
    signal?: AbortSignal,
    destination?: LeafPage,
    layout: "spread" | "single" = "spread",
  ): Promise<void> {
    const started = performance.now();
    this.side = side;
    const bounds = front.element.getBoundingClientRect();
    const containerBounds = this.container.getBoundingClientRect();
    this.width = bounds.width;
    const frame = this.surface.element;
    frame.dataset.ambraCurledLeaf = "";
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    Object.assign(frame.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      pointerEvents: "none",
      zIndex: "6",
      opacity: "0",
    });
    const abort = () => this.dispose();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      if (signal?.aborted) throw new DOMException("Page turn cancelled", "AbortError");
      const rendering = this.surface.render(
        `<html xmlns="${XHTML}"><head><title>Turning page</title></head><body style="margin:0;background:transparent"/></html>`,
      );
      this.container.append(frame);
      await rendering;
      if (this.disposed) throw new DOMException("Page turn cancelled", "AbortError");
      const doc = frame.contentDocument;
      if (!doc) throw new Error("Curled page surface is unavailable.");
      for (const root of [doc.documentElement, doc.body]) {
        Object.assign(root.style, {
          margin: "0",
          width: "100%",
          height: "100%",
          overflow: "hidden",
          background: "transparent",
        });
      }
      const scene = doc.createElement("div");
      Object.assign(scene.style, {
        position: "absolute",
        inset: "0",
        perspective: "2400px",
        transformStyle: "preserve-3d",
      });
      doc.body.append(scene);
      const frontCopy = this.copyPage(front, doc, bounds.width, bounds.height);
      let backCopy: HTMLElement;
      let underlay: HTMLElement | undefined;
      const restore = back.capture?.();
      try {
        backCopy = layout === "single"
          ? frontCopy.cloneNode(true) as HTMLElement
          : this.copyCapturedPage(back, doc, bounds.width, bounds.height);
        if (destination) {
          underlay =
            destination.capture === back.capture
              ? this.copyCapturedPage(destination, doc, bounds.width, bounds.height)
              : this.copyPage(destination, doc, bounds.width, bounds.height);
        }
      } finally {
        restore?.();
      }
      if (underlay) {
        underlay.dataset.leafUnderlay = "";
        underlay.style.zIndex = "0";
        underlay.style.left = `${bounds.left - containerBounds.left}px`;
        underlay.style.top = `${bounds.top - containerBounds.top}px`;
        scene.append(underlay);
      }
      const length = bounds.width / SEGMENTS;
      // Cover compositor seams while keeping the nominal hinges and copied ink aligned.
      const stripWidth = length + 2 * STRIP_OVERLAP;
      const furnitureInk: FurnitureInk[] = [];
      for (let index = 0; index < SEGMENTS; index++) {
        const strip = doc.createElement("div");
        Object.assign(strip.style, {
          position: "absolute",
          left: "0",
          top: `${bounds.top - containerBounds.top}px`,
          width: `${stripWidth}px`,
          height: `${bounds.height}px`,
          background: this.background,
          transformStyle: "preserve-3d",
          transformOrigin: `${STRIP_OVERLAP + (side === 1 ? 0 : length)}px center`,
          willChange: "transform",
          zIndex: "1",
        });
        strip.dataset.segment = String(index);
        const offset = index * length;
        const frontOffset = (side === 1 ? offset : bounds.width - offset - length) - STRIP_OVERLAP;
        const shades = [frontCopy, backCopy].map((template, faceIndex) => {
          const face = doc.createElement("div");
          face.dataset.face = faceIndex === 0 ? "front" : "back";
          Object.assign(face.style, {
            position: "absolute",
            inset: "0",
            overflow: "hidden",
            contain: "paint",
            backfaceVisibility: "hidden",
            background: this.background,
            transform: faceIndex === 1 ? "rotateY(180deg)" : "",
          });
          const content = template.cloneNode(true) as HTMLElement;
          content.style.left = `${-(faceIndex === 0 ? frontOffset : bounds.width - frontOffset - stripWidth)}px`;
          content.style.zIndex = "0";
          // Backface visibility is not inherited by independently composited children.
          content.style.backfaceVisibility = "hidden";
          face.append(content);
          const furniture = content.querySelector<HTMLElement>("[data-ambra-turn-furniture]");
          if (furniture) {
            const ink = doc.createElement("div");
            ink.style.cssText = content.style.cssText;
            ink.style.background = "transparent";
            ink.style.zIndex = "2";
            for (const band of furniture.children) {
              if (band instanceof doc.defaultView!.HTMLElement)
                band.dataset.ambraFrozenInkBand = "";
            }
            for (const text of furniture.querySelectorAll("span")) {
              const style = text.style;
              // Preserve the static ink color without blending its opacity over shaded paper.
              style.setProperty(
                "color",
                `color-mix(in srgb, ${style.color} ${Number(style.opacity) * 100}%, ${this.background})`,
                "important",
              );
              style.setProperty("opacity", "1", "important");
              style.setProperty("-webkit-text-fill-color", "currentColor", "important");
            }
            ink.append(furniture);
            face.append(ink);
            furnitureInk.push({ element: ink, furniture });
          }
          const shade = doc.createElement("div");
          Object.assign(shade.style, {
            position: "absolute",
            inset: "0",
            background: "#322714",
            pointerEvents: "none",
            willChange: "opacity",
            backfaceVisibility: "hidden",
            zIndex: "1",
          });
          face.append(shade);
          strip.append(face);
          return shade;
        });
        scene.append(strip);
        this.segments.push({ element: strip, shades });
      }
      this.hinge =
        side === 1 ? bounds.left - containerBounds.left : bounds.right - containerBounds.left;
      const destinationBounds = back.element.getBoundingClientRect();
      this.destinationHinge =
        layout === "single" ? this.hinge : side === 1
          ? destinationBounds.right - containerBounds.left
          : destinationBounds.left - containerBounds.left;
      this.flatFaces = [frontCopy, backCopy];
      for (const [index, copy] of this.flatFaces.entries()) {
        const pageBounds = index === 0 || layout === "single" ? bounds : destinationBounds;
        copy.dataset.flatLeafFace = index === 0 ? "front" : "back";
        copy.style.left = `${pageBounds.left - containerBounds.left - (layout === "single" && index === 1 ? side * bounds.width : 0)}px`;
        copy.style.top = `${pageBounds.top - containerBounds.top}px`;
        copy.style.zIndex = "2";
        copy.style.opacity = "0";
        copy.style.willChange = "opacity";
        scene.append(copy);
      }
      const paintStyles = doc.createElement("style");
      // Small ink bands avoid compositing their transparent page-height wrapper.
      paintStyles.textContent = `${this.paintRules.join("\n")}\n${INK_BAND_PAINT}`;
      doc.head.append(paintStyles);
      // Owned bands have fixed geometry; clip them before resource waits expose a frame.
      this.splitFurnitureInk(doc, furnitureInk, stripWidth);
      void scene.offsetHeight;
      const ready = Promise.all([
        doc.fonts.ready,
        ...Array.from(doc.images).map((image) => image.decode()),
      ]);
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => finish(new Error("Timed out preparing turning-page resources.")),
          10000,
        );
        const cancel = () => finish(new DOMException("Page turn cancelled", "AbortError"));
        const finish = (error?: unknown) => {
          clearTimeout(timeout);
          signal?.removeEventListener("abort", cancel);
          if (error !== undefined) reject(error);
          else resolve();
        };
        signal?.addEventListener("abort", cancel, { once: true });
        if (signal?.aborted) cancel();
        else void ready.then(() => finish(), finish);
      });
      if (this.disposed) throw new DOMException("Page turn cancelled", "AbortError");
      void scene.offsetHeight;
      this.paint(0);
      frame.dataset.preparationMs = String(performance.now() - started);
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  }

  private hinge = 0;
  private destinationHinge = 0;

  private copyPage(page: LeafPage, doc: Document, width: number, height: number): HTMLElement {
    const restore = page.capture?.();
    try {
      return this.copyCapturedPage(page, doc, width, height);
    } finally {
      restore?.();
    }
  }

  private copyCapturedPage(
    page: LeafPage,
    doc: Document,
    width: number,
    height: number,
  ): HTMLElement {
    const wrapper = doc.createElement("div");
    Object.assign(wrapper.style, {
      position: "absolute",
      top: "0",
      width: `${width}px`,
      height: `${height}px`,
      overflow: "hidden",
      background: this.background,
    });
    const frames =
      page.element instanceof HTMLIFrameElement
        ? [page.element]
        : Array.from(page.element.querySelectorAll("iframe"));
    const pageBounds = page.element.getBoundingClientRect();
    const leafBounds = this.surface.element.getBoundingClientRect();
    const containerBounds = this.container.getBoundingClientRect();
    for (const frame of frames) {
      const source = frame.contentDocument;
      if (!source?.documentElement || !source.defaultView)
        throw new Error("Cannot copy unavailable page content.");
      const bounds = frame.getBoundingClientRect();
      const frameStyle = frame.ownerDocument.defaultView!.getComputedStyle(frame);
      const viewportWidth = Number.parseFloat(frameStyle.width);
      const viewportHeight = Number.parseFloat(frameStyle.height);
      if (!(viewportWidth > 0) || !(viewportHeight > 0))
        throw new Error("Cannot copy page with unavailable viewport geometry.");
      const scaleX = bounds.width / viewportWidth;
      const scaleY = bounds.height / viewportHeight;
      const pixelRatio = frame.ownerDocument.defaultView!.devicePixelRatio;
      const unscaled = scaleX === 1 && scaleY === 1;
      const left = unscaled
        ? Math.round(bounds.left * pixelRatio) / pixelRatio -
          Math.round(leafBounds.left * pixelRatio) / pixelRatio + containerBounds.left
        : bounds.left;
      const top = unscaled
        ? Math.round(bounds.top * pixelRatio) / pixelRatio -
          Math.round(leafBounds.top * pixelRatio) / pixelRatio + containerBounds.top
        : bounds.top;
      const copy = this.copyPaint(source.documentElement, doc, {
        top: 0,
        bottom: viewportHeight,
        left: 0,
        right: viewportWidth,
      });
      if (!(copy instanceof doc.defaultView!.HTMLElement))
        throw new Error("Cannot copy page root.");
      const viewport = doc.createElement("div");
      viewport.dataset.pageCopy = "";
      Object.assign(viewport.style, {
        position: "absolute",
        // Nested iframes rasterize on their own device-pixel grid.
        left: `${left - pageBounds.left}px`,
        top: `${top - pageBounds.top}px`,
        width: `${viewportWidth}px`,
        height: `${viewportHeight}px`,
        overflow: "hidden",
        clipPath: frameStyle.clipPath,
        transformOrigin: "top left",
        transform: `scale(${scaleX}, ${scaleY})`,
      });
      for (const sheet of source.styleSheets) {
        const style = doc.createElement("style");
        style.textContent = Array.from(sheet.cssRules)
          .filter((rule) => rule.type === CSSRule.FONT_FACE_RULE)
          .map((rule) => rule.cssText)
          .join("\n");
        doc.head.append(style);
      }
      viewport.replaceChildren(copy);
      wrapper.append(viewport);
    }
    if (page.furniture) {
      const furniture = this.copyPaint(page.furniture, doc, undefined, undefined, true);
      if (furniture instanceof doc.defaultView!.HTMLElement) {
        for (const property of [
          "inset-inline-start",
          "inset-inline-end",
          "inset-block-start",
          "inset-block-end",
        ])
          furniture.style.removeProperty(property);
        furniture.style.setProperty("left", "0", "important");
        furniture.style.setProperty("top", "0", "important");
        furniture.style.setProperty("right", "auto", "important");
        furniture.style.setProperty("bottom", "auto", "important");
        furniture.style.setProperty("z-index", "1", "important");
        furniture.style.setProperty("opacity", "1", "important");
        wrapper.append(furniture);
      }
    }
    return wrapper;
  }

  private copyPaint(
    source: Node,
    doc: Document,
    viewport?: { top: number; bottom: number; left: number; right: number },
    previous?: Node | null,
    mutableFurniture = false,
  ): Node {
    if (source.nodeType !== 1) return doc.importNode(source, false);
    const element = source as Element;
    if (
      ["script", "style", "link", "meta", "iframe", "object", "embed"].includes(element.localName)
    )
      return doc.createTextNode("");
    const computed = element.ownerDocument.defaultView!.getComputedStyle(element);
    if (
      viewport &&
      element.namespaceURI === XHTML &&
      element.localName !== "html" &&
      element.localName !== "body" &&
      (computed.display === "block" || computed.display === "list-item") &&
      computed.position === "static" &&
      computed.transform === "none" &&
      computed.float === "none" &&
      computed.clear === "none"
    ) {
      const bounds = element.getBoundingClientRect();
      if (bounds.height > 0 && (bounds.bottom <= viewport.top || bounds.top >= viewport.bottom)) {
        const before = previous && this.spacers.get(previous);
        if (computed.display === "block" && before && bounds.top >= before.bottom &&
            previous instanceof doc.defaultView!.HTMLElement) {
          Object.assign(previous.style, {
            boxSizing: "border-box",
            height: `${bounds.bottom - before.top}px`,
            padding: "0",
            border: "0",
            marginBottom: computed.marginBottom,
          });
          this.spacers.set(previous, {
            ...before, bottom: bounds.bottom, marginBottom: computed.marginBottom,
          });
          return previous;
        }
        // Preserve flow and collapsed margins without duplicating off-page ink.
        const spacer = doc.createElement("div");
        for (const property of [
          "display",
          "box-sizing",
          "width",
          "height",
          "min-width",
          "min-height",
          "max-width",
          "max-height",
          "margin-top",
          "margin-right",
          "margin-bottom",
          "margin-left",
          "padding-top",
          "padding-right",
          "padding-bottom",
          "padding-left",
          "border-top-width",
          "border-right-width",
          "border-bottom-width",
          "border-left-width",
          "border-style",
          "float",
          "clear",
          "order",
          "flex",
        ])
          spacer.style.setProperty(property, computed.getPropertyValue(property));
        spacer.style.visibility = "hidden";
        spacer.dataset.offPageSpacer = "";
        if (computed.display === "block")
          this.spacers.set(spacer, {
            top: bounds.top,
            bottom: bounds.bottom,
            marginBottom: computed.marginBottom,
          });
        return spacer;
      }
    }
    const copy = doc.importNode(element, false) as Element & { style?: CSSStyleDeclaration };
    if (copy.style) {
      const initial = this.getInitialPaintStyles(doc);
      const declarations = new Map([["all", "initial"]]);
      for (let index = 0, length = computed.length; index < length; index++) {
        const property = computed[index]!;
        // Owned furniture uses resolved paint values, not authored variable references.
        if (mutableFurniture && property.startsWith("--")) continue;
        const value = computed.getPropertyValue(property);
        // `all` resets inherited values too, except direction, bidi and custom properties.
        if (property === "direction" || property === "unicode-bidi" ||
            value !== initial.get(property)) {
          declarations.set(property, value);
        }
      }
      if (typeof element.computedStyleMap === "function") {
        // Typed values retain unitless leading, intrinsic sizing and exact translations.
        const values = element.computedStyleMap();
        const lineHeight = values.get("line-height");
        if (lineHeight) declarations.set("line-height", lineHeight.toString());
        const transform = values.get("transform");
        if (transform) declarations.set("transform", transform.toString());
        for (const property of ["width", "height", "inline-size", "block-size"]) {
          if (values.get(property)?.toString() === "auto")
            declarations.set(property, "auto");
        }
      }
      declarations.set("animation", "none");
      declarations.set("transition", "none");
      const inline = new Map<string, string>();
      if (mutableFurniture) {
        for (const property of MUTABLE_FURNITURE_PAINT) {
          const value = declarations.get(property);
          if (value !== undefined) {
            inline.set(property, value);
            declarations.delete(property);
          }
        }
      }
      const sharedPaint = serializePaint(declarations);
      let paintClass = this.paintClasses.get(sharedPaint);
      if (!paintClass) {
        paintClass = String(this.paintClasses.size);
        this.paintClasses.set(sharedPaint, paintClass);
        this.paintRules.push(`[data-ambra-frozen-paint="${paintClass}"]{${sharedPaint}}`);
      }
      copy.removeAttribute("style");
      copy.setAttribute("data-ambra-frozen-paint", paintClass);
      if (mutableFurniture) {
        copy.setAttribute("data-ambra-frozen-furniture", "");
        copy.style.cssText = serializePaint(inline);
      }
    }
    for (const attribute of Array.from(copy.attributes)) {
      if (attribute.name.startsWith("on") || attribute.name === "autofocus")
        copy.removeAttribute(attribute.name);
    }
    const mergeSpacers =
      (computed.display === "block" || computed.display === "flow-root") &&
      computed.whiteSpace === "normal";
    for (let index = 0, length = element.childNodes.length; index < length; index++) {
      const child = element.childNodes[index]!;
      if (
        mergeSpacers &&
        copy.lastChild &&
        this.spacers.has(copy.lastChild) &&
        child.nodeType === Node.TEXT_NODE &&
        !child.textContent?.trim()
      )
        continue;
      const painted = this.copyPaint(
        child, doc, viewport, mergeSpacers ? copy.lastChild : undefined, mutableFurniture,
      );
      if (painted !== copy.lastChild) copy.appendChild(painted);
    }
    return copy;
  }

  private getInitialPaintStyles(doc: Document): ReadonlyMap<string, string> {
    const cached = this.initialPaintStyles.get(doc);
    if (cached) return cached;
    const probe = doc.createElement("span");
    probe.style.setProperty("all", "initial", "important");
    doc.body.append(probe);
    try {
      const computed = doc.defaultView!.getComputedStyle(probe);
      const initial = new Map<string, string>();
      for (let index = 0, length = computed.length; index < length; index++) {
        const property = computed[index]!;
        initial.set(property, computed.getPropertyValue(property));
      }
      this.initialPaintStyles.set(doc, initial);
      return initial;
    } finally {
      probe.remove();
    }
  }

  private splitFurnitureInk(doc: Document, ink: readonly FurnitureInk[], width: number): void {
    const layout = ink.flatMap(({ element, furniture }) => {
      const parent = element.parentElement;
      if (!parent) throw new Error("Curled furniture has no face.");
      const offset = Number.parseFloat(element.style.left);
      return Array.from(furniture.children)
        .filter((band): band is HTMLElement => band instanceof doc.defaultView!.HTMLElement)
        .map(band => {
          const style = doc.defaultView!.getComputedStyle(band);
          const left = offset + Number.parseFloat(style.left);
          const top = Number.parseFloat(style.top);
          const height = Number.parseFloat(style.height);
          if (![left, top, height].every(Number.isFinite) || height <= 0)
            throw new Error("Curled furniture band geometry is unavailable.");
          return { parent, band, left, top, height };
        });
    });
    for (const { parent, band, left, top, height } of layout) {
      const clip = doc.createElement("div");
      clip.dataset.ambraFrozenInkClip = "";
      clip.dataset.ambraTurnFurniture = "";
      Object.assign(clip.style, {
        position: "absolute", left: "0", top: `${top}px`, width: `${width}px`,
        height: `${height}px`, overflow: "hidden", zIndex: "2",
        backfaceVisibility: "hidden",
      });
      for (const property of [
        "inset-inline-start", "inset-inline-end", "inset-block-start", "inset-block-end",
      ]) band.style.removeProperty(property);
      band.style.setProperty("left", `${left}px`, "important");
      band.style.setProperty("top", "0", "important");
      band.style.setProperty("right", "auto", "important");
      band.style.setProperty("bottom", "auto", "important");
      clip.append(band);
      parent.insertBefore(clip, parent.lastChild);
    }
    for (const { element } of ink) element.remove();
  }

  public hide(...elements: HTMLElement[]): void {
    for (const element of elements) {
      if (!this.savedOpacity.has(element)) this.savedOpacity.set(element, element.style.opacity);
      element.style.opacity = "0";
    }
    this.surface.element.style.opacity = "1";
  }

  public paint(progress: number): void {
    if (this.disposed) return;
    const p = Math.max(0, Math.min(1, progress));
    this.flatFaces?.forEach((face, index) => {
      face.style.opacity = p === index ? "1" : "0";
    });
    const length = this.width / SEGMENTS;
    const hinge = this.hinge + (this.destinationHinge - this.hinge) * p * p * (3 - 2 * p);
    const wave = Math.sin(Math.PI * p);
    let x = 0;
    let z = 0;
    for (let index = 0; index < this.segments.length; index++) {
      const angle =
        -Math.PI * p + 0.65 * wave * ((2 * (index + 0.5)) / SEGMENTS - 1);
      const segment = this.segments[index]!;
      // Opaque endpoint snapshots cover interior strips; hide only outer overlaps.
      const outerStrip = index === 0 || index === this.segments.length - 1;
      segment.element.style.opacity = (p === 0 || p === 1) && outerStrip ? "0" : "1";
      const left = hinge + this.side * x - (this.side < 0 ? length : 0) - STRIP_OVERLAP;
      segment.element.style.transform = `translate3d(${left}px, 0, ${z}px) rotateY(${this.side * angle}rad)`;
      const opacity = String(wave * (0.04 + (0.1 * index) / SEGMENTS));
      for (const shade of segment.shades)
        shade.style.opacity = opacity;
      x += length * Math.cos(angle);
      z -= length * Math.sin(angle);
    }
    this.surface.element.dataset.progress = String(p);
  }

  public async settle(from: number, to: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted || this.disposed) return;
    const duration = Math.max(100, 540 * Math.abs(to - from));
    await new Promise<void>((resolve, reject) => {
      const start = performance.now();
      let frame = 0;
      const finish = () => {
        cancelAnimationFrame(frame);
        signal?.removeEventListener("abort", finish);
        resolve();
      };
      const tick = (now: number) => {
        if (this.disposed) return finish();
        const t = Math.min(1, (now - start) / duration);
        try {
          this.paint(from + (to - from) * t * t * (3 - 2 * t));
          if (t < 1) frame = requestAnimationFrame(tick);
          else frame = requestAnimationFrame(finish);
        } catch (error) {
          cancelAnimationFrame(frame);
          signal?.removeEventListener("abort", finish);
          reject(error);
        }
      };
      signal?.addEventListener("abort", finish, { once: true });
      frame = requestAnimationFrame(tick);
    });
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [element, opacity] of this.savedOpacity) element.style.opacity = opacity;
    this.savedOpacity.clear();
    const document = this.surface.element.contentDocument;
    this.surface.dispose();
    // A retained callback must not keep the display copy's document graph alive.
    document?.documentElement?.replaceChildren();
    if (document) this.initialPaintStyles.delete(document);
    this.flatFaces = undefined;
    this.segments.length = 0;
    this.paintClasses.clear();
    this.paintRules.length = 0;
  }
}
