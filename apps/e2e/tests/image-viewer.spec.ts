import { expect, test, type Locator } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { currentPageLabel, launchReader } from "../harness.js";

const here = path.dirname(fileURLToPath(import.meta.url));

async function scrollState(image: Locator) {
  return image.evaluate((img) => {
    const viewport = img.parentElement!.parentElement!;
    return {
      left: viewport.scrollLeft,
      top: viewport.scrollTop,
      maxLeft: viewport.scrollWidth - viewport.clientWidth,
      maxTop: viewport.scrollHeight - viewport.clientHeight,
    };
  });
}

for (const format of ["svg", "png"] as const) {
  test(`transparent ${format} images have a white viewer backing in every page theme (#226)`, async () => {
    const { context, readerPage } = await launchReader(
      path.resolve(here, "../fixtures/footnote.epub"),
    );
    try {
      for (const theme of ["White", "Sepia", "Dark"]) {
        await readerPage.getByRole("button", { name: "Settings", exact: true }).click();
        await readerPage.getByRole("menuitem", { name: /^Page theme/ }).click();
        await readerPage.getByRole("menuitemradio", { name: theme, exact: true }).click();
        await readerPage.keyboard.press("Escape");
        await readerPage.keyboard.press("Escape");
        const src = await readerPage.evaluate(async (format) => {
          const doc = document.querySelector("iframe")!.contentDocument!;
          const image = doc.createElement("img");
          image.alt = "Transparent illustration";
          const svg = URL.createObjectURL(
            new Blob(
              [
                '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120"><path d="M60 90L120 30L180 90Z" fill="none" stroke="black" stroke-width="4"/></svg>',
              ],
              { type: "image/svg+xml" },
            ),
          );
          image.src = svg;
          await image.decode();
          if (format === "png") {
            const canvas = doc.createElement("canvas");
            canvas.width = 240;
            canvas.height = 120;
            canvas.getContext("2d")!.drawImage(image, 0, 0);
            const blob = await new Promise<Blob>((resolve, reject) => {
              canvas.toBlob((blob) => {
                if (blob) resolve(blob);
                else reject(new Error("Could not encode transparent PNG fixture"));
              }, "image/png");
            });
            image.src = URL.createObjectURL(blob);
            await image.decode();
            URL.revokeObjectURL(svg);
          }
          image.style.cssText = "position:absolute;top:0;left:0;width:240px;height:120px";
          doc.body.append(image);
          image.click();
          return image.src;
        }, format);
        const dialog = readerPage.getByRole("dialog", { name: "Transparent illustration" });
        const image = dialog.getByRole("img");
        await expect(image).toBeVisible();
        await expect(image).toHaveCSS("background-color", "rgb(255, 255, 255)");
        await expect(dialog).toHaveCSS("background-color", "rgba(10, 8, 6, 0.82)");
        await dialog.getByRole("button", { name: "Zoom in", exact: true }).click();
        await expect(dialog.locator("output")).toHaveText("125%");
        await expect(image).toHaveCSS("background-color", "rgb(255, 255, 255)");
        await dialog.getByRole("button", { name: "Fit to window", exact: true }).click();
        await expect(dialog.locator("output")).toHaveText("100%");
        await expect(image).toHaveCSS("background-color", "rgb(255, 255, 255)");
        await dialog.screenshot({
          path: test.info().outputPath(`transparent-${format}-${theme}.png`),
        });
        await dialog.getByRole("button", { name: "Close", exact: true }).click();
        await expect(dialog).toBeHidden();
        const source = readerPage
          .frameLocator("iframe")
          .first()
          .getByRole("img", { name: "Transparent illustration" });
        await expect(source).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
        await source.evaluate((img) => img.remove());
        await readerPage.evaluate((src) => URL.revokeObjectURL(src), src);
      }
    } finally {
      await context.close();
    }
  });
}

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
    { viewport: { width: 1200, height: 900 }, showScrollbars: true },
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
    await expect(image).toHaveCSS("transform", "none");
    await expect(zoomOut).toBeDisabled();
    expect(await scrollState(image)).toEqual({ left: 0, top: 0, maxLeft: 0, maxTop: 0 });
    const fitted = (await image.boundingBox())!;
    await zoomIn.click();
    await expect(dialog.locator("output")).toHaveText("125%");
    expect((await image.boundingBox())!.width).toBeCloseTo(fitted.width * 1.25, 0);
    const zoomed = await scrollState(image);
    expect(zoomed.maxLeft).toBeGreaterThan(0);
    expect(zoomed.maxTop).toBeGreaterThan(0);

    await readerPage.mouse.move(600, 400);
    await readerPage.mouse.down();
    await readerPage.mouse.move(680, 440, { steps: 4 });
    await readerPage.mouse.up();
    const dragged = await scrollState(image);
    expect(dragged.left).toBeCloseTo(Math.max(0, zoomed.left - 80), 0);
    expect(dragged.top).toBeCloseTo(Math.max(0, zoomed.top - 40), 0);
    await expect(dialog).toBeVisible();
    await readerPage.mouse.move(600, 400);
    await readerPage.mouse.down();
    await readerPage.mouse.move(1190, 890, { steps: 4 });
    await readerPage.mouse.up();
    await expect(dialog).toBeVisible();
    expect((await scrollState(image)).left).toBe(0);
    expect((await scrollState(image)).top).toBe(0);
    await fit.click();
    expect(await scrollState(image)).toEqual({ left: 0, top: 0, maxLeft: 0, maxTop: 0 });
    const wheelEvent = image.evaluate(
      (img) =>
        new Promise<{ deltaY: number; deltaMode: number }>((resolve) => {
          img.parentElement!.parentElement!.addEventListener(
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
      .poll(async () => (await image.boundingBox())!.width / fitted.width)
      .toBeCloseTo(wheelScale, 3);
    const wheeled = (await image.boundingBox())!;
    expect(Math.abs(wheeled.x + (750 - fitted.x) * wheelScale - 750)).toBeLessThan(1);
    expect(Math.abs(wheeled.y + (350 - fitted.y) * wheelScale - 350)).toBeLessThan(1);

    // A native scroll (e.g. scrollbar thumb) must become the next pan/zoom origin.
    await image.evaluate((img) => {
      const viewport = img.parentElement!.parentElement!;
      viewport.scrollLeft = 10;
      viewport.scrollTop = 20;
    });
    await fit.focus();
    await readerPage.keyboard.press("ArrowRight");
    await readerPage.keyboard.press("ArrowDown");
    expect((await scrollState(image)).left).toBe(50);
    expect((await scrollState(image)).top).toBe(60);
    for (const axis of ["vertical", "horizontal"]) {
      const before = await scrollState(image);
      const thumb = await image.evaluate((img, axis) => {
        const viewport = img.parentElement!.parentElement!;
        const box = viewport.getBoundingClientRect();
        const vertical = axis === "vertical";
        const size = vertical ? viewport.clientHeight : viewport.clientWidth;
        const content = vertical ? viewport.scrollHeight : viewport.scrollWidth;
        const offset = vertical ? viewport.scrollTop : viewport.scrollLeft;
        return {
          gutter: vertical ? box.width - viewport.clientWidth : box.height - viewport.clientHeight,
          x:
            box.x +
            (vertical
              ? (box.width + viewport.clientWidth) / 2
              : ((offset + size / 2) * size) / content),
          y:
            box.y +
            (vertical
              ? ((offset + size / 2) * size) / content
              : (box.height + viewport.clientHeight) / 2),
        };
      }, axis);
      expect(thumb.gutter).toBeGreaterThan(0);
      await readerPage.mouse.move(thumb.x, thumb.y);
      await readerPage.mouse.down();
      await readerPage.mouse.move(
        thumb.x + (axis === "horizontal" ? 25 : 0),
        thumb.y + (axis === "vertical" ? 25 : 0),
        { steps: 4 },
      );
      await readerPage.mouse.up();
      await expect
        .poll(async () => {
          const after = await scrollState(image);
          return axis === "vertical" ? after.top > before.top : after.left > before.left;
        })
        .toBe(true);
      await expect(dialog).toBeVisible();
    }
    const scrolled = (await image.boundingBox())!;
    await readerPage.mouse.move(650, 350);
    await readerPage.mouse.wheel(0, -50);
    await expect
      .poll(async () => (await image.boundingBox())!.width)
      .toBeGreaterThan(scrolled.width);
    const rezoomed = (await image.boundingBox())!;
    const ratio = rezoomed.width / scrolled.width;
    expect(Math.abs(rezoomed.x + (650 - scrolled.x) * ratio - 650)).toBeLessThan(1);
    expect(Math.abs(rezoomed.y + (350 - scrolled.y) * ratio - 350)).toBeLessThan(1);

    await fit.focus();
    await readerPage.keyboard.press("0");
    await readerPage.keyboard.press("+");
    const beforeArrow = await scrollState(image);
    await readerPage.keyboard.press("ArrowRight");
    expect((await scrollState(image)).left).toBe(
      Math.min(beforeArrow.maxLeft, beforeArrow.left + 40),
    );
    await expect(dialog).toBeVisible();
    await expect(image).toHaveCSS("transition-duration", "0s");
    await dialog.screenshot({ path: test.info().outputPath("image-zoom.png") });
    await readerPage.keyboard.press("0");
    expect(await scrollState(image)).toEqual({ left: 0, top: 0, maxLeft: 0, maxTop: 0 });
    expect((await image.boundingBox())!.width).toBeCloseTo(fitted.width, 0);
    await readerPage.keyboard.press("+");
    await readerPage.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(source).toBeFocused();
    await readerPage.keyboard.press("Enter");
    expect(await scrollState(image)).toEqual({ left: 0, top: 0, maxLeft: 0, maxTop: 0 });
    await zoomIn.click();
    await image.evaluate((img) => {
      const viewport = img.parentElement!.parentElement!;
      viewport.scrollLeft = viewport.scrollWidth;
      viewport.scrollTop = viewport.scrollHeight;
      // Resize just the canvas, keeping the injected source in the book alive.
      viewport.parentElement!.style.height = "400px";
    });
    await expect.poll(async () => (await scrollState(image)).maxLeft).toBe(0);
    expect((await scrollState(image)).left).toBe(0);
    expect((await scrollState(image)).maxTop).toBeGreaterThan(0);
    await expect(dialog.locator("output")).toHaveText("125%");
    await image.evaluate((img) => {
      img.parentElement!.parentElement!.parentElement!.style.height = "";
    });
    await fit.click();
    expect(await scrollState(image)).toEqual({ left: 0, top: 0, maxLeft: 0, maxTop: 0 });
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(source).toBeFocused();
  } finally {
    await context.close();
  }
});

test("image viewer blocks reader page and chapter shortcuts in both documents (#143)", async () => {
  // Unlike the single-page footnote book, both chapters have many real pages:
  // leaked arrows must visibly move the reader rather than hit a book boundary.
  const { context, readerPage } = await launchReader(
    path.resolve(here, "../fixtures/two-chapter.epub"),
    { viewport: { width: 1200, height: 900 } },
  );
  try {
    await readerPage.emulateMedia({ reducedMotion: "reduce" });
    const chapter = () => readerPage.locator("iframe").first().getAttribute("title");
    const firstChapter = await chapter();
    for (const direction of ["ArrowRight", "ArrowLeft"]) {
      const start = await currentPageLabel(readerPage);
      await readerPage.keyboard.press("ArrowRight");
      await expect.poll(() => currentPageLabel(readerPage)).not.toBe(start);
      const position = await currentPageLabel(readerPage);
      const title = await chapter();
      expect(position).toMatch(/Page \d+ of \d+/);
      await readerPage.evaluate(async () => {
        const doc = document.querySelector("iframe")!.contentDocument!;
        const image = doc.createElement("img");
        image.alt = "Navigation isolation map";
        image.tabIndex = 0;
        image.src = URL.createObjectURL(
          new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"/>'], {
            type: "image/svg+xml",
          }),
        );
        image.style.cssText = "position:absolute;top:0;left:0;width:160px;height:120px";
        doc.body.append(image);
        await image.decode();
        image.click();
      });
      const dialog = readerPage.getByRole("dialog", { name: "Navigation isolation map" });
      const image = dialog.getByRole("img");
      await expect(dialog).toBeVisible();
      await readerPage.keyboard.press("+");
      await readerPage.keyboard.press("+");
      const beforePan = await scrollState(image);
      await readerPage.keyboard.press(direction);
      expect((await scrollState(image)).left).not.toBe(beforePan.left);
      expect(await currentPageLabel(readerPage)).toBe(position);

      for (const scope of ["shell", "iframe"]) {
        for (const modifier of ["plain", "ctrl", "meta", "space", "alt"]) {
          // Simulate stale focus outside React's dialog boundary. These events
          // reach the real AccessibilityControllers in each document.
          await readerPage.evaluate(
            ({ scope, modifier, direction }) => {
              const doc =
                scope === "shell" ? document : document.querySelector("iframe")!.contentDocument!;
              doc.body.dispatchEvent(
                new KeyboardEvent("keydown", {
                  key:
                    modifier === "space"
                      ? " "
                      : modifier === "alt"
                        ? direction === "ArrowRight"
                          ? "PageDown"
                          : "PageUp"
                        : direction,
                  altKey: modifier === "alt",
                  ctrlKey: modifier === "ctrl",
                  metaKey: modifier === "meta",
                  shiftKey: modifier === "space" && direction === "ArrowLeft",
                  bubbles: true,
                  cancelable: true,
                }),
              );
            },
            { scope, modifier, direction },
          );
          await readerPage.waitForTimeout(200);
          expect(await currentPageLabel(readerPage), `${scope} ${modifier} ${direction}`).toBe(
            position,
          );
          expect(await chapter()).toBe(title);
          await expect(dialog).toBeVisible();
        }
      }
      if (direction === "ArrowRight") await readerPage.keyboard.press("Escape");
      else await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await expect(dialog).toBeHidden();
      await readerPage.keyboard.press(direction);
      await expect.poll(() => currentPageLabel(readerPage)).not.toBe(position);
      const resumed = await currentPageLabel(readerPage);
      await readerPage.evaluate(() => {
        document.body.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "ArrowRight",
            bubbles: true,
            cancelable: true,
          }),
        );
      });
      await expect.poll(() => currentPageLabel(readerPage)).not.toBe(resumed);
      // Modified shortcuts also resume, in both directions across a real spine boundary.
      await readerPage.keyboard.press(direction === "ArrowRight" ? "Alt+PageDown" : "Alt+PageUp");
      await expect.poll(chapter).not.toBe(title);
      if (direction === "ArrowLeft") expect(await chapter()).toBe(firstChapter);
    }
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
          const canvas = (await image.locator("xpath=../../..").boundingBox())!;
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
      const canvas = (await image.locator("xpath=../../..").boundingBox())!;
      expect(toolbar.x).toBeGreaterThanOrEqual(pane.x);
      expect(toolbar.x + toolbar.width).toBeLessThanOrEqual(pane.x + pane.width);
      expect(canvas.y + canvas.height).toBeLessThanOrEqual(toolbar.y);
      for (const button of await controls.getByRole("button").all()) {
        const box = (await button.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(toolbar.x);
        expect(box.x + box.width).toBeLessThanOrEqual(toolbar.x + toolbar.width);
      }
      const fitted = (await image.boundingBox())!;
      await readerPage.mouse.move(fitted.x + fitted.width / 2, fitted.y + fitted.height / 2);
      await readerPage.mouse.wheel(0, -5);
      await expect
        .poll(async () => (await image.boundingBox())!.width)
        .toBeGreaterThan(fitted.width);
      // A slight enlargement still fits: neither axis should acquire a scrollbar.
      expect(await scrollState(image)).toEqual({ left: 0, top: 0, maxLeft: 0, maxTop: 0 });
      await fit.click();
      await zoomIn.click();
      await readerPage.keyboard.press("ArrowRight");
      await expect
        .poll(() => scrollState(image).then((state) => state.left > 0 && state.maxLeft > 0))
        .toBe(true);
      expect((await scrollState(image)).maxTop).toBe(0);
      await fit.click();
      expect(await scrollState(image)).toEqual({ left: 0, top: 0, maxLeft: 0, maxTop: 0 });
    }
    await dialog.screenshot({ path: test.info().outputPath("image-zoom-narrow.png") });
  } finally {
    await context.close();
  }
});
