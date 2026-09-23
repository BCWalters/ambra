import { expect, test } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";

const here = path.dirname(fileURLToPath(import.meta.url));

test("image viewer traps keyboard focus and restores the originating book image", async () => {
  const { context, readerPage } = await launchReader(
    path.resolve(here, "../fixtures/footnote.epub"),
  );
  try {
    await readerPage.evaluate(async () => {
      const doc = document.querySelector("iframe")!.contentDocument!;
      const image = doc.createElement("img");
      image.alt = "Keyboard image";
      image.tabIndex = 0;
      image.src = URL.createObjectURL(
        new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"/>'], {
          type: "image/svg+xml",
        }),
      );
      image.style.cssText = "position:absolute;top:0;left:0;width:120px;height:120px";
      doc.body.append(image);
      await image.decode();
      image.focus();
    });
    const source = readerPage
      .frameLocator("iframe")
      .first()
      .getByRole("img", { name: "Keyboard image" });
    const dialog = readerPage.getByRole("dialog", { name: "Keyboard image" });
    const close = dialog.getByRole("button", { name: "Close", exact: true });

    for (const dismiss of ["Escape", "Enter", "click"]) {
      await expect(source).toBeFocused();
      await readerPage.keyboard.press("Enter");
      await expect(close).toBeFocused();
      for (const key of ["Tab", "Tab", "Tab", "Tab", "Shift+Tab", "Shift+Tab"]) {
        await readerPage.keyboard.press(key);
        await expect
          .poll(() => dialog.evaluate((node) => node.contains(document.activeElement)))
          .toBe(true);
      }
      await close.focus();
      if (dismiss === "click") {
        await close.click();
      } else {
        await readerPage.keyboard.press(dismiss);
      }
      await expect(dialog).toBeHidden();
      await expect(readerPage.locator("iframe").first()).toBeFocused();
      await expect(source).toBeFocused();
    }
  } finally {
    await context.close();
  }
});

