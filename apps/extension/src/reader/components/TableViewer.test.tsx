import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TableViewer } from "./TableViewer.js";
import type { PreparedTable } from "../TableViewerContent.js";

const surfaces = vi.hoisted(() => ({ list: [] as Array<{ element: HTMLIFrameElement; dispose: ReturnType<typeof vi.fn> }>,
  fail: false }));
vi.mock("@ambra/engine", () => ({
  SandboxedContentHost: class {
    element = document.createElement("iframe");
    dispose = vi.fn(() => this.element.remove());
    constructor() {
      this.element.setAttribute("sandbox", "allow-same-origin");
      surfaces.list.push(this);
    }
    async render() {
      if (surfaces.fail) throw new Error("load failed");
      this.element.contentDocument!.body.innerHTML = "<table><tbody><tr><td>Cell</td></tr></tbody></table>";
    }
  },
}));
vi.mock("../../i18n/LocaleContext.js", () => ({
  useTranslation: () => (key: string) => ({
    "highlight.close": "Close", "imageViewer.zoomIn": "Zoom in", "imageViewer.zoomOut": "Zoom out",
    "tableViewer.actualSize": "Actual size", "tableViewer.dialogAriaLabel": "Table viewer",
  })[key] ?? key,
}));

describe("TableViewer", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onRequestClose = vi.fn();
  const onError = vi.fn();
  const table: PreparedTable = { xhtml: "<html/>", caption: "Results", unavailableResources: false };

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    surfaces.list = [];
    surfaces.fail = false;
    onRequestClose.mockClear();
    onError.mockClear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  const button = (name: string) => Array.from(container.querySelectorAll("button"))
    .find(element => element.getAttribute("aria-label") === name || element.textContent === name)!;
  const render = async (value: PreparedTable | undefined = table) => {
    await act(async () => { root.render(<TableViewer table={value} onRequestClose={onRequestClose} onError={onError} />); });
  };
  const key = (target: EventTarget, value: string, options: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true, ...options });
    act(() => { target.dispatchEvent(event); });
    return event;
  };

  it("isolates semantic content, starts at actual size, clamps zoom and resets on reopen", async () => {
    await render();
    expect(container.querySelector("[role='dialog']")?.getAttribute("aria-label")).toBe("Table viewer");
    expect(document.activeElement).toBe(button("Close"));
    const frame = surfaces.list[0]!.element;
    expect(frame.getAttribute("sandbox")).toBe("allow-same-origin");
    expect(container.querySelector("table")).toBeNull();
    expect(frame.contentDocument!.body.style.zoom).toBe("1");
    act(() => button("Zoom in").click());
    expect(frame.contentDocument!.body.style.zoom).toBe("1.25");
    expect(frame.contentDocument!.body.style.fontSize).toBe("");
    for (let index = 0; index < 20; index++) key(frame.contentDocument!, "+");
    expect(container.querySelector("output")?.textContent).toBe("400%");
    expect(button("Zoom in").disabled).toBe(true);
    for (let index = 0; index < 20; index++) key(frame.contentDocument!, "-");
    expect(container.querySelector("output")?.textContent).toBe("25%");
    expect(button("Zoom out").disabled).toBe(true);
    act(() => button("Actual size").click());
    expect(container.querySelector("output")?.textContent).toBe("100%");
    act(() => button("Zoom in").click());
    await act(async () => root.render(<TableViewer table={undefined} onRequestClose={onRequestClose} onError={onError} />));
    expect(surfaces.list[0]!.dispose).toHaveBeenCalledOnce();
    await render();
    expect(container.querySelector("output")?.textContent).toBe("100%");
  });

  it("handles Escape and Tab across iframe boundaries without stealing native browser zoom", async () => {
    await render();
    const doc = surfaces.list[0]!.element.contentDocument!;
    expect(key(doc, "+", { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(key(doc, "-", { metaKey: true }).defaultPrevented).toBe(false);
    expect(container.querySelector("output")?.textContent).toBe("100%");
    key(button("Close"), "Tab", { shiftKey: true });
    expect(document.activeElement).toBe(surfaces.list[0]!.element);
    key(doc, "Tab");
    expect(document.activeElement).toBe(button("Close"));
    key(doc, "Tab", { shiftKey: true });
    expect(document.activeElement).toBe(button("Actual size"));
    key(doc, "Tab");
    expect(document.activeElement).toBe(button("Close"));
    key(button("Close"), "Tab");
    expect(document.activeElement).toBe(button("Zoom out"));
    expect(key(doc, "Escape").defaultPrevented).toBe(true);
    expect(onRequestClose).toHaveBeenCalledOnce();
    key(document, "Escape");
    expect(onRequestClose).toHaveBeenCalledTimes(2);
  });

  it("uses an image-style translucent backdrop and dismisses only outside the table and controls", async () => {
    await render();
    const dialog = container.querySelector<HTMLElement>("[role='dialog']")!;
    expect(dialog.style.background).toBe("rgba(10, 8, 6, 0.82)");
    const surface = container.querySelector<HTMLElement>("[data-ambra-table-surface]")!;
    expect(surface.style.maxWidth).toBe("90%");
    act(() => surface.click());
    act(() => button("Zoom in").click());
    expect(onRequestClose).not.toHaveBeenCalled();
    act(() => dialog.click());
    expect(onRequestClose).toHaveBeenCalledOnce();
  });

  it("adds classic scrollbar width without moving the table off center in either direction", async () => {
    await render();
    const doc = surfaces.list[0]!.element.contentDocument!;
    const dialog = container.querySelector<HTMLElement>("[role='dialog']")!;
    const surface = container.querySelector<HTMLElement>("[data-ambra-table-surface]")!;
    Object.defineProperty(doc.defaultView!, "innerWidth", { configurable: true, value: 573 });
    vi.spyOn(doc.documentElement, "clientWidth", "get").mockReturnValue(558);
    vi.spyOn(dialog, "clientWidth", "get").mockReturnValue(760);
    vi.spyOn(doc.querySelector("table")!, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 558, 1000));
    act(() => button("Zoom in").click());
    expect(surface.style.width).toBe("573px");
    expect(surface.style.transform).toBe("translateX(7.5px)");
    doc.documentElement.style.direction = "rtl";
    act(() => button("Actual size").click());
    expect(surface.style.width).toBe("573px");
    expect(surface.style.transform).toBe("translateX(-7.5px)");
  });

  it("reports failed content loads and disposes the surface", async () => {
    surfaces.fail = true;
    await render();
    expect(container.querySelector("[role='alert']")).not.toBeNull();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "load failed" }));
  });

  it("isolates background focus and restores its prior accessibility state on close", async () => {
    const outside = document.createElement("button");
    outside.inert = false;
    outside.setAttribute("aria-hidden", "false");
    document.body.append(outside);
    await render();
    expect(outside.inert).toBe(true);
    expect(outside.getAttribute("aria-hidden")).toBe("true");
    outside.focus();
    expect(document.activeElement).toBe(button("Close"));
    await act(async () => root.render(<TableViewer table={undefined} onRequestClose={onRequestClose} onError={onError} />));
    expect(outside.inert).toBe(false);
    expect(outside.getAttribute("aria-hidden")).toBe("false");
    outside.remove();
  });

  it("keeps native disclosures operable while preventing link and form navigation", async () => {
    await render();
    const doc = surfaces.list[0]!.element.contentDocument!;
    doc.body.innerHTML = "<details><summary>More</summary>Details</details><a href='#elsewhere'>Link</a><form></form>";
    const summary = doc.querySelector("summary")!;
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    summary.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false);
    const linkClick = new MouseEvent("click", { bubbles: true, cancelable: true });
    doc.querySelector("a")!.dispatchEvent(linkClick);
    expect(linkClick.defaultPrevented).toBe(true);
    const submit = new Event("submit", { bubbles: true, cancelable: true });
    doc.querySelector("form")!.dispatchEvent(submit);
    expect(submit.defaultPrevented).toBe(true);
    vi.spyOn(summary, "getClientRects").mockReturnValue([new DOMRect(0, 0, 100, 20)] as unknown as DOMRectList);
    key(doc, "Tab");
    expect(doc.activeElement).toBe(summary);
    key(summary, "Tab");
    expect(document.activeElement).toBe(button("Close"));
  });
});
