export type ReferencePanel = "toc" | "library" | "annotations" | "search" | "details";
export type ReferencePanelSide = "left" | "right";
export type ReferencePanels = {
  left?: ReferencePanel;
  right?: ReferencePanel;
  active?: ReferencePanel;
  focusTarget?: ReferencePanel;
};
export type ReferencePanelPins = { reference: boolean; search: boolean };
export type ReferencePanelWidths = Record<"toc" | "annotations" | "search", number>;

export function referencePanelSide(panel: ReferencePanel): ReferencePanelSide {
  return panel === "toc" || panel === "library" ? "left" : "right";
}

export function wantsReferencePanelPin(panel: ReferencePanel | undefined, pins: ReferencePanelPins): boolean {
  return panel === "search" ? pins.search : (panel === "toc" || panel === "annotations") && pins.reference;
}

export function closeReferencePanel(state: ReferencePanels, panel: ReferencePanel): ReferencePanels {
  const side = referencePanelSide(panel);
  if (state[side] !== panel) return state;
  const next = { ...state };
  delete next[side];
  if (next.active === panel) {
    delete next.active;
    const remaining = next.left ?? next.right;
    if (remaining) next.active = remaining;
  }
  return next;
}

export function openReferencePanel(
  state: ReferencePanels, panel: ReferencePanel, pins: ReferencePanelPins,
): ReferencePanels {
  const opposite = referencePanelSide(panel) === "left" ? state.right : state.left;
  const next: ReferencePanels = { [referencePanelSide(panel)]: panel, active: panel, focusTarget: panel };
  if (opposite && wantsReferencePanelPin(opposite, pins)) {
    next[referencePanelSide(opposite)] = opposite;
  }
  return next;
}

/** Reserve docks together, using the row remaining after Inspector docking.
 * Keep the older dock when the new panel must float; at narrow/zoom widths
 * temporarily reveal only the active panel, without discarding the other. */
export function referencePanelLayout(
  state: ReferencePanels, pins: ReferencePanelPins, available: number, widths: ReferencePanelWidths,
): {
  visible: ReferencePanels;
  docked: Record<"toc" | "annotations" | "search", boolean>;
  canPin: Record<"toc" | "annotations" | "search", boolean>;
} {
  const width = (panel: ReferencePanel) => panel === "library" || panel === "details" ? 360 : widths[panel];
  let visible = state;
  if (state.left && state.right && (available < width(state.left) + width(state.right) ||
    ![state.left, state.right].some(panel => wantsReferencePanelPin(panel, pins) && available - width(panel) >= 320))) {
    visible = state.active ? { [referencePanelSide(state.active)]: state.active, active: state.active } : {};
  }
  const docked = { toc: false, annotations: false, search: false };
  const panels = [visible.left, visible.right].filter((panel): panel is ReferencePanel => panel !== undefined);
  panels.sort((a, b) => Number(a === state.active) - Number(b === state.active));
  let remaining = available;
  for (const panel of panels) {
    if (wantsReferencePanelPin(panel, pins) && width(panel) > 0 && remaining - width(panel) >= 320) {
      docked[panel as keyof typeof docked] = true;
      remaining -= width(panel);
    }
  }
  const canPin = { toc: false, annotations: false, search: false };
  for (const panel of Object.keys(canPin) as (keyof typeof canPin)[]) {
    canPin[panel] = docked[panel] || (widths[panel] > 0 && remaining - widths[panel] >= 320);
  }
  return { visible, docked, canPin };
}
