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

const SEGMENTS = 20;
const STRIP_OVERLAP = 1.5;
const XHTML = "http://www.w3.org/1999/xhtml";

/** Display-only copies stay inside a script-disabled publication sandbox. */
export class CurledPageTurn {
  private readonly surface: SandboxedContentHost;
  private readonly segments: Segment[] = [];
  private readonly savedOpacity = new Map<HTMLElement, string>();
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
    this.container.append(frame);
    const abort = () => this.dispose();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      if (signal?.aborted) throw new DOMException("Page turn cancelled", "AbortError");
      await this.surface.render(
        `<html xmlns="${XHTML}"><head><title>Turning page</title></head><body style="margin:0;background:transparent"/></html>`,
      );
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
      for (let index = 0; index < SEGMENTS; index++) {
        const strip = doc.createElement("div");
        Object.assign(strip.style, {
          position: "absolute",
          top: `${bounds.top - containerBounds.top}px`,
          width: `${stripWidth}px`,
          height: `${bounds.height}px`,
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
            backfaceVisibility: "hidden",
            background: this.background,
            transform: faceIndex === 1 ? "rotateY(180deg)" : "",
          });
          const content = template.cloneNode(true) as HTMLElement;
          content.style.left = `${-(faceIndex === 0 ? frontOffset : bounds.width - frontOffset - stripWidth)}px`;
          content.style.zIndex = "0";
          face.append(content);
          const furniture = content.querySelector<HTMLElement>("[data-ambra-turn-furniture]");
          if (furniture) {
            const ink = doc.createElement("div");
            ink.style.cssText = content.style.cssText;
            ink.style.background = "transparent";
            ink.style.zIndex = "2";
            for (const band of furniture.children) {
              if (band instanceof doc.defaultView!.HTMLElement)
                band.style.setProperty("background", "transparent", "important");
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
          }
          const shade = doc.createElement("div");
          Object.assign(shade.style, {
            position: "absolute",
            inset: "0",
            background: "#322714",
            pointerEvents: "none",
            willChange: "opacity",
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
        copy.style.display = "none";
        scene.append(copy);
      }
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
    for (const frame of frames) {
      const source = frame.contentDocument;
      if (!source?.documentElement || !source.defaultView)
        throw new Error("Cannot copy unavailable page content.");
      const bounds = frame.getBoundingClientRect();
      const copy = this.copyPaint(source.documentElement, doc, {
        top: 0,
        bottom: frame.clientHeight,
        left: 0,
        right: frame.clientWidth,
      });
      if (!(copy instanceof doc.defaultView!.HTMLElement))
        throw new Error("Cannot copy page root.");
      const viewport = doc.createElement("div");
      viewport.dataset.pageCopy = "";
      Object.assign(viewport.style, {
        position: "absolute",
        left: `${bounds.left - pageBounds.left}px`,
        top: `${bounds.top - pageBounds.top}px`,
        width: `${frame.clientWidth}px`,
        height: `${frame.clientHeight}px`,
        overflow: "hidden",
        clipPath: frame.ownerDocument.defaultView!.getComputedStyle(frame).clipPath,
        transformOrigin: "top left",
        transform: `scale(${bounds.width / frame.clientWidth}, ${bounds.height / frame.clientHeight})`,
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
      const furniture = this.copyPaint(page.furniture, doc);
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
  ): Node {
    if (source.nodeType !== 1) return doc.importNode(source, false);
    const element = source as Element;
    if (
      ["script", "style", "link", "meta", "iframe", "object", "embed"].includes(element.localName)
    )
      return doc.createTextNode("");
    const copy = doc.importNode(element, false) as Element & { style?: CSSStyleDeclaration };
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
    if (copy.style) {
      for (const property of computed)
        copy.style.setProperty(property, computed.getPropertyValue(property), "important");
      if (typeof element.computedStyleMap === "function") {
        // Keep unitless line heights: resolved pixel values round each line differently.
        const lineHeight = element.computedStyleMap().get("line-height");
        if (lineHeight) copy.style.setProperty("line-height", lineHeight.toString(), "important");
      }
      copy.style.setProperty("animation", "none", "important");
      copy.style.setProperty("transition", "none", "important");
    }
    for (const attribute of Array.from(copy.attributes)) {
      if (attribute.name.startsWith("on") || attribute.name === "autofocus")
        copy.removeAttribute(attribute.name);
    }
    const mergeSpacers =
      (computed.display === "block" || computed.display === "flow-root") &&
      computed.whiteSpace === "normal";
    for (const child of element.childNodes) {
      if (
        mergeSpacers &&
        copy.lastChild &&
        this.spacers.has(copy.lastChild) &&
        child.nodeType === Node.TEXT_NODE &&
        !child.textContent?.trim()
      )
        continue;
      const painted = this.copyPaint(child, doc, viewport);
      const previous = copy.lastChild;
      const before = previous && this.spacers.get(previous);
      const after = this.spacers.get(painted);
      if (
        mergeSpacers &&
        before &&
        after &&
        after.top >= before.bottom &&
        previous instanceof doc.defaultView!.HTMLElement
      ) {
        Object.assign(previous.style, {
          boxSizing: "border-box",
          height: `${after.bottom - before.top}px`,
          padding: "0",
          border: "0",
          marginBottom: after.marginBottom,
        });
        this.spacers.set(previous, {
          ...before,
          bottom: after.bottom,
          marginBottom: after.marginBottom,
        });
      } else copy.appendChild(painted);
    }
    return copy;
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
      face.style.display = p === index ? "" : "none";
    });
    const length = this.width / SEGMENTS;
    const hinge = this.hinge + (this.destinationHinge - this.hinge) * p * p * (3 - 2 * p);
    let x = 0;
    let z = 0;
    for (let index = 0; index < this.segments.length; index++) {
      const angle =
        -Math.PI * p + 0.65 * Math.sin(Math.PI * p) * ((2 * (index + 0.5)) / SEGMENTS - 1);
      const segment = this.segments[index]!;
      segment.element.style.visibility = p === 0 || p === 1 ? "hidden" : "";
      segment.element.style.left = `${hinge + this.side * x - (this.side < 0 ? length : 0) - STRIP_OVERLAP}px`;
      segment.element.style.transform = `translateZ(${z}px) rotateY(${this.side * angle}rad)`;
      for (const shade of segment.shades)
        shade.style.opacity = String(Math.sin(Math.PI * p) * (0.04 + (0.1 * index) / SEGMENTS));
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
    this.surface.dispose();
    this.segments.length = 0;
  }
}
