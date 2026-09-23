// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReaderController } from "./ReaderController.js";

describe("ReaderController layout-only focus", () => {
  afterEach(() => document.body.replaceChildren());

  function setUp() {
    const container = document.createElement("main");
    const hostElement = document.createElement("div");
    hostElement.tabIndex = -1;
    container.append(hostElement);
    document.body.append(container);
    const node = document.createTextNode("Current reading position");
    const controller = Object.create(ReaderController.prototype);
    Object.assign(controller, {
      containerEl: container,
      spineIndex: 3,
      host: { element: hostElement, currentPosition: () => ({ node, offset: 7 }) },
      locatorResolver: { generate: vi.fn(() => ({ cfi: "saved-position" })) },
      openSpineItem: vi.fn(async () => {}),
      nativeReading: { current: () => undefined },
    });
    return { controller, hostElement, node };
  }

  it.each(["input", "button", "div"])("preserves focused shell %s outside the replaced host", async tag => {
    const { controller, node } = setUp();
    const control = document.createElement(tag);
    control.tabIndex = 0;
    document.body.append(control);
    control.focus();
    await controller.reopenForCurrentSize();
    expect(controller.locatorResolver.generate).toHaveBeenCalledWith(3, node, 7);
    expect(controller.openSpineItem).toHaveBeenCalledWith(3, {
      bridgeCfi: "saved-position", preserveFocus: true,
    });
    expect(document.activeElement).toBe(control);
  });

  it.each(["body", "html", "host", "iframe"])("restores content focus when %s held focus", async target => {
    const { controller, hostElement } = setUp();
    const frame = document.createElement("iframe");
    hostElement.append(frame);
    const element = target === "body" ? document.body : target === "html" ? document.documentElement :
      target === "host" ? hostElement : frame;
    element.tabIndex = -1;
    element.focus();
    expect(document.activeElement).toBe(element);
    await controller.reopenForCurrentSize();
    expect(controller.openSpineItem).toHaveBeenCalledWith(3, {
      bridgeCfi: "saved-position", preserveFocus: false,
    });
  });

  it("bridges a precise companion reading position rather than the visual primary on reflow", async () => {
    const { controller, node } = setUp();
    controller.nativeReading.current = () => ({ spineIndex: 4, node, offset: 12 });
    await controller.reopenForCurrentSize();
    expect(controller.locatorResolver.generate).toHaveBeenCalledWith(4, node, 12);
    expect(controller.openSpineItem).toHaveBeenCalledWith(4, {
      bridgeCfi: "saved-position", preserveFocus: false,
    });
  });
});
