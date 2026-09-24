import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ReaderSettingsMenu, TypographyMenu } from "./ReaderPreferencesMenus.js";
import { ModalFlyout } from "../../components/ModalFlyout.js";

let root: Root;
let container: HTMLDivElement;
let closeMenu: () => void;
let open: boolean;
const noop = () => {};

function Harness({ typography }: { typography: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false);
  open = menuOpen;
  closeMenu = () => setMenuOpen(false);
  const controlled = { open: menuOpen, onOpenChange: setMenuOpen };
  return typography
    ? <TypographyMenu {...controlled} fontScale={1} lineSpacing={1.5} letterSpacing={0}
        contentWidthEm={40} fontFamily="book-default" pageTheme="white"
        onSetFontScale={noop} onSetLineSpacing={noop} onSetLetterSpacing={noop}
        onSetContentWidth={noop} onSetFontFamily={noop} onSetPageTheme={noop} />
    : <ReaderSettingsMenu {...controlled} isFixedLayout={false} viewMode="paginated"
        brightness={1} chromeTheme="silver" pageTurnAnimationStyle="slide"
        onSetViewMode={noop} onSetBrightness={noop} onSetChromeTheme={noop}
        onSetPageTurnAnimationStyle={noop} />;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const animate = Element.prototype.animate;
  vi.spyOn(Element.prototype, "animate").mockImplementation(function (this: Element, keyframes, options) {
    const animation = animate.call(this, keyframes, options);
    void animation.finished.catch(() => undefined);
    queueMicrotask(() => animation.finish());
    return animation;
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("dismisses the Settings tooltip before handing Escape ownership to its menu and Help", async () => {
  vi.useFakeTimers();
  const closeHelp = vi.fn();
  function HelpHarness() {
    const [helpOpen, setHelpOpen] = useState(false);
    return <FluentProvider theme={webLightTheme}>
      <ReaderSettingsMenu isFixedLayout={false} viewMode="paginated"
        brightness={1} chromeTheme="silver" pageTurnAnimationStyle="slide"
        onSetViewMode={noop} onSetBrightness={noop} onSetChromeTheme={noop}
        onSetPageTurnAnimationStyle={noop} onOpenHelp={() => setHelpOpen(true)} />
      <ModalFlyout open={helpOpen} title="Help" backgroundSolid="#fff" onRequestClose={closeHelp}>
        <button>Help content</button>
      </ModalFlyout>
    </FluentProvider>;
  }
  await act(async () => root.render(<HelpHarness />));
  const settings = container.querySelector<HTMLButtonElement>("button")!;
  await act(async () => {
    settings.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));
    await vi.advanceTimersByTimeAsync(300);
  });
  expect(document.querySelector('[role="tooltip"]')?.textContent).toBe("Settings");
  await act(async () => settings.click());
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
  const helpItem = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    .find(item => item.textContent === "Help & About")!;
  await act(async () => helpItem.click());
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
  const helpButton = document.querySelector<HTMLButtonElement>('[role="dialog"] button')!;
  await act(async () => helpButton.dispatchEvent(new KeyboardEvent("keydown", {
    key: "Escape", bubbles: true, cancelable: true,
  })));
  expect(closeHelp).toHaveBeenCalledOnce();
});

it.each([false, true])("lets the reading shell close a real Fluent menu (typography=%s)", async typography => {
  await act(async () => root.render(<Harness typography={typography} />));
  await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
  expect(open).toBe(true);
  expect(document.querySelector('[role="menu"]')).not.toBeNull();
  await act(async () => closeMenu());
  expect(open).toBe(false);
  expect(document.querySelector('[role="menu"]')).toBeNull();
});
