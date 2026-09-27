import { afterEach, describe, expect, it, vi } from "vitest";
import { CfiStep, isReaderOwnedContent, LocatorResolver, Page } from "@ambra/engine";
import { attachTableControls, updateTableControlLabels } from "./TableControls.js";

const originalPopover = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "showPopover");
afterEach(() => {
  document.body.innerHTML = ""; vi.restoreAllMocks(); vi.unstubAllGlobals();
  if (originalPopover) Object.defineProperty(HTMLElement.prototype, "showPopover", originalPopover);
  else Reflect.deleteProperty(HTMLElement.prototype, "showPopover");
});

describe("table controls", () => {
  it("adds one ignored control per outer table without mutating tables or their ancestors", () => {
    document.body.innerHTML = "<section><table><tbody><tr><td>Outer<table><tbody><tr><td>Nested</td></tr></tbody></table></td></tr></tbody></table></section>";
    const section = document.querySelector("section")!;
    const original = section.outerHTML;
    const locator = Object.assign(Object.create(LocatorResolver.prototype), {
      pkg: { spine: [{ packageCfiSteps: [new CfiStep(6), new CfiStep(2)] }] },
    });
    const originalCfi = locator.generate(0, document.querySelector("td")!).cfi;
    const open = vi.fn();
    const cleanup = attachTableControls(document, "Expand table", open);
    const host = document.querySelector<HTMLElement>("[data-ambra-table-controls]")!;
    expect(isReaderOwnedContent(host)).toBe(true);
    const buttons = host.shadowRoot!.querySelectorAll("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.getAttribute("aria-label")).toBe("Expand table");
    buttons[0]!.click();
    expect(open).toHaveBeenCalledWith(document.querySelector("table"), buttons[0]);
    expect(section.outerHTML).toBe(original);
    expect(locator.generate(0, document.querySelector("td")!).cfi).toBe(originalCfi);
    updateTableControlLabels(document, "Agrandir le tableau");
    expect(buttons[0]!.getAttribute("aria-label")).toBe("Agrandir le tableau");
    cleanup();
    expect(host.isConnected).toBe(false);
    expect(section.outerHTML).toBe(original);
  });

  it("does not let pointer or keyboard activation reach reader gestures", () => {
    document.body.innerHTML = "<table><tbody><tr><td>Data</td></tr></tbody></table>";
    const cleanup = attachTableControls(document, "Expand table", vi.fn());
    const button = document.querySelector<HTMLElement>("[data-ambra-table-controls]")!.shadowRoot!.querySelector("button")!;
    const spy = vi.fn();
    document.addEventListener("keydown", spy);
    const event = new KeyboardEvent("keydown", { key: " ", bubbles: true, composed: true, cancelable: true });
    button.dispatchEvent(event);
    expect(spy).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    document.removeEventListener("keydown", spy);
    cleanup();
  });

  it("does not offer a phantom clickable control for a table below the current page clip", async () => {
    document.body.innerHTML = "<h2>Heading</h2><table><tbody><tr><td>Next page</td></tr></tbody></table>";
    const table = document.querySelector("table")!;
    vi.spyOn(table, "getBoundingClientRect").mockReturnValue(new DOMRect(100, 146, 558, 1200));
    vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(760);
    vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(900);
    vi.stubGlobal("DOMMatrixReadOnly", class { m42 = -12; });
    const show = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "showPopover", { configurable: true, value: show });
    let page = new Page(0, { node: document.body }, { node: table }, 100, 137);
    const cleanup = attachTableControls(document, "Expand table", vi.fn(), () => page);
    expect(show).not.toHaveBeenCalled();
    page = new Page(1, { node: table }, { node: document.body }, 158, 1358);
    document.dispatchEvent(new Event("scroll"));
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    expect(show).toHaveBeenCalled();
    const button = document.querySelector<HTMLElement>("[data-ambra-table-controls]")!.shadowRoot!.querySelector("button")!;
    expect(button.style.top).toBe("146px");
    expect(button.style.left).toBe("72px");
    table.style.direction = "rtl";
    document.dispatchEvent(new Event("scroll"));
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    expect(button.style.left).toBe("658px");
    cleanup();
  });
});
