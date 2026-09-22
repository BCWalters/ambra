// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { DisclosureState } from "./DisclosureState.js";

function content(open = false): Document {
  const doc = document.implementation.createHTMLDocument();
  doc.body.innerHTML = `<details${open ? " open" : ""}><summary>Heading</summary><p>Text</p></details>`;
  return doc;
}

function toggle(doc: Document, open: boolean): void {
  const detail = doc.querySelector("details")!;
  detail.open = open;
  detail.dispatchEvent(new Event("toggle"));
}

describe("DisclosureState", () => {
  it("synchronizes copies and restores the latest state before new hosts measure", () => {
    const changed = vi.fn();
    const state = new DisclosureState(changed);
    const first = content();
    const companion = content();
    const detach = state.attach(0, first);
    state.attach(0, companion);
    toggle(first, true);
    expect(companion.querySelector("details")!.open).toBe(true);
    expect(changed).toHaveBeenCalledExactlyOnceWith(0, first);
    companion.querySelector("details")!.dispatchEvent(new Event("toggle"));
    expect(changed).toHaveBeenCalledTimes(1);
    detach();
    const nextPage = content();
    state.attach(0, nextPage);
    expect(nextPage.querySelector("details")!.open).toBe(true);
    toggle(nextPage, false);
    expect(companion.querySelector("details")!.open).toBe(false);
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it("preserves authored-open defaults and keeps spine items independent", () => {
    const state = new DisclosureState();
    const open = content(true);
    const closed = content();
    state.attach(0, open);
    state.attach(1, closed);
    expect(open.querySelector("details")!.open).toBe(true);
    expect(closed.querySelector("details")!.open).toBe(false);
    toggle(open, false);
    const reopened = content(true);
    state.attach(0, reopened);
    expect(reopened.querySelector("details")!.open).toBe(false);
  });

  it("detaches obsolete documents so they cannot overwrite current state", () => {
    const changed = vi.fn();
    const state = new DisclosureState(changed);
    const old = content();
    const detach = state.attach(0, old);
    detach();
    toggle(old, true);
    const current = content();
    state.attach(0, current);
    expect(current.querySelector("details")!.open).toBe(false);
    expect(changed).not.toHaveBeenCalled();
  });

  it("preserves independent nested disclosure states without requiring authored IDs", () => {
    const state = new DisclosureState();
    const first = content(true);
    first
      .querySelector("details")!
      .insertAdjacentHTML(
        "beforeend",
        "<details><summary>Nested</summary><p>Nested text</p></details>",
      );
    const second = content(true);
    second.body.innerHTML = first.body.innerHTML;
    state.attach(0, first);
    state.attach(0, second);
    const inner = first.querySelectorAll("details")[1]!;
    inner.open = true;
    inner.dispatchEvent(new Event("toggle"));
    toggle(first, false);
    expect(Array.from(second.querySelectorAll("details"), (detail) => detail.open)).toEqual([
      false,
      true,
    ]);
    toggle(first, true);
    expect(Array.from(second.querySelectorAll("details"), (detail) => detail.open)).toEqual([
      true,
      true,
    ]);
  });
});
