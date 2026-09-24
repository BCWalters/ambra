import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ReaderSettingsMenu, TypographyMenu } from "./ReaderPreferencesMenus.js";

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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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
