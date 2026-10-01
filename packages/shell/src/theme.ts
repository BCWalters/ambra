import { webDarkTheme, webLightTheme, type Theme } from "@fluentui/react-components";

export type InterfaceThemeChoice = "ambra" | "silver" | "green" | "blue" | "purple";
export type BrowserAppearance = "light" | "dark";
export const DEFAULT_INTERFACE_THEME: InterfaceThemeChoice = "ambra";

const accents = {
  ambra: { label: "Ambra", decorative: "#f5a531", light: "#865000", dark: "#ffc15a", selected: "#ffebbb", darkSelected: "#493819" },
  silver: { label: "Silver", decorative: "#5b6472", light: "#465363", dark: "#bdcadd", selected: "#e4e9ef", darkSelected: "#354152" },
  green: { label: "Green", decorative: "#1f7a4d", light: "#226342", dark: "#91d5a8", selected: "#deeee3", darkSelected: "#263f30" },
  blue: { label: "Blue", decorative: "#1d5aa8", light: "#245c98", dark: "#a3caff", selected: "#e0ecfa", darkSelected: "#293c54" },
  purple: { label: "Purple", decorative: "#7c3fa0", light: "#694891", dark: "#d6b6fa", selected: "#eee3fa", darkSelected: "#40314f" },
} as const;

function mix(color: string, toward: number, amount: number): string {
  return `#${color.slice(1).match(/../g)!.map((part) =>
    Math.round(Number.parseInt(part, 16) * (1 - amount) + toward * amount).toString(16).padStart(2, "0"),
  ).join("")}`;
}

/** Interface-only roles. Publication colors and saved annotation inks never enter this mapping. */
export function getInterfaceTheme(choice: InterfaceThemeChoice, appearance: BrowserAppearance) {
  const accent = accents[choice];
  const dark = appearance === "dark";
  const functional = dark ? accent.dark : accent.light;
  return {
    choice, appearance, label: accent.label,
    accent: accent.decorative,
    accentForeground: functional,
    canvas: dark ? "#232320" : "#f6f5f2",
    surface: dark ? "#2b2b27" : "#fffefa",
    text: dark ? "#f0eade" : "#302c26",
    textSubdued: dark ? "#bcb3a4" : "#6e6559",
    border: dark ? "#514b40" : "#d8d1c6",
    controlBorder: dark ? "#a69a86" : "#908575",
    hover: dark ? "#403b32" : "#eee9de",
    selected: dark ? accent.darkSelected : accent.selected,
    actionBackground: functional,
    actionForeground: dark ? "#232320" : "#ffffff",
    actionHover: mix(functional, dark ? 255 : 0, 0.10),
    actionPressed: mix(functional, dark ? 255 : 0, 0.20),
    focus: functional,
    bookmark: functional,
    shadow: dark ? "0 8px 28px #00000040" : "0 8px 28px #302c2618",
  } as const;
}

export type InterfaceTheme = ReturnType<typeof getInterfaceTheme>;

/** A page marker follows the interface hue, but contrasts with the independent page appearance. */
export function getPageBookmarkColor(choice: InterfaceThemeChoice, pageAppearance: BrowserAppearance): string {
  return accents[choice][pageAppearance];
}

/** Literal values for Ambra-owned roots in another document; never apply to publication roots. */
export function getInterfaceCssVariables(palette: InterfaceTheme): Record<`--ambra${string}`, string> {
  return {
    "--ambraCanvas": palette.canvas,
    "--ambraSurface": palette.surface,
    "--ambraText": palette.text,
    "--ambraTextSubdued": palette.textSubdued,
    "--ambraBorder": palette.border,
    "--ambraControlBorder": palette.controlBorder,
    "--ambraHover": palette.hover,
    "--ambraSelected": palette.selected,
    "--ambraActionBackground": palette.actionBackground,
    "--ambraActionForeground": palette.actionForeground,
    "--ambraActionHover": palette.actionHover,
    "--ambraActionPressed": palette.actionPressed,
    "--ambraAccentForeground": palette.accentForeground,
    "--ambraFocus": palette.focus,
    "--ambraBookmark": palette.bookmark,
    "--ambraShadow": palette.shadow,
  };
}

/** Fluent owns behavior, status colors, disabled states and forced-colors adaptation. */
export function createAmbraFluentTheme(palette: InterfaceTheme): Theme {
  const theme = { ...(palette.appearance === "dark" ? webDarkTheme : webLightTheme) };
  // Map every brand alias, including less common inverted/static/link states, so
  // ordinary Fluent controls and future consumers cannot fall back to stock blue.
  for (const key of Object.keys(theme) as (keyof Theme)[]) {
    if (!key.startsWith("colorBrand") && !key.startsWith("colorCompoundBrand")
      && !key.startsWith("colorNeutralForeground2Brand")) continue;
    if (key.includes("Shadow")) continue;
    const selectedSurface = key.startsWith("colorBrandBackground2")
      || key.startsWith("colorBrandBackgroundInverted");
    Object.assign(theme, { [key]: selectedSurface ? palette.selected
      : key.endsWith("Hover") ? palette.actionHover
      : key.endsWith("Pressed") ? palette.actionPressed
      : palette.accentForeground });
  }
  Object.assign(theme, {
    colorNeutralForeground1: palette.text,
    colorNeutralForeground2: palette.textSubdued,
    colorNeutralForeground3: palette.textSubdued,
    colorNeutralForegroundOnBrand: palette.actionForeground,
    colorNeutralBackground1: palette.surface,
    colorNeutralBackground2: palette.canvas,
    colorNeutralBackground3: palette.canvas,
    colorNeutralBackground1Hover: palette.hover,
    colorNeutralBackground1Pressed: palette.selected,
    colorNeutralBackground1Selected: palette.selected,
    colorNeutralBackground2Hover: palette.hover,
    colorNeutralBackground2Pressed: palette.selected,
    colorNeutralBackground2Selected: palette.selected,
    colorNeutralStroke1: palette.controlBorder,
    colorNeutralStroke2: palette.border,
    colorNeutralStrokeAccessible: palette.controlBorder,
    colorNeutralStrokeAccessibleHover: palette.accentForeground,
    colorNeutralStrokeAccessiblePressed: palette.accentForeground,
    colorNeutralStrokeAccessibleSelected: palette.accentForeground,
    colorStrokeFocus1: palette.surface,
    colorStrokeFocus2: palette.focus,
  });
  // Fluent serializes additional theme keys into CSS variables and carries the
  // theme class into portals; inline root variables alone would not reach them.
  for (const [key, value] of Object.entries(getInterfaceCssVariables(palette))) {
    Object.assign(theme, { [key.slice(2)]: value });
  }
  return theme;
}
