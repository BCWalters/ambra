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
    MenuItemCheckbox: ({ name, value, children }: { name: string; value: string; children: ReactNode }) => {
      const menu = useContext(Context);
      const checked = menu.checkedValues?.[name]?.includes(value) ?? false;
      return <button role="menuitemcheckbox" aria-checked={checked}
        onClick={event => menu.onCheckedValueChange?.(event, { name, checkedItems: checked ? [] : [value] })}>
        {children}
      </button>;
    },
    MenuItemRadio: ({
      name,
      value,
      children,
      disabled,
    }: {
      name: string;
      value: string;
      children: ReactNode;
      disabled?: boolean;
    }) => {
      const menu = useContext(Context);
      return (
        <button
          role="menuitemradio"
          aria-checked={menu.checkedValues?.[name]?.includes(value) ?? false}
          disabled={disabled}
          onClick={(event) => menu.onCheckedValueChange?.(event, { name, checkedItems: [value] })}
        >
          {children}
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
    const checkbox = container.querySelector<HTMLButtonElement>('[role="menuitemcheckbox"]')!;
    expect(checkbox.textContent).toBe("Always show one page");
    expect(checkbox.getAttribute("aria-checked")).toBe("false");
    act(() => radio("Georgia").click());
    act(() => checkbox.click());
    expect(typography.onSetFontFamily).toHaveBeenCalledWith("georgia");
    expect(typography.onSetAlwaysShowOnePage).toHaveBeenCalledWith(true);

    act(() =>
      root.render(<TypographyMenu {...typography} fontFamily="georgia" alwaysShowOnePage />),
    );
    expect(radio("Georgia").getAttribute("aria-checked")).toBe("true");
    expect(checkbox.getAttribute("aria-checked")).toBe("true");
    act(() => checkbox.click());
    expect(typography.onSetAlwaysShowOnePage).toHaveBeenLastCalledWith(false);
  });

  it("places the controlled global page-theme select immediately before brightness", () => {
    act(() => root.render(<ReaderSettingsMenu {...settings} pageTheme="sepia" />));
    const select = container.querySelector("select")!;
    expect(select.labels?.[0]?.textContent).toBe("Page theme");
    expect(select.value).toBe("sepia");
    expect([...select.options].map(option => option.value)).toEqual(["white", "sepia", "dark"]);
    const brightness = container.querySelector('input[aria-label="Brightness"]')!;
    expect(select.compareDocumentPosition(brightness) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    act(() => {
      select.value = "dark";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(settings.onSetPageTheme).toHaveBeenCalledWith("dark");
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
        "Column width",
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
