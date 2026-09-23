import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GoToDialog } from "./GoToDialog.js";

vi.mock("@fluentui/react-components", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@fluentui/react-components")>();
  return {
    ...actual,
    Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div>{children}</div> : null,
    DialogSurface: ({ children, onKeyDown }: React.HTMLAttributes<HTMLDivElement>) => <div onKeyDown={onKeyDown}>{children}</div>,
  };
});

describe("GoToDialog input", () => {
  let root: Root;
  let container: HTMLDivElement;
  const onGo = vi.fn();
  const onOpenChange = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    onGo.mockClear();
    onOpenChange.mockClear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function render(mode: "page" | "percentage" = "page", bookPageCount: number | undefined = 200) {
    act(() => root.render(<GoToDialog mode={mode} open bookPageCount={bookPageCount} onGo={onGo} onOpenChange={onOpenChange} />));
  }

  function enter(value: string) {
    const input = container.querySelector("input")!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    return input;
  }

  it.each(["1e2", "2e-1", "9.9", "0", "-1", "201", "9007199254740993", ""])("rejects %j instead of navigating to a numeric prefix", (value) => {
    render();
    const input = enter(value);
    const go = container.querySelectorAll("button")[1]!;
    expect(go.disabled).toBe(true);
    act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(onGo).not.toHaveBeenCalled();
  });

  it.each([
    ["page", "1", 1 / 200],
    ["page", "200", 1],
    ["percentage", "25", 0.25],
    ["percentage", "100", 1],
  ] as const)("submits %s %s using its full value", (mode, value, fraction) => {
    render(mode);
    enter(value);
    const go = container.querySelectorAll("button")[1]!;
    expect(go.disabled).toBe(false);
    act(() => go.click());
    expect(onGo).toHaveBeenCalledWith(fraction);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("does not offer Go while the page count is unknown", () => {
    act(() => root.render(<GoToDialog mode="page" open bookPageCount={undefined} onGo={onGo} onOpenChange={onOpenChange} />));
    expect(container.querySelector("input")!.disabled).toBe(true);
    expect(container.querySelectorAll("button")[1]!.disabled).toBe(true);
  });

  it("does not propagate Escape to the parent flyout", () => {
    render();
    const parentEscape = vi.fn();
    document.addEventListener("keydown", parentEscape);
    try {
      act(() => container.querySelector("input")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
      expect(parentEscape).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", parentEscape);
    }
  });
});
