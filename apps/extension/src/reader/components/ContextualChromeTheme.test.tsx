import { act } from "react";
import { createRoot } from "react-dom/client";
import { HighlightTheme } from "@ambra/engine";
import { getInterfaceTheme } from "@ambra/shell/theme";
import { expect, it, vi } from "vitest";
import { ChromeThemeProvider } from "../ChromeThemeContext.js";
import { FootnotePopup } from "./FootnotePopup.js";
import { HighlightActionPopup } from "./HighlightActionPopup.js";
import { SelectionToolbar } from "./SelectionToolbar.js";
import { NoteMarkers } from "./NoteMarkers.js";
import type { Highlight } from "../../library/LibraryDatabase.js";

it("themes contextual controls without changing annotation inks, saved state or note drafts", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  vi.spyOn(window, "matchMedia").mockReturnValue(media);
  let dark = false;
  vi.spyOn(media, "matches", "get").mockImplementation(() => dark);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onSetNote = vi.fn(async () => true);
  const onSetStyle = vi.fn();
  const onPick = vi.fn();
  const noop = () => {};
  const highlight: Highlight = {
    id: "saved", bookId: "book", spineIndex: 0, startCfi: "start", endCfi: "end",
    style: "blue", text: "Authored passage", note: "Keep this note", createdAt: 1,
  };
  const original = structuredClone(highlight);
  const inks = structuredClone(HighlightTheme.STYLES);
  let originalTextarea: HTMLTextAreaElement | undefined;
  try {
    for (const appearance of ["light", "dark"] as const) {
      act(() => { dark = appearance === "dark"; media.dispatchEvent(new Event("change")); });
      for (const theme of ["ambra", "silver", "green", "blue", "purple"] as const) {
        act(() => root.render(<ChromeThemeProvider theme={theme}>
          <FootnotePopup state={{ content: "Publication footnote", left: 100, top: 100 }} onDismiss={noop} />
          <SelectionToolbar state={{ left: 100, top: 100 }} onPick={onPick} onAddNote={noop} />
          <HighlightActionPopup state={{ highlight, left: 100, top: 100 }}
            onSetNote={onSetNote} onSetStyle={onSetStyle} onRemove={noop} onDismiss={noop} />
          <NoteMarkers markers={[{ id: highlight.id, left: 100, top: 100 }]} onSelect={noop} />
        </ChromeThemeProvider>));
        const palette = getInterfaceTheme(theme, appearance);
        for (const popup of container.querySelectorAll<HTMLElement>('[role="dialog"], [role="toolbar"]')) {
          expect(popup.style.color).toBe(palette.text);
        }
        const swatches = container.querySelectorAll<HTMLButtonElement>('[role="radio"]');
        expect(swatches).toHaveLength(HighlightTheme.STYLE_ORDER.length);
        HighlightTheme.STYLE_ORDER.forEach((style, index) => {
          expect(swatches[index]!.style.background).toContain(HighlightTheme.STYLES[style].swatch);
          expect(swatches[index]!.getAttribute("aria-checked")).toBe(String(style === highlight.style));
        });
        const marker = container.querySelector<HTMLButtonElement>('button[style*="z-index: 5"]')!;
        expect(marker.style.color).toBe(palette.accentForeground);
        const textarea = container.querySelector("textarea")!;
        if (!originalTextarea) originalTextarea = textarea;
        expect(textarea).toBe(originalTextarea);
        expect(textarea.value).toBe("Keep this note");
      }
    }
    expect(highlight).toEqual(original);
    expect(HighlightTheme.STYLES).toEqual(inks);
    expect(onSetNote).not.toHaveBeenCalled();
    expect(onSetStyle).not.toHaveBeenCalled();
    expect(onPick).not.toHaveBeenCalled();
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
