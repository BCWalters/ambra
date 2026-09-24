import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BookDetailRow, BookMetadataText, BookRightsRow } from "./BookMetadataRows.js";

describe("shared Book Details metadata rows", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("omits missing values", () => {
    act(() => root.render(<BookDetailRow label="ISBN" value={undefined} />));
    expect(container.textContent).toBe("");
  });

  it("abbreviates long identifiers but allows their bounded expanded value to wrap", () => {
    const value = "urn:example:" + "longidentifier".repeat(30);
    act(() => root.render(<BookDetailRow label="Identifier" value={value} />));
    expect(container.querySelector("div")?.style.overflowWrap).toBe("anywhere");
    expect(container.querySelectorAll("p")[1]!.textContent!.length).toBeLessThanOrEqual(160);
    act(() => container.querySelector("button")!.click());
    expect(container.querySelectorAll("p")[1]?.textContent).toBe(value);
  });

  it.each([
    "Copyright 2026 Example",
    "Public domain",
    "  Public domain in the USA.  ",
    "PUBLIC DOMAIN",
    "Public\ndomain",
    "\u00a9 2026 Example",
    "(C) 2026 Example",
  ])("keeps the Rights label for the self-describing statement %j", (value) => {
    act(() => root.render(<BookRightsRow label="Rights" value={value} />));
    expect(Array.from(container.querySelectorAll("p"), node => node.textContent))
      .toEqual(["Rights", value.trim().replace(/\s+/g, " ")]);
  });

  it("keeps the localized label for other rights statements", () => {
    act(() => root.render(<BookRightsRow label="Droits" value="All rights reserved." />));
    expect(Array.from(container.querySelectorAll("p"), node => node.textContent)).toEqual(["Droits", "All rights reserved."]);
  });

  it("provides a keyboard-focusable bounded rights disclosure with stable focus", () => {
    act(() => root.render(<BookRightsRow label="Copyright" value={"Rights statement. ".repeat(200)} />));
    const button = container.querySelector("button")!;
    const text = document.getElementById(button.getAttribute("aria-controls")!)!;
    expect(button.getAttribute("aria-label")).toBe("Show more: Copyright");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(text.textContent!.length).toBeLessThanOrEqual(140);
    button.focus();
    act(() => button.click());
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(button);
    expect(text.textContent!.length).toBeGreaterThan(140);
    expect(text.textContent!.length).toBeLessThanOrEqual(600);
    expect(text.textContent?.endsWith("\u2026")).toBe(true);
    act(() => button.click());
    expect(text.textContent!.length).toBeLessThanOrEqual(140);
  });

  it("renders description HTML as text, with at most two paragraphs and a hard expansion cap", () => {
    act(() => root.render(<BookMetadataText kind="description" value={`<p>${"A description. ".repeat(150)}</p><p>Second paragraph.</p><p>Third paragraph.</p>`} />));
    expect(container.querySelector("em, script, img")).toBeNull();
    const preview = container.querySelector("p")!;
    expect(preview.textContent).not.toContain("<p>");
    expect(preview.textContent!.length).toBeLessThanOrEqual(700);
    act(() => container.querySelector("button")!.click());
    expect(preview.textContent!.length).toBeLessThanOrEqual(1400);
    expect(preview.textContent).not.toContain("Third paragraph.");
  });

  it("resets the disclosure for changed metadata and omits unnecessary toggles", () => {
    act(() => root.render(<BookMetadataText value={"Long metadata. ".repeat(100)} />));
    act(() => container.querySelector("button")!.click());
    act(() => root.render(<BookMetadataText value={"Different metadata. ".repeat(100)} />));
    expect(container.querySelector("button")?.getAttribute("aria-expanded")).toBe("false");
    act(() => root.render(<BookMetadataText value="Short metadata." />));
    expect(container.querySelector("button")).toBeNull();
    expect(container.textContent).toBe("Short metadata.");
  });
});
