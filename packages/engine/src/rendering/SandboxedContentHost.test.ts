// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RenderingSurfaceCancelledError,
  RenderingSurfaceError,
  SandboxedContentHost,
} from "./SandboxedContentHost.js";

beforeEach(() => {
  vi.useFakeTimers();
  let nextUrl = 0;
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:surface-${nextUrl++}`);
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("SandboxedContentHost lifetime", () => {
  it("loads content, cleans its listeners/timer, and revokes its URL once on disposal", async () => {
    const host = new SandboxedContentHost();
    document.createElement("div").append(host.element);
    const remove = vi.spyOn(host.element, "removeEventListener");
    const render = host.render("<html/>");
    host.element.dispatchEvent(new Event("load"));
    await render;

    expect(vi.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalledWith("load", expect.any(Function));
    expect(remove).toHaveBeenCalledWith("error", expect.any(Function));
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    host.dispose();
    host.dispose();
    expect(host.element.parentNode).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:surface-0");
  });

  it("rejects a replaced render instead of resolving both from the replacement's load event", async () => {
    const host = new SandboxedContentHost();
    const first = host.render("<html>first</html>");
    const cancelled = expect(first).rejects.toBeInstanceOf(RenderingSurfaceCancelledError);
    const second = host.render("<html>second</html>");
    await cancelled;
    expect(vi.getTimerCount()).toBe(1);

    host.element.dispatchEvent(new Event("load"));
    await second;
    expect(vi.getTimerCount()).toBe(0);
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:surface-0");
    host.dispose();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
    expect(URL.revokeObjectURL).toHaveBeenLastCalledWith("blob:surface-1");
  });

  it("settles a pending render on disposal and rejects rendering after disposal", async () => {
    const host = new SandboxedContentHost();
    const render = host.render("<html/>");
    const cancelled = expect(render).rejects.toBeInstanceOf(RenderingSurfaceCancelledError);
    host.dispose();
    await cancelled;
    expect(vi.getTimerCount()).toBe(0);

    host.element.dispatchEvent(new Event("load"));
    host.element.dispatchEvent(new Event("error"));
    await expect(host.render("<html/>")).rejects.toBeInstanceOf(RenderingSurfaceCancelledError);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:surface-0");
  });

  it.each(["error", "timeout"] as const)("propagates %s failures and allows a later render", async (failure) => {
    const host = new SandboxedContentHost();
    const first = host.render("<html/>");
    const failed = expect(first).rejects.toBeInstanceOf(RenderingSurfaceError);
    if (failure === "error") {
      host.element.dispatchEvent(new Event("error"));
    } else {
      vi.advanceTimersByTime(10_000);
    }
    await failed;
    expect(vi.getTimerCount()).toBe(0);

    const second = host.render("<html/>");
    host.element.dispatchEvent(new Event("load"));
    await second;
    host.dispose();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it("releases every URL when a replacement is disposed before it loads", async () => {
    const host = new SandboxedContentHost();
    const first = host.render("<html/>");
    const firstResult = expect(first).rejects.toBeInstanceOf(RenderingSurfaceCancelledError);
    const second = host.render("<html/>");
    const secondResult = expect(second).rejects.toBeInstanceOf(RenderingSurfaceCancelledError);
    host.dispose();
    await Promise.all([firstResult, secondResult]);

    expect(vi.getTimerCount()).toBe(0);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:surface-0");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:surface-1");
  });
});
