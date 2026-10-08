import { renderToStaticMarkup } from "react-dom/server";
import { ReadingTheme } from "@ambra/engine";
import { getPageBookmarkColor } from "@ambra/shell/theme";
import { expect, it } from "vitest";
import type { ReaderSnapshot } from "../ReaderTypes.js";
import { PageFurniture } from "./PageFurniture.js";
import { PageTurnAnimator } from "../PageTurnAnimator.js";
import { PAGE_FURNITURE_TEXT_OPACITY } from "../furnitureLayout.js";

function rgb(hex: string) {
  return hex.slice(1).match(/../g)!.map(part => Number.parseInt(part, 16));
}

function luminance(color: number[]) {
  const linear = color.map(channel => channel / 255 <= 0.04045
    ? channel / 255 / 12.92 : ((channel / 255 + 0.055) / 1.055) ** 2.4);
  return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
}

it.each(["ltr", "rtl"] as const)("places page numbers in physical %s order without reversing their values", pageProgressionDirection => {
  const snapshot = {
    pageTheme: "white", chromeTheme: "silver", viewMode: "paginated", isFixedLayout: false,
    isSpread: true, paneWidth: 1400, pageProgressionDirection,
    bookmarkedPages: [], title: "Publication", currentChapterLabel: "Chapter",
    bookPageIndex: 7, bookPageCount: 20, spreadPageNumbers: [7, 8],
  } as unknown as ReaderSnapshot;
  const root = document.createElement("div");
  root.innerHTML = renderToStaticMarkup(<PageFurniture snapshot={snapshot} chromeVisible={false} />);
  const folios = [...root.querySelectorAll("span")].filter(span => /^Page \d+$/.test(span.textContent ?? ""));
  expect(folios.map(span => span.textContent)).toEqual(
    pageProgressionDirection === "rtl" ? ["Page 8", "Page 7"] : ["Page 7", "Page 8"],
  );
  expect(folios[0]?.parentElement?.style.left).toBe("0px");
  expect(folios[1]?.parentElement?.style.right).toBe("0px");
});

it.each(["white", "sepia", "dark"] as const)("keeps static/animated furniture and themed bookmarks readable on %s pages", pageTheme => {
  const page = ReadingTheme.PAGE_THEMES[pageTheme];
  const pageLuminance = luminance(rgb(page.background));
  const composite = luminance(rgb(page.foreground).map((value, index) =>
    value * PAGE_FURNITURE_TEXT_OPACITY + rgb(page.background)[index]! * (1 - PAGE_FURNITURE_TEXT_OPACITY)));
  expect((Math.max(pageLuminance, composite) + 0.05) / (Math.min(pageLuminance, composite) + 0.05))
    .toBeGreaterThanOrEqual(4.5);
  for (const chromeTheme of ["ambra", "silver", "green", "blue", "purple"] as const) {
    const snapshot = {
      pageTheme, chromeTheme, viewMode: "paginated", isFixedLayout: false, isSpread: false,
      bookmarkedPages: [true], title: "Publication", currentChapterLabel: "Chapter",
      bookPageIndex: 0, bookPageCount: 3,
    } as unknown as ReaderSnapshot;
    const root = document.createElement("div");
    root.innerHTML = renderToStaticMarkup(<PageFurniture snapshot={snapshot} chromeVisible={false} />);
    const marker = root.querySelector("svg")!;
    const bookmark = getPageBookmarkColor(chromeTheme, pageTheme === "dark" ? "dark" : "light");
    expect(marker.style.color).toBe(bookmark);
    const markerLuminance = luminance(rgb(bookmark));
    expect((Math.max(pageLuminance, markerLuminance) + 0.05) / (Math.min(pageLuminance, markerLuminance) + 0.05))
      .toBeGreaterThanOrEqual(3);
    const text = root.querySelector("span")!;
    const animator = new PageTurnAnimator({
      containerEl: () => document.body, height: () => 800,
      pageTheme: () => pageTheme, pageTurnAnimationStyle: () => "slide",
    });
    const overlay = animator.buildTurnFurnitureOverlay(document.createElement("div"), [{
      left: 0, width: 800, header: { mode: "single", text: "Publication" }, footerText: "Page 1",
    }])!;
    expect(text.style.opacity).toBe(String(PAGE_FURNITURE_TEXT_OPACITY));
    expect(overlay.querySelector("span")!.style.opacity).toBe(text.style.opacity);
    expect(overlay.querySelector("span")!.style.color).toBe(text.style.color);
    root.innerHTML = renderToStaticMarkup(<PageFurniture snapshot={snapshot} chromeVisible />);
    expect(root.querySelector("svg")).toBeNull();
  }
});
