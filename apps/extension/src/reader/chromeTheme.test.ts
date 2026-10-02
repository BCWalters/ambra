import { describe, expect, it } from "vitest";
import { createAmbraFluentTheme, getInterfaceTheme, getPageBookmarkColor } from "@ambra/shell";
import { ReadingTheme } from "@ambra/engine";
import { CHROME_THEMES, getChromeTheme, type ChromeThemeChoice } from "./chromeTheme.js";

function luminance(rgb: readonly number[]): number {
  const linear = rgb.map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
}

function contrast(first: string, second: string): number {
  const values = [first, second].map((hex) =>
    luminance(hex.slice(1).match(/../g)!.map((part) => Number.parseInt(part, 16))));
  return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
}

const choices = Object.keys(CHROME_THEMES) as ChromeThemeChoice[];

describe.each(["light", "dark"] as const)("semantic interface tokens in %s appearance", (appearance) => {
  it.each(choices)("%s preserves text, action, selection, control and focus contrast", (choice) => {
    const palette = getInterfaceTheme(choice, appearance);
    for (const background of [palette.surface, palette.canvas, palette.hover, palette.selected]) {
      expect(contrast(palette.text, background)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette.textSubdued, background)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette.accentForeground, background)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette.focus, background)).toBeGreaterThanOrEqual(3);
      expect(contrast(palette.bookmark, background)).toBeGreaterThanOrEqual(3);
    }
    for (const action of [palette.actionBackground, palette.actionHover, palette.actionPressed]) {
      expect(contrast(palette.actionForeground, action)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(action, palette.surface)).toBeGreaterThanOrEqual(3);
    }
    expect(contrast(palette.controlBorder, palette.surface)).toBeGreaterThanOrEqual(3);
    expect(contrast(palette.controlBorder, palette.canvas)).toBeGreaterThanOrEqual(3);
    const fluent = createAmbraFluentTheme(palette);
    expect(fluent.fontFamilyBase).toBe('-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif');
    expect(fluent.fontFamilyNumeric).toBe(fluent.fontFamilyBase);
    expect(fluent.fontSizeBase300).toBe("14px");
    expect(fluent.lineHeightBase300).toBe("21px");
    expect(fluent.lineHeightBase200).toBe("18px");
    expect(fluent.fontWeightSemibold).toBe(550);
    expect(fluent.colorBrandBackground).toBe(palette.actionBackground);
    expect(fluent.colorCompoundBrandBackground).toBe(palette.actionBackground);
    expect(fluent.colorNeutralForegroundOnBrand).toBe(palette.actionForeground);
    expect(fluent.colorBrandForegroundLink).toBe(palette.accentForeground);
    expect(fluent.colorStrokeFocus2).toBe(palette.focus);
    expect(fluent.colorBrandBackground2).toBe(palette.selected);
  });

  it.each(choices)("%s has contrast on every point of its opaque chrome background", (choice) => {
    const palette = getChromeTheme(choice, appearance);
    const stops = [...palette.backgroundSolid.matchAll(/rgb\((\d+), (\d+), (\d+)\)/g)];
    expect(stops).toHaveLength(2);
    for (let step = 0; step <= 10; step++) {
      const rgb = stops[0]!.slice(1).map((value, index) =>
        Number(value) + (Number(stops[1]![index + 1]) - Number(value)) * step / 10);
      const background = luminance(rgb);
      for (const color of [palette.text, palette.textSubdued, palette.accentForeground]) {
        const foreground = luminance(color.slice(1).match(/../g)!.map((part) => Number.parseInt(part, 16)));
        expect((Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05))
          .toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe("independent publication appearance", () => {
  it.each(choices)("%s supplies a contrast-safe bookmark for every reading page", (choice) => {
    const original = structuredClone(ReadingTheme.PAGE_THEMES);
    for (const [name, page] of Object.entries(ReadingTheme.PAGE_THEMES)) {
      const marker = getPageBookmarkColor(choice, name === "dark" ? "dark" : "light");
      expect(contrast(marker, page.background)).toBeGreaterThanOrEqual(3);
    }
    expect(ReadingTheme.PAGE_THEMES).toEqual(original);
  });
});

describe("chrome theme text emphasis", () => {
  it.each(Object.entries(CHROME_THEMES))("%s meets normal-text contrast across its solid gradient", (_name, theme) => {
    const foreground = luminance(theme.accentForeground.slice(1).match(/../g)!.map((part) => Number.parseInt(part, 16)));
    const stops = [...theme.backgroundSolid.matchAll(/rgb\((\d+), (\d+), (\d+)\)/g)]
      .map((match) => match.slice(1).map(Number));
    expect(stops).toHaveLength(2);
    for (let step = 0; step <= 10; step++) {
      const background = luminance(stops[0]!.map((value, index) => value + (stops[1]![index]! - value) * step / 10));
      const contrast = (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
      expect(contrast).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("preserves the decorative Ambra accent", () => {
    expect(CHROME_THEMES.ambra.accent).toBe("#f5a531");
    expect(CHROME_THEMES.ambra.accentForeground).not.toBe(CHROME_THEMES.ambra.accent);
  });

  it.each(["#333333", "#424242", "#134e4a"])("keeps shell secondary text and Inspector links readable (%s)", (color) => {
    const foreground = luminance(color.slice(1).match(/../g)!.map((part) => Number.parseInt(part, 16)));
    for (const theme of Object.values(CHROME_THEMES)) {
      for (const match of theme.backgroundSolid.matchAll(/rgb\((\d+), (\d+), (\d+)\)/g)) {
        const background = luminance(match.slice(1).map(Number));
        expect((background + 0.05) / (foreground + 0.05)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
