import { describe, expect, it } from "vitest";
import {
  closeReferencePanel, openReferencePanel, referencePanelLayout,
  type ReferencePanel, type ReferencePanels,
} from "./referencePanels.js";

const pinned = { reference: true, search: true };
const unpinned = { reference: false, search: false };
const widths = { toc: 300, annotations: 300, search: 300 };
const open = (panels: ReferencePanel[], pins = pinned) =>
  panels.reduce((state, panel) => openReferencePanel(state, panel, pins), {} as ReferencePanels);

describe("reference panel coexistence", () => {
  it.each(["annotations", "search", "details"] as const)("preserves pinned Contents when opening %s", panel => {
    expect(open(["toc", panel])).toMatchObject({ left: "toc", right: panel, active: panel });
  });

  it.each(["toc", "library"] as const)("preserves pinned Annotations when opening %s", panel => {
    expect(open(["annotations", panel])).toMatchObject({ left: panel, right: "annotations", active: panel });
  });

  it("also preserves Search's independent pin preference", () => {
    expect(open(["search", "toc"], { reference: false, search: true })).toMatchObject({
      left: "toc", right: "search",
    });
    expect(open(["toc", "search"], { reference: false, search: true }).left).toBeUndefined();
  });

  it("keeps ordinary unpinned flyouts exclusive", () => {
    expect(open(["toc", "annotations"], unpinned).left).toBeUndefined();
    expect(open(["annotations", "toc"], unpinned).right).toBeUndefined();
    expect(open(["details", "toc"]).right).toBeUndefined();
    expect(open(["library", "annotations"]).left).toBeUndefined();
  });

  it("replaces only same-side panels", () => {
    expect(open(["toc", "annotations", "details"])).toMatchObject({ left: "toc", right: "details" });
    expect(open(["toc", "annotations", "search"])).toMatchObject({ left: "toc", right: "search" });
    expect(open(["annotations", "toc", "library"])).toMatchObject({ left: "library", right: "annotations" });
  });

  it("closes only the addressed panel without requesting focus in the retained dock", () => {
    const state = open(["toc", "annotations"]);
    expect(closeReferencePanel(state, "search")).toBe(state);
    expect(closeReferencePanel(state, "annotations")).toEqual({
      left: "toc", active: "toc", focusTarget: "annotations",
    });
    expect(closeReferencePanel(closeReferencePanel(state, "annotations"), "toc").active).toBeUndefined();
  });

  it("preserves exclusivity when the shared Contents/Annotations preference is unpinned", () => {
    expect(openReferencePanel(open(["toc", "annotations"]), "annotations", unpinned)).toEqual({
      right: "annotations", active: "annotations", focusTarget: "annotations",
    });
  });
});

describe("reference panel width budget", () => {
  it("docks both panels only when their combined width leaves at least 320px", () => {
    const state = open(["toc", "annotations"]);
    expect(referencePanelLayout(state, pinned, 920, widths).docked).toEqual({
      toc: true, annotations: true, search: false,
    });
    const narrow = referencePanelLayout(state, pinned, 919, widths);
    expect(narrow.docked).toEqual({ toc: true, annotations: false, search: false });
    expect(narrow.canPin.annotations).toBe(false);
    expect(narrow.visible).toBe(state);
  });

  it("preserves the opposite dock symmetrically when the newest panel must overlay", () => {
    const state = open(["annotations", "toc"]);
    expect(referencePanelLayout(state, pinned, 700, widths).docked).toEqual({
      toc: false, annotations: true, search: false,
    });
  });

  it("accounts for actual unequal panel widths and the row after Inspector docking", () => {
    const state = open(["toc", "search"]);
    const actual = { ...widths, search: 360 };
    expect(referencePanelLayout(state, pinned, 980, actual).docked.search).toBe(true);
    expect(referencePanelLayout(state, pinned, 980 - 200, actual).docked.search).toBe(false);
    expect(referencePanelLayout(state, pinned, 980 - 200, actual).docked.toc).toBe(true);
  });

  it.each([320, 599, 600, 619])("at %ipx, hides the opposite panel without losing open or pin intent", available => {
    const state = open(["toc", "annotations"]);
    const narrow = referencePanelLayout(state, pinned, available, widths);
    expect(narrow.visible.left).toBeUndefined();
    expect(narrow.visible.right).toBe("annotations");
    expect(Object.values(narrow.docked)).not.toContain(true);
    expect(Object.values(narrow.canPin)).not.toContain(true);
    expect(referencePanelLayout(state, pinned, 1200, widths).visible).toBe(state);
    expect(referencePanelLayout(state, pinned, 1200, widths).docked).toMatchObject({
      toc: true, annotations: true,
    });
  });

  it("reserves the larger Library and Book details overlay widths", () => {
    expect(referencePanelLayout(open(["toc", "details"]), pinned, 650, widths).visible.left).toBeUndefined();
    expect(referencePanelLayout(open(["annotations", "library"]), pinned, 650, widths).visible.right).toBeUndefined();
  });

  it("lets closing the narrow foreground reveal the retained panel", () => {
    const state = closeReferencePanel(open(["toc", "annotations"]), "annotations");
    expect(referencePanelLayout(state, pinned, 320, widths).visible.left).toBe("toc");
    expect(referencePanelLayout(state, pinned, 700, widths).docked.toc).toBe(true);
  });
});