test("image zoom supports controls, wheel anchoring, drag, keyboard, fit and reopening", async () => {
  const { context, readerPage } = await launchReader(
    path.resolve(here, "../fixtures/footnote.epub"),
    { viewport: { width: 1200, height: 900 } },
  );
  try {
    await readerPage.emulateMedia({ reducedMotion: "reduce" });
    await readerPage.evaluate(async () => {
      const doc = document.querySelector("iframe")!.contentDocument!;
      const image = doc.createElement("img");
      image.alt = "Illustrated map";
      image.tabIndex = 0;
      image.src = URL.createObjectURL(
        new Blob(
          [
            `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
                <rect width="800" height="600" fill="#e7dcc2"/>
                <path d="M0 150Q200 80 400 210T800 200V400Q600 300 400 460T0 430Z" fill="#a8c6c3"/>
                <path d="M120 0Q190 200 330 300T600 600" fill="none" stroke="#a57959" stroke-width="12"/>
                <g fill="#514636" font-family="serif"><text x="70" y="80" font-size="42">The Northern Passage</text>
                <text x="420" y="320" font-size="25">Silver Lake</text>
                <text x="140" y="500" font-size="25">Old Forest</text></g>
              </svg>`,
          ],
          { type: "image/svg+xml" },
        ),
      );
      image.style.cssText = "position:absolute;top:0;left:0;width:160px;height:120px";
      doc.body.append(image);
      await image.decode();
      image.focus();
    });
    const source = readerPage
      .frameLocator("iframe")
      .first()
      .getByRole("img", { name: "Illustrated map" });
    await readerPage.keyboard.press("Enter");
    const dialog = readerPage.getByRole("dialog", { name: "Illustrated map" });
    const image = dialog.getByRole("img");
    const zoomIn = dialog.getByRole("button", { name: "Zoom in", exact: true });
    const zoomOut = dialog.getByRole("button", { name: "Zoom out", exact: true });
    const fit = dialog.getByRole("button", { name: "Fit to window", exact: true });
    await expect(dialog).toBeVisible();
    await expect(image).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
    await expect(zoomOut).toBeDisabled();
    const fitted = (await image.boundingBox())!;
    await zoomIn.click();
    await expect(image).toHaveCSS("transform", "matrix(1.25, 0, 0, 1.25, 0, 0)");
    expect((await image.boundingBox())!.width).toBeCloseTo(fitted.width * 1.25, 0);

    await readerPage.mouse.move(600, 400);
    await readerPage.mouse.down();
    await readerPage.mouse.move(680, 440, { steps: 4 });
    await readerPage.mouse.up();
    await expect(image).toHaveCSS("transform", "matrix(1.25, 0, 0, 1.25, 80, 40)");
    await expect(dialog).toBeVisible();
    await readerPage.mouse.move(600, 400);
    await readerPage.mouse.down();
    await readerPage.mouse.move(1190, 890, { steps: 4 });
    await readerPage.mouse.up();
    await expect(dialog).toBeVisible();
    await expect(image).toHaveCSS("transform", "matrix(1.25, 0, 0, 1.25, 90, 94.5)");
    await fit.click();
    await expect(image).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
    const wheelEvent = image.evaluate(
      (img) =>
        new Promise<{ deltaY: number; deltaMode: number }>((resolve) => {
          img.parentElement!.addEventListener(
            "wheel",
            (event) => {
              resolve({ deltaY: event.deltaY, deltaMode: event.deltaMode });
            },
            { once: true },
          );
        }),
    );
    await readerPage.mouse.move(750, 350);
    await readerPage.mouse.wheel(0, -100);
    const wheel = await wheelEvent;
    expect(wheel.deltaMode).toBe(0);
    // Chromium's native wheel deltas can vary with the host's pixel density.
    const wheelScale = Math.exp(-Math.max(-200, Math.min(200, wheel.deltaY)) * 0.005);
    await expect
      .poll(() => image.evaluate((img) => new DOMMatrix(getComputedStyle(img).transform).a))
      .toBeCloseTo(wheelScale, 4);
    const matrix = await image.evaluate((img) => {
      const m = new DOMMatrix(getComputedStyle(img).transform);
      return { x: m.e, y: m.f };
    });
    expect(matrix.x).toBeCloseTo((750 - fitted.x - fitted.width / 2) * (1 - wheelScale), 2);
    expect(matrix.y).toBeCloseTo((350 - fitted.y - fitted.height / 2) * (1 - wheelScale), 2);

    await fit.focus();
    await readerPage.keyboard.press("0");
    await readerPage.keyboard.press("+");
    await readerPage.keyboard.press("ArrowRight");
    await expect(image).toHaveCSS("transform", "matrix(1.25, 0, 0, 1.25, -40, 0)");
    await expect(dialog).toBeVisible();
    await expect(image).toHaveCSS("transition-duration", "0s");
    await dialog.screenshot({ path: test.info().outputPath("image-zoom.png") });
    await readerPage.keyboard.press("0");
    await expect(image).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
    expect((await image.boundingBox())!.width).toBeCloseTo(fitted.width, 0);
    await readerPage.keyboard.press("+");
    await readerPage.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(source).toBeFocused();
    await readerPage.keyboard.press("Enter");
    await expect(image).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(source).toBeFocused();
  } finally {
    await context.close();
  }
});

for (const [width, height] of [
  [120, 120],
  [240, 120],
  [120, 240],
  [4000, 2000],
] as const) {
  test(`image viewer fits a ${width}×${height} image and refits on resize`, async () => {
    const { context, readerPage } = await launchReader(
      path.resolve(here, "../fixtures/footnote.epub"),
      {
        viewport: { width: 1200, height: 900 },
      },
    );
    try {
      const source = await readerPage.evaluate(
        async ({ width, height }) => {
          const doc = document.querySelector("iframe")!.contentDocument!;
          const image = doc.createElement("img");
          image.alt = "Viewer test image";
          image.src = URL.createObjectURL(
            new Blob(
              [
                `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="teal"/></svg>`,
              ],
              { type: "image/svg+xml" },
            ),
          );
          image.style.cssText = "position:absolute;top:0;left:0;width:120px;height:120px";
          doc.body.append(image);
          await image.decode();
          image.click();
          return image.src;
        },
        { width, height },
      );

      const dialog = readerPage.getByRole("dialog", { name: "Viewer test image" });
      const image = dialog.getByRole("img");
      await expect(dialog).toBeVisible();
      for (const viewport of [
        { width: 1200, height: 900 },
        { width: 700, height: 1000 },
      ]) {
        await readerPage.setViewportSize(viewport);
        const scale = Math.min((viewport.width * 0.9) / width, (viewport.height - 144) / height);
        await expect
          .poll(async () => {
            const box = await image.boundingBox();
            return (
              box !== null &&
              Math.abs(box.width - width * scale) < 1 &&
              Math.abs(box.height - height * scale) < 1
            );
          })
          .toBe(true);
      }
      await image.click();
      await expect(dialog).toBeVisible();
      await readerPage.mouse.click(8, 500);
      await expect(dialog).toBeHidden();
      await readerPage.evaluate((src) => URL.revokeObjectURL(src), source);
    } finally {
      await context.close();
    }
  });
}

