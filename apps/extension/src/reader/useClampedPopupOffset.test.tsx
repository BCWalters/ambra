import { act, useLayoutEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useClampedPopupOffset } from "./useClampedPopupOffset.js";

describe("useClampedPopupOffset element resizing", () => {
  let root: Root;
  let container: HTMLDivElement;
  let notifyResize: () => void;
  let height: number;
  const disconnect = vi.fn();
  const observe = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          notifyResize = callback;
        }
        observe = observe;
        disconnect = disconnect;
      },
    );
    observe.mockClear();
    disconnect.mockClear();
    height = 100;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function Popup() {
    const ref = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
      Object.defineProperties(ref.current!, {
        offsetWidth: { configurable: true, get: () => 200 },
        offsetHeight: { configurable: true, get: () => height },
      });
    }, []);
    const offset = useClampedPopupOffset(ref, { left: 120, top: 200 }, 10, []);
    return <div ref={ref} data-offset={`${offset.x},${offset.y}`} />;
  }

  it("reclamps a resized editor without a window resize and releases its observer on close", () => {
    act(() => root.render(<Popup />));
    const popup = container.firstElementChild!;
    expect(popup.getAttribute("data-offset")).toBe("0,0");
    expect(observe).toHaveBeenCalledWith(popup);
    height = 300;
    act(() => notifyResize());
    expect(popup.getAttribute("data-offset")).toBe("0,118");
    height = 100;
    act(() => notifyResize());
    expect(popup.getAttribute("data-offset")).toBe("0,0");
    act(() => root.render(null));
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
