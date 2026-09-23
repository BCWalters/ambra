import { describe, expect, it } from "vitest";
import { CHROME_THEMES } from "./chromeTheme.js";

function luminance(rgb: readonly number[]): number {
  const linear = rgb.map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
}

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
});
