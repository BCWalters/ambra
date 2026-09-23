import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BookDetailRow, BookRightsRow } from "./BookMetadataRows.js";

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

  it("preserves metadata text while allowing long identifiers and filenames to wrap", () => {
    const value = "urn:example:" + "longidentifier".repeat(30);
    act(() => root.render(<BookDetailRow label="Identifier" value={value} />));
    expect(container.querySelector("div")?.style.overflowWrap).toBe("anywhere");
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
  ])("omits the label for the self-describing rights statement %j", (value) => {
    act(() => root.render(<BookRightsRow label="Copyright" value={value} />));
    expect(container.querySelectorAll("p")).toHaveLength(1);
    expect(container.textContent).toBe(value);
  });

  it("keeps the localized label for other rights statements", () => {
    act(() => root.render(<BookRightsRow label="Droits" value="All rights reserved." />));
    expect(Array.from(container.querySelectorAll("p"), node => node.textContent)).toEqual(["Droits", "All rights reserved."]);
  });
});
