import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImageViewer } from "./ImageViewer.js";
import type { ImageViewerProps } from "./ImageViewer.js";

vi.mock("../../i18n/LocaleContext.js", () => ({
  useTranslation: () => (key: string) =>
    ({
      "highlight.close": "Close",
      "imageViewer.dialogAriaLabel": "Image viewer",
      "imageViewer.zoomIn": "Zoom in",
      "imageViewer.zoomOut": "Zoom out",
      "imageViewer.fit": "Fit to window",
      "imageViewer.controls": "Image zoom",
      "imageViewer.instructions": "Scroll to zoom. Drag or use arrow keys to pan. Press 0 to fit.",
    })[key] ?? key,
}));

describe("ImageViewer", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onRequestClose = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    onRequestClose.mockClear();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function render(image: ImageViewerProps["image"] = { src: "image.png", alt: "Illustration" }) {
    act(() => root.render(<ImageViewer image={image} onRequestClose={onRequestClose} />));
  }

  function loadImage(width: number, height: number): HTMLImageElement {
    const image = container.querySelector("img")!;
    Object.defineProperties(image, {
      naturalWidth: { configurable: true, value: width },
      naturalHeight: { configurable: true, value: height },
    });
    act(() => image.dispatchEvent(new Event("load")));
    return image;
  }

  function button(name: string): HTMLButtonElement {
    return [...container.querySelectorAll("button")].find(
      (button) => button.getAttribute("aria-label") === name || button.textContent === name,
    )!;
  }

  function setGeometry() {
    const image = loadImage(120, 120);
    const canvas = image.parentElement!;
    Object.defineProperties(image, {
      clientWidth: { configurable: true, value: 810 },
      clientHeight: { configurable: true, value: 810 },
    });
    Object.defineProperties(canvas, {
      clientWidth: { configurable: true, value: 900 },
      clientHeight: { configurable: true, value: 810 },
    });
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 45,
      left: 0,
      top: 45,
      right: 900,
      bottom: 855,
      width: 900,
      height: 810,
      toJSON: () => ({}),
    });
    return { image, canvas };
  }

  function press(key: string, options: KeyboardEventInit = {}) {
    const event = new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      ...options,
    });
    act(() => button("Close").dispatchEvent(event));
    return event;
  }

  it.each([
    ["small square", 120, 120, "calc(100cqh * 1)"],
    ["small landscape", 240, 120, "calc(100cqh * 2)"],
    ["small portrait", 120, 240, "calc(100cqh * 0.5)"],
    ["large landscape", 4000, 2000, "calc(100cqh * 2)"],
    ["large portrait", 2000, 4000, "calc(100cqh * 0.5)"],
  ])(
    "fits a %s image to the canvas rather than capping at intrinsic size",
    (_, width, height, expectedWidth) => {
      render();
      const image = loadImage(width, height);
      expect(image.style.width).toBe(expectedWidth);
      expect(image.style.height).toBe("auto");
      expect(image.style.maxWidth).toBe("90%");
      expect(image.style.maxHeight).toBe("100%");
      expect(image.parentElement!.style.containerType).toBe("size");
    },
  );

  it("keeps the original size constraints until valid intrinsic dimensions are available", () => {
    render();
    const image = loadImage(0, 0);
    expect(image.style.width).toBe("");
    expect(image.style.maxWidth).toBe("90%");
    expect(image.style.maxHeight).toBe("100%");
  });

  it("does not reuse the previous image's aspect ratio for a different source", () => {
    render();
    loadImage(120, 240);
    render({ src: "landscape.png", alt: "Landscape" });
    expect(container.querySelector("img")!.style.width).toBe("");
    expect(loadImage(240, 120).style.width).toBe("calc(100cqh * 2)");
  });

  it("focuses Close on open and retains the accessible image description", () => {
    render();
    expect(document.activeElement).toBe(container.querySelector("button"));
    expect(container.querySelector('[role="dialog"]')!.getAttribute("aria-label")).toBe(
      "Illustration",
    );
    expect(container.querySelector("img")!.alt).toBe("Illustration");
  });

  it("does not dismiss image clicks, but dismisses backdrop and close-button clicks once", () => {
    render();
    act(() => container.querySelector("img")!.click());
    expect(onRequestClose).not.toHaveBeenCalled();
    act(() => container.querySelector<HTMLDivElement>('[role="dialog"]')!.click());
    expect(onRequestClose).toHaveBeenCalledTimes(1);
    onRequestClose.mockClear();
    act(() => container.querySelector("button")!.click());
    expect(onRequestClose).toHaveBeenCalledTimes(1);
  });

  it("dismisses on Escape only while open and supports reopening", () => {
    render();
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(onRequestClose).toHaveBeenCalledTimes(1);
    act(() => root.render(<ImageViewer image={undefined} onRequestClose={onRequestClose} />));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(onRequestClose).toHaveBeenCalledTimes(1);
    render({ src: "other.png", alt: "" });
    expect(container.querySelector('[role="dialog"]')!.getAttribute("aria-label")).toBe(
      "Image viewer",
    );
    expect(loadImage(100, 100).style.width).toBe("calc(100cqh * 1)");
  });

  it("zooms beyond the fitted size, enforces bounds and resets both scale and pan", () => {
    render();
    const { image } = setGeometry();
    expect(button("Zoom out").disabled).toBe(true);
    act(() => button("Zoom in").click());
    expect(image.style.transform).toBe("translate(0px, 0px) scale(1.25)");
    expect(container.querySelector("output")!.textContent).toBe("125%");
    expect(onRequestClose).not.toHaveBeenCalled();
    press("ArrowRight");
    expect(image.style.transform).toBe("translate(-40px, 0px) scale(1.25)");
    for (let i = 0; i < 20; i++) act(() => button("Zoom in").click());
    expect(button("Zoom in").disabled).toBe(true);
    expect(container.querySelector("output")!.textContent).toBe("800%");
    act(() => button("Fit to window").click());
    expect(image.style.transform).toBe("translate(0px, 0px) scale(1)");
    expect(button("Zoom out").disabled).toBe(true);
  });

  it("resets zoom and pan on source changes and when reopening the same source", () => {
    render();
    setGeometry();
    press("+");
    press("ArrowRight");
    render({ src: "other.png", alt: "Other" });
    expect(container.querySelector("img")!.style.transform).toBe("translate(0px, 0px) scale(1)");
    press("+");
    act(() => root.render(<ImageViewer image={undefined} onRequestClose={onRequestClose} />));
    render({ src: "other.png", alt: "Other" });
    expect(container.querySelector("img")!.style.transform).toBe("translate(0px, 0px) scale(1)");
  });

  it("contains image keyboard shortcuts, but does not intercept browser or global shortcuts", () => {
    render();
    const { image } = setGeometry();
    const globalKey = vi.fn();
    document.addEventListener("keydown", globalKey);
    try {
      expect(press("=").defaultPrevented).toBe(true);
      expect(press("ArrowDown").defaultPrevented).toBe(true);
      expect(image.style.transform).toBe("translate(0px, -40px) scale(1.25)");
      expect(globalKey).not.toHaveBeenCalled();
      expect(press("+", { ctrlKey: true }).defaultPrevented).toBe(false);
      expect(globalKey).toHaveBeenCalledTimes(1);
      press("0");
      expect(image.style.transform).toBe("translate(0px, 0px) scale(1)");
      act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "+" })));
      expect(image.style.transform).toBe("translate(0px, 0px) scale(1)");
      press("+");
      press("-");
      expect(image.style.transform).toBe("translate(0px, 0px) scale(1)");
    } finally {
      document.removeEventListener("keydown", globalKey);
    }
  });

  it.each([0, 1, 2])(
    "zooms wheel and trackpad pinch at the pointer (deltaMode %s)",
    (deltaMode) => {
      render();
      const { image, canvas } = setGeometry();
      const event = new WheelEvent("wheel", {
        deltaY: deltaMode === 0 ? -100 : deltaMode === 1 ? -6.25 : -100 / 810,
        deltaMode,
        clientX: 550,
        clientY: 450,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      // Happy DOM's WheelEvent extends UIEvent rather than MouseEvent.
      Object.defineProperties(event, {
        clientX: { value: 550 },
        clientY: { value: 450 },
      });
      act(() => canvas.dispatchEvent(event));
      expect(event.defaultPrevented).toBe(true);
      const scale = Math.exp(0.5);
      expect(image.style.transform).toBe(`translate(${100 - 100 * scale}px, 0px) scale(${scale})`);
      act(() => canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: 200, cancelable: true })));
      expect(image.style.transform).toBe("translate(0px, 0px) scale(1)");
    },
  );

  it("pans a captured pointer with bounds and releases the drag without dismissing", () => {
    render();
    const { image } = setGeometry();
    image.setPointerCapture = vi.fn();
    image.hasPointerCapture = vi.fn(() => true);
    image.releasePointerCapture = vi.fn();
    const pointer = (type: string, x: number, y: number) =>
      act(() =>
        image.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 1,
            button: 0,
            clientX: x,
            clientY: y,
            bubbles: true,
          }),
        ),
      );
    pointer("pointerdown", 450, 450);
    expect(image.setPointerCapture).not.toHaveBeenCalled();
    press("+");
    pointer("pointerdown", 450, 450);
    expect(image.setPointerCapture).toHaveBeenCalledWith(1);
    pointer("pointermove", 500, 475);
    expect(image.style.transform).toBe("translate(50px, 25px) scale(1.25)");
    pointer("pointermove", 2000, -2000);
    expect(image.style.transform).toBe("translate(101.25px, -101.25px) scale(1.25)");
    pointer("pointerup", 2000, -2000);
    expect(image.releasePointerCapture).toHaveBeenCalledWith(1);
    pointer("lostpointercapture", 2000, -2000);
    expect(image.style.cursor).toBe("grab");
    pointer("pointermove", 450, 450);
    expect(image.style.transform).toBe("translate(101.25px, -101.25px) scale(1.25)");
    expect(onRequestClose).not.toHaveBeenCalled();
  });

  it("reclamps pan after resizing and disconnects its observer when closed", () => {
    let resize: (() => void) | undefined;
    const disconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resize = callback;
        }
        observe = vi.fn();
        disconnect = disconnect;
      },
    );
    render();
    const { image, canvas } = setGeometry();
    press("+");
    press("ArrowRight");
    Object.defineProperty(canvas, "clientWidth", { configurable: true, value: 1800 });
    act(() => resize!());
    expect(image.style.transform).toBe("translate(0px, 0px) scale(1.25)");
    act(() => root.render(<ImageViewer image={undefined} onRequestClose={onRequestClose} />));
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
