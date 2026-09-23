import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HighlightStyle } from "@ambra/engine";
import { HighlightStylePicker } from "./HighlightStylePicker.js";

describe("HighlightStylePicker keyboard semantics", () => {
  let root: Root;
  let container: HTMLDivElement;
  const onChange = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    onChange.mockClear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function Harness() {
    const [value, setValue] = useState<HighlightStyle>("yellow");
    return (
      <HighlightStylePicker
        value={value}
        onChange={(next) => {
          onChange(next);
          setValue(next);
        }}
      />
    );
  }

  function radio(label: string) {
    return container.querySelector<HTMLButtonElement>(`[role="radio"][aria-label="${label}"]`)!;
  }

  function key(button: HTMLButtonElement, name: string) {
    const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true });
    act(() => button.dispatchEvent(event));
    return event;
  }

  it.each([
    ["ArrowRight", "Green", "green"],
    ["ArrowDown", "Green", "green"],
    ["ArrowLeft", "Underline", "underline"],
    ["ArrowUp", "Underline", "underline"],
  ])("%s moves focus and selection with wrapping", (arrow, label, style) => {
    act(() => root.render(<Harness />));
    act(() => radio("Yellow").focus());
    expect(key(radio("Yellow"), arrow).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(radio(label));
    expect(radio(label).getAttribute("aria-checked")).toBe("true");
    expect(onChange).toHaveBeenLastCalledWith(style);
    expect(
      [...container.querySelectorAll('[role="radio"]')].filter(
        (button) => button.getAttribute("tabindex") === "0",
      ),
    ).toEqual([radio(label)]);
  });

  it("advances from focus even when the controlled selection is waiting to persist", () => {
    act(() => root.render(<HighlightStylePicker value="yellow" onChange={onChange} />));
    act(() => radio("Yellow").focus());
    key(radio("Yellow"), "ArrowRight");
    key(radio("Green"), "ArrowRight");
    expect(document.activeElement).toBe(radio("Blue"));
    expect(onChange.mock.calls.map(([value]) => value)).toEqual(["green", "blue"]);
  });

  it("keeps unrelated keys available and stops owned arrows reaching page navigation", () => {
    act(() => root.render(<Harness />));
    const parentKey = vi.fn();
    document.addEventListener("keydown", parentKey);
    try {
      expect(key(radio("Yellow"), "Tab").defaultPrevented).toBe(false);
      expect(parentKey).toHaveBeenCalledOnce();
      key(radio("Yellow"), "ArrowRight");
      expect(parentKey).toHaveBeenCalledOnce();
    } finally {
      document.removeEventListener("keydown", parentKey);
    }
  });

  it("preserves pointer selection and accepts external value changes", () => {
    act(() => root.render(<Harness />));
    act(() => radio("Purple").click());
    expect(onChange).toHaveBeenCalledWith("purple");
    expect(radio("Purple").tabIndex).toBe(0);
    act(() => root.render(<HighlightStylePicker value="blue" onChange={onChange} />));
    expect(radio("Blue").tabIndex).toBe(0);
    expect(radio("Purple").tabIndex).toBe(-1);
  });
});
