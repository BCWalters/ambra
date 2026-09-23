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

  it("does not repeat the Copyright label when it is already in the statement", () => {
    act(() => root.render(<BookRightsRow label="Copyright" value="Copyright 2026 Example" />));
    expect(container.querySelectorAll("p")).toHaveLength(1);
    expect(container.textContent).toBe("Copyright 2026 Example");
  });

  it("keeps the localized label for other rights statements", () => {
    act(() => root.render(<BookRightsRow label="Droits" value="Public domain" />));
    expect(Array.from(container.querySelectorAll("p"), node => node.textContent)).toEqual(["Droits", "Public domain"]);
  });
});
