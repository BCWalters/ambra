import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AmbraSettingsPopover, type AmbraSettingsPopoverProps } from "./AmbraSettingsPopover.js";
import { DEFAULT_GLOBAL_READING_SETTINGS } from "../library/ReadingSettings.js";
import { ReadingTheme } from "@ambra/engine";

describe("Shared Ambra settings presentation", () => {
  let container: HTMLDivElement;
  let root: Root;
  let initialized: boolean;
  const onChange = vi.fn();
  const onOpenChange = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    onChange.mockReset();
    onOpenChange.mockReset();
    initialized = false;
    const animate = Element.prototype.animate;
    vi.spyOn(Element.prototype, "animate").mockImplementation(function (this: Element, keyframes, options) {
      const animation = animate.call(this, keyframes, options);
      vi.spyOn(animation, "cancel").mockImplementation(() => animation.finish());
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
  async function render(props: Partial<AmbraSettingsPopoverProps> = {}) {
    if (!initialized) {
      initialized = true;
      await act(async () => root.render(<FluentProvider theme={webLightTheme}>
        <AmbraSettingsPopover settings={DEFAULT_GLOBAL_READING_SETTINGS}
          onChange={onChange} onOpenChange={onOpenChange} {...props} open={false} />
      </FluentProvider>));
    }
    await act(async () => root.render(<FluentProvider theme={webLightTheme}>
      <AmbraSettingsPopover open settings={DEFAULT_GLOBAL_READING_SETTINGS}
        onChange={onChange} onOpenChange={onOpenChange} {...props} />
    </FluentProvider>));
  }
  it("leads library settings with interface choices and collapsed reading preferences", async () => {
    await render();
    expect(document.querySelector("select")?.value).toBe("ambra");
    expect(document.querySelector("details")?.open).toBe(false);
  });
  it("leads reader settings with expanded reading preferences and focuses Page theme", async () => {
    await render({ readingFirst: true });
    const theme = document.querySelector("select")!;
    expect(theme.value).toBe("white");
    expect(document.querySelector("details")?.open).toBe(true);
    expect(document.activeElement).toBe(theme);
    await act(async () => {
      theme.value = "sepia";
      theme.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith({ pageTheme: "sepia" });
  });
  it("keeps controlled-open ownership with the reader root", async () => {
    await render({ readingFirst: true });
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape", bubbles: true, cancelable: true,
    })));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    await render({ open: false, readingFirst: true });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it("omits reflowable reading mode for fixed layout and retains the other global settings", async () => {
    await render({ readingFirst: true, isFixedLayout: true });
    expect(document.querySelectorAll("select")).toHaveLength(5);
    expect(document.querySelector('option[value="paginated"]')).toBeNull();
    expect(document.querySelector('option[value="sepia"]')).not.toBeNull();
  });

  it.each([false, true])("keeps brightness reset focus inside settings and Escape closes it (reading first: %s)", async (readingFirst) => {
    function ResetSettings() {
      const [settings, setSettings] = useState({ ...DEFAULT_GLOBAL_READING_SETTINGS, brightness: 0.7 });
      const [open, setOpen] = useState(false);
      return <AmbraSettingsPopover settings={settings} readingFirst={readingFirst}
        {...(readingFirst ? { open, onOpenChange: setOpen } : {})}
        onChange={(patch) => { onChange(patch); setSettings((current) => ({ ...current, ...patch })); }} />;
    }
    await act(async () => root.render(<FluentProvider theme={webLightTheme}><ResetSettings /></FluentProvider>));
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="Ambra settings"]')!;
    await act(async () => { trigger.focus(); trigger.click(); });
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    if (!readingFirst) await act(async () => dialog.querySelector("summary")!.click());
    expect(dialog.querySelector("details")!.open).toBe(true);
    const slider = dialog.querySelector<HTMLInputElement>('input[aria-label="Brightness"]')!;
    const reset = dialog.querySelector<HTMLButtonElement>('button[aria-label="Reset Brightness to default"]')!;
    expect(reset.disabled).toBe(false);
    await act(async () => { reset.focus(); reset.click(); });
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ brightness: ReadingTheme.DEFAULT_BRIGHTNESS });
    expect(slider.value).toBe(String(ReadingTheme.DEFAULT_BRIGHTNESS));
    expect(reset.disabled).toBe(true);
    expect(document.activeElement).toBe(slider);
    expect(dialog.contains(document.activeElement)).toBe(true);
    await act(async () => reset.click());
    expect(onChange).toHaveBeenCalledOnce();
    await act(async () => slider.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape", bubbles: true, cancelable: true,
    })));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
