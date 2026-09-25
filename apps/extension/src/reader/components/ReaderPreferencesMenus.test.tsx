import { act } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReadingTheme } from "@ambra/engine";
import { ReaderSettingsMenu, TypographyMenu } from "./ReaderPreferencesMenus.js";
import type { ReaderSettingsMenuProps, TypographyMenuProps } from "./ReaderPreferencesMenus.js";

// Keep these tests about preference values/callbacks; Chromium tests exercise Fluent's real menu navigation.
vi.mock("@fluentui/react-components", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@fluentui/react-components")>();
  const { createContext, useContext } = await import("react");
  interface MenuState {
    checkedValues?: Record<string, string[]>;
    onCheckedValueChange?: (event: unknown, data: { name: string; checkedItems: string[] }) => void;
  }
  const Context = createContext<MenuState>({});
  const Container = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return {
    ...actual,
    Menu: ({ children, ...state }: MenuState & { children: ReactNode }) => (
      <Context.Provider value={state}>{children}</Context.Provider>
    ),
    MenuTrigger: Container,
    MenuPopover: Container,
    MenuList: Container,
    MenuItemRadio: ({
      name,
      value,
      children,
      disabled,
      icon,
    }: {
      name: string;
      value: string;
      children: ReactNode;
      disabled?: boolean;
      icon?: ReactNode;
    }) => {
      const menu = useContext(Context);
      return (
        <button
          role="menuitemradio"
          aria-checked={menu.checkedValues?.[name]?.includes(value) ?? false}
          disabled={disabled}
          onClick={(event) => menu.onCheckedValueChange?.(event, { name, checkedItems: [value] })}
        >
          {icon}{children}
        </button>
      );
    },
  };
});

