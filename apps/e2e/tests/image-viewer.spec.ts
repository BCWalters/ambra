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
    const source = readerPage.frameLocator("iframe").getByRole("img", { name: "Keyboard image" });
    const dialog = readerPage.getByRole("dialog", { name: "Keyboard image" });
    const close = dialog.getByRole("button", { name: "Close", exact: true });

    for (const dismiss of ["Escape", "Enter", "click"]) {
      await expect(source).toBeFocused();
      await readerPage.keyboard.press("Enter");
      await expect(close).toBeFocused();
      for (const key of ["Tab", "Tab", "Shift+Tab", "Shift+Tab"]) {
        await readerPage.keyboard.press(key);
        await expect(close).toBeFocused();
      }
      if (dismiss === "click") {
        await close.click();
      } else {
        await readerPage.keyboard.press(dismiss);
      }
      await expect(dialog).toBeHidden();
      await expect(readerPage.locator("iframe")).toBeFocused();
      await expect(source).toBeFocused();
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
        const scale = Math.min((viewport.width * 0.9) / width, (viewport.height * 0.9) / height);
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
