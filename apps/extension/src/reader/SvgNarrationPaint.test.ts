import { afterEach, describe, expect, it, vi } from "vitest";
import { applySvgNarrationPaint } from "./SvgNarrationPaint.js";

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

function fixture() {
  document.body.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 110">
    <g id="group" transform="translate(20,20)" clip-path="url(#clip)">
      <text id="styled" style="fill:purple;filter:opacity(0.8);text-shadow:0 0 2px red!important">First
        <tspan id="nested">nested</tspan></text>
      <text id="plain"><tspan id="target">Second</tspan><tspan id="other">Other</tspan></text>
    </g></svg>`;
  return {
    group: document.getElementById("group")!,
    styled: document.querySelector<SVGElement>("#styled")!,
    nested: document.querySelector<SVGElement>("#nested")!,
    target: document.querySelector<SVGElement>("#target")!,
    other: document.querySelector<SVGElement>("#other")!,
  };
}

describe("SVG narration glyph paint", () => {
  it("preserves author shadows, fill, filters, transforms, clipping and DOM structure", () => {
    const { group, styled } = fixture();
    const shadow = styled.style.getPropertyValue("text-shadow");
    const children = [...group.childNodes];
    const clean = applySvgNarrationPaint(group);
    expect(styled.style.getPropertyValue("text-shadow")).toContain("red");
    expect(styled.style.getPropertyValue("text-shadow")).toContain("#b9e5ff");
    expect(styled.style.getPropertyValue("fill")).toBe("purple");
    expect(styled.style.getPropertyValue("filter")).toBe("opacity(0.8)");
    expect(group.getAttribute("transform")).toBe("translate(20,20)");
    expect(group.getAttribute("clip-path")).toBe("url(#clip)");
    expect([...group.childNodes]).toEqual(children);
    clean();
    expect(styled.style.getPropertyValue("text-shadow")).toBe(shadow);
    expect(styled.style.getPropertyPriority("text-shadow")).toBe("important");
    expect(document.getElementById("plain")!.hasAttribute("style")).toBe(false);
  });

  it("paints an exact tspan without painting its unnarrated sibling", () => {
    const { target, other } = fixture();
    const clean = applySvgNarrationPaint(target);
    expect(target.style.getPropertyValue("text-shadow")).toContain("#b9e5ff");
    expect(other.hasAttribute("style")).toBe(false);
    clean();
    expect(target.hasAttribute("style")).toBe(false);
  });

  it("does not multiply inherited reader halos on nested text", () => {
    const { group, nested } = fixture();
    const clean = applySvgNarrationPaint(group);
    expect(nested.style.getPropertyValue("text-shadow").match(/#b9e5ff/g)).toHaveLength(2);
    clean();
    expect(nested.hasAttribute("style")).toBe(false);
  });

  it("reports a detached document without modifying it", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const doc = new DOMParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg"><text>Detached</text></svg>', "image/svg+xml");
    Object.defineProperty(doc, "defaultView", { value: null });
    applySvgNarrationPaint(doc.documentElement)();
    expect(warning).toHaveBeenCalledOnce();
    expect(doc.querySelector("text")!.hasAttribute("style")).toBe(false);
  });
});