describe("reader preference menu contracts", () => {
  let root: Root;
  let container: HTMLDivElement;
  let typography: TypographyMenuProps;
  let settings: ReaderSettingsMenuProps;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    typography = {
      fontScale: 1.5,
      lineSpacing: 1.6,
      letterSpacing: 0.05,
      contentWidthEm: ReadingTheme.MAX_CONTENT_WIDTH_EM,
      fontFamily: "book-default",
      alwaysShowOnePage: false,
      onSetFontScale: vi.fn(),
      onSetLineSpacing: vi.fn(),
      onSetLetterSpacing: vi.fn(),
      onSetContentWidth: vi.fn(),
      onSetFontFamily: vi.fn(),
      onSetAlwaysShowOnePage: vi.fn(),
    };
    settings = {
      isFixedLayout: false,
      viewMode: "paginated",
      brightness: 0.7,
      pageTheme: "white",
      onSetPageTheme: vi.fn(),
      chromeTheme: "ambra",
      pageTurnAnimationStyle: "slide",
      onSetViewMode: vi.fn(),
      onSetBrightness: vi.fn(),
      onSetChromeTheme: vi.fn(),
      onSetPageTurnAnimationStyle: vi.fn(),
    };
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function radio(label: string) {
    return [...container.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find(
      (button) => button.textContent === label,
    )!;
  }

  it("opens Help with the Settings trigger as the focus-return target", () => {
    const onOpenHelp = vi.fn();
    act(() => root.render(<ReaderSettingsMenu {...settings} onOpenHelp={onOpenHelp} />));
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="Settings"]');
    expect(trigger).not.toBeNull();
    const item = [...container.querySelectorAll<HTMLElement>('[role="menuitem"]')]
      .find(element => element.textContent === "Help & About");
    expect(item).toBeDefined();
    act(() => item!.click());
    expect(onOpenHelp).toHaveBeenCalledWith(trigger);
  });

  it("routes font and page choices independently and reflects controlled values", () => {
    act(() => root.render(<TypographyMenu {...typography} />));
    expect(radio("Book default").getAttribute("aria-checked")).toBe("true");
    expect(container.querySelector("select")).toBeNull();
    const toggle = container.querySelector<HTMLInputElement>('input[role="switch"]')!;
    expect(toggle.labels?.[0]?.textContent).toBe("Always show one page");
    expect(toggle.checked).toBe(false);
    act(() => radio("Georgia").click());
    act(() => toggle.click());
    expect(typography.onSetFontFamily).toHaveBeenCalledWith("georgia");
    expect(typography.onSetAlwaysShowOnePage).toHaveBeenCalledWith(true);

    act(() =>
      root.render(<TypographyMenu {...typography} fontFamily="georgia" alwaysShowOnePage />),
    );
    expect(radio("Georgia").getAttribute("aria-checked")).toBe("true");
    expect(toggle.checked).toBe(true);
    act(() => toggle.click());
    expect(typography.onSetAlwaysShowOnePage).toHaveBeenLastCalledWith(false);
  });

  it("orders reader theme, page-theme previews and brightness before reading modes", () => {
    act(() => root.render(<ReaderSettingsMenu {...settings} pageTheme="sepia" />));
    expect(container.querySelector("select")).toBeNull();
    for (const label of ["White", "Sepia", "Dark"])
      expect(radio(label).querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(radio("Sepia").getAttribute("aria-checked")).toBe("true");
    const brightness = container.querySelector('input[aria-label="Brightness"]')!;
    const readerTheme = [...container.querySelectorAll('[role="menuitem"]')]
      .find(item => item.textContent?.startsWith("Reader theme"))!;
    expect(radio("Dark").compareDocumentPosition(brightness) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(readerTheme.compareDocumentPosition(radio("White")) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(brightness.compareDocumentPosition(radio("Paginated")) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    act(() => radio("Dark").click());
    expect(settings.onSetPageTheme).toHaveBeenCalledWith("dark");
  });

  it("uses the same title typography for Book options and Ambra settings", () => {
    act(() => root.render(<><TypographyMenu {...typography} /><ReaderSettingsMenu {...settings} /></>));
    const title = (text: string) => [...container.querySelectorAll<HTMLElement>("div")]
      .find(element => element.textContent === text && element.style.fontSize === "14px")!;
    const bookTitle = title("Book options");
    const settingsTitle = title("Ambra settings");
    expect(bookTitle).toBeDefined();
    expect(settingsTitle).toBeDefined();
    expect(bookTitle.style.cssText).toBe(settingsTitle.style.cssText);
    expect(bookTitle.style.fontWeight).toBe("600");
  });

  it("keeps each typography slider's engine limits and reset callback", () => {
    act(() => root.render(<TypographyMenu {...typography} />));
    for (const [label, value, min, max, step, initial, callback] of [
      [
        "Font size",
        typography.fontScale,
        ReadingTheme.MIN_FONT_SCALE,
        ReadingTheme.MAX_FONT_SCALE,
        ReadingTheme.FONT_SCALE_STEP,
        ReadingTheme.DEFAULT_FONT_SCALE,
        typography.onSetFontScale,
      ],
      [
        "Line spacing",
        typography.lineSpacing,
        ReadingTheme.MIN_LINE_SPACING,
        ReadingTheme.MAX_LINE_SPACING,
        ReadingTheme.LINE_SPACING_STEP,
        ReadingTheme.DEFAULT_LINE_SPACING,
        typography.onSetLineSpacing,
      ],
      [
        "Character spacing",
        typography.letterSpacing,
        ReadingTheme.MIN_LETTER_SPACING,
        ReadingTheme.MAX_LETTER_SPACING,
        ReadingTheme.LETTER_SPACING_STEP,
        ReadingTheme.DEFAULT_LETTER_SPACING,
        typography.onSetLetterSpacing,
      ],
      [
        "Page width",
        typography.contentWidthEm,
        ReadingTheme.MIN_CONTENT_WIDTH_EM,
        ReadingTheme.MAX_CONTENT_WIDTH_EM,
        ReadingTheme.CONTENT_WIDTH_STEP,
        ReadingTheme.DEFAULT_CONTENT_WIDTH_EM,
        typography.onSetContentWidth,
      ],
    ] as const) {
      const input = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
      expect([input.value, input.min, input.max, input.step]).toEqual(
        [value, min, max, step].map(String),
      );
      const reset = container.querySelector<HTMLButtonElement>(
        `button[aria-label="Reset ${label} to default"]`,
      )!;
      act(() => reset.click());
      expect(callback).toHaveBeenCalledWith(initial);
    }
  });

  it("routes reading mode, animation, chrome theme and brightness independently", () => {
    act(() => root.render(<ReaderSettingsMenu {...settings} />));
    act(() => radio("Scroll").click());
    act(() => radio("Film strip").click());
    act(() => radio("Blue").click());
    act(() =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Reset Brightness to default"]')!
        .click(),
    );
    expect(settings.onSetViewMode).toHaveBeenCalledWith("scroll");
    expect(settings.onSetPageTurnAnimationStyle).toHaveBeenCalledWith("scroll");
    expect(settings.onSetChromeTheme).toHaveBeenCalledWith("blue");
    expect(settings.onSetBrightness).toHaveBeenCalledWith(ReadingTheme.DEFAULT_BRIGHTNESS);
  });

  it("disables animations in scroll mode without losing the selected style", () => {
    act(() => root.render(<ReaderSettingsMenu {...settings} viewMode="scroll" />));
    for (const label of ["Slide", "Film strip", "Page flip", "Off"])
      expect(radio(label).disabled).toBe(true);
    expect(radio("Slide").getAttribute("aria-checked")).toBe("true");
    act(() => radio("Off").click());
    expect(settings.onSetPageTurnAnimationStyle).not.toHaveBeenCalled();
  });

  it("keeps fixed-layout settings but omits reading modes", () => {
    act(() => root.render(<ReaderSettingsMenu {...settings} isFixedLayout />));
    expect(radio("Paginated")).toBeUndefined();
    expect(radio("Scroll")).toBeUndefined();
    expect(radio("Film strip").disabled).toBe(false);
    expect(radio("Ambra")).toBeDefined();
    expect(container.querySelector('input[aria-label="Brightness"]')).not.toBeNull();
    expect(radio("Français")).toBeDefined();
  });
});