test("image fit respects a pinned contents pane and narrow translated controls", async () => {
  const { context, readerPage } = await launchReader(
    path.resolve(here, "../fixtures/footnote.epub"),
    { viewport: { width: 1200, height: 900 } },
  );
  try {
    await readerPage.getByRole("button", { name: "Show contents", exact: true }).click();
    await readerPage.getByRole("button", { name: "Pin contents panel", exact: true }).click();
    await readerPage.getByRole("button", { name: "Settings", exact: true }).click();
    await readerPage.getByRole("menuitem", { name: /^Language/ }).click();
    await readerPage.getByRole("menuitemradio", { name: "Deutsch", exact: true }).click();
    await expect(readerPage.locator("html")).toHaveAttribute("lang", "de");
    await readerPage.evaluate(async () => {
      const doc = document.querySelector("iframe")!.contentDocument!;
      const image = doc.createElement("img");
      image.alt = "Wide map";
      image.src = URL.createObjectURL(
        new Blob(
          [
            '<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="1000"><rect x="5" y="5" width="3990" height="990" fill="teal" stroke="gold" stroke-width="10"/></svg>',
          ],
          { type: "image/svg+xml" },
        ),
      );
      image.style.cssText = "position:absolute;top:0;left:0;width:160px;height:120px";
      doc.body.append(image);
      await image.decode();
      image.click();
    });
    const dialog = readerPage.getByRole("dialog", { name: "Wide map" });
    const image = dialog.getByRole("img");
    const controls = dialog.getByRole("group");
    const fit = dialog.getByRole("button", { name: "An Fenster anpassen", exact: true });
    const zoomIn = dialog.locator('button[aria-keyshortcuts="+ ="]');
    for (const width of [1200, 500]) {
      await readerPage.setViewportSize({ width, height: 900 });
      await expect
        .poll(async () => {
          const pane = (await dialog.boundingBox())!;
          const box = (await image.boundingBox())!;
          const canvas = (await image.locator("..").boundingBox())!;
          return (
            pane.width < width &&
            Math.abs(box.width - pane.width * 0.9) < 1 &&
            Math.abs(box.width / box.height - 4) < 0.01 &&
            box.x >= canvas.x &&
            box.x + box.width <= canvas.x + canvas.width &&
            box.y >= canvas.y &&
            box.y + box.height <= canvas.y + canvas.height
          );
        })
        .toBe(true);
      const pane = (await dialog.boundingBox())!;
      const toolbar = (await controls.boundingBox())!;
      const canvas = (await image.locator("..").boundingBox())!;
      expect(toolbar.x).toBeGreaterThanOrEqual(pane.x);
      expect(toolbar.x + toolbar.width).toBeLessThanOrEqual(pane.x + pane.width);
      expect(canvas.y + canvas.height).toBeLessThanOrEqual(toolbar.y);
      for (const button of await controls.getByRole("button").all()) {
        const box = (await button.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(toolbar.x);
        expect(box.x + box.width).toBeLessThanOrEqual(toolbar.x + toolbar.width);
      }
      await zoomIn.click();
      await readerPage.keyboard.press("ArrowRight");
      await expect
        .poll(() =>
          image.evaluate((img) => {
            const matrix = new DOMMatrix(getComputedStyle(img).transform);
            return matrix.a === 1.25 && matrix.e < 0;
          }),
        )
        .toBe(true);
      await fit.click();
      await expect(image).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
    }
    await dialog.screenshot({ path: test.info().outputPath("image-zoom-narrow.png") });
  } finally {
    await context.close();
  }
});
