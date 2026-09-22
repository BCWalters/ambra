import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImageViewer } from "./ImageViewer.js";
import type { ImageViewerProps } from "./ImageViewer.js";

vi.mock("../../i18n/LocaleContext.js", () => ({
  useTranslation: () => (key: string) => (key === "highlight.close" ? "Close" : "Image viewer"),
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

  it.each([
    ["small square", 120, 120, "90vh"],
    ["small landscape", 240, 120, "180vh"],
    ["small portrait", 120, 240, "45vh"],
    ["large landscape", 4000, 2000, "180vh"],
    ["large portrait", 2000, 4000, "45vh"],
  ])(
    "fits a %s image to the viewport rather than capping at intrinsic size",
    (_, width, height, expectedWidth) => {
      render();
      const image = loadImage(width, height);
      expect(image.style.width).toBe(expectedWidth);
      expect(image.style.height).toBe("auto");
      expect(image.style.maxWidth).toBe("90vw");
      expect(image.style.maxHeight).toBe("90vh");
    },
  );

  it("keeps the original size constraints until valid intrinsic dimensions are available", () => {
    render();
    const image = loadImage(0, 0);
    expect(image.style.width).toBe("");
    expect(image.style.maxWidth).toBe("90vw");
    expect(image.style.maxHeight).toBe("90vh");
  });

  it("does not reuse the previous image's aspect ratio for a different source", () => {
    render();
    loadImage(120, 240);
    render({ src: "landscape.png", alt: "Landscape" });
    expect(container.querySelector("img")!.style.width).toBe("");
    expect(loadImage(240, 120).style.width).toBe("180vh");
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
    expect(loadImage(100, 100).style.width).toBe("90vh");
  });
});
