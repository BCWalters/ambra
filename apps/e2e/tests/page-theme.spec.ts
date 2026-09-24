import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

const alice = fileURLToPath(new URL("../real-books/alice-in-wonderland.epub", import.meta.url));
const fixed = fileURLToPath(new URL("../fixtures/fxl-spread-ltr.epub", import.meta.url));
const palettes = {
  White: ["rgb(255, 255, 255)", "rgb(26, 26, 26)", "rgb(11, 87, 164)"],
  Sepia: ["rgb(250, 247, 241)", "rgb(35, 32, 25)", "rgb(42, 93, 176)"],
  Dark: ["rgb(35, 35, 35)", "rgb(232, 230, 225)", "rgb(138, 180, 248)"],
} as const;

async function canvasColors(page: Page) {
  return page.evaluate(() => {
    const controller = Reflect.get(window, "__readerController");
    return (controller.contentDocumentViews() as { document: Document }[]).map(({ document: doc }) => {
      const style = doc.defaultView!.getComputedStyle(doc.body);
      return [style.backgroundColor, style.color];
    });
  });
}

for (const mode of ["single", "spread", "scroll"] as const) {
  test(`#185 Alice page palettes override publisher resets in ${mode} mode`, async () => {
    const { context, readerPage: page } = await launchReader(alice, {
      viewport: { width: mode === "spread" ? 1400 : 900, height: 900 },
    });
    try {
      await exposeReaderController(page);
      await page.evaluate(async mode => {
        const controller = Reflect.get(window, "__readerController");
        if (mode === "scroll") await controller.setViewMode("scroll");
        await controller.openSpineItem(3);
      }, mode);
      const frameCount = mode === "spread" ? 2 : 1;
      await expect.poll(async () => (await canvasColors(page)).length).toBe(frameCount);
      await page.evaluate(() => {
        const controller = Reflect.get(window, "__readerController");
        for (const { document: doc } of controller.contentDocumentViews() as { document: Document }[]) {
          const style = doc.createElement("style");
          style.textContent = `.ambra-color-probe { position: fixed; visibility: hidden; }
            .ambra-color-probe p { color: red; background-color: yellow; }
            .ambra-color-probe a { color: blue; }`;
          doc.head.appendChild(style);
          const probe = doc.createElement("aside");
          probe.className = "ambra-color-probe";
          probe.innerHTML = `<p>Publisher warning</p><a href="#note">Publisher link</a>
            <svg xmlns="http://www.w3.org/2000/svg"><a href="#diagram" style="color: purple">
              <rect fill="green" width="10" height="10"/></a></svg>`;
          doc.body.appendChild(probe);
        }
      });
      await page.getByRole("button", { name: "Text and page options", exact: true }).click();
      await page.getByRole("menuitem", { name: "Page", exact: true }).press("ArrowRight");
      for (const name of ["Sepia", "White", "Dark"] as const) {
        const choice = page.getByRole("menuitemradio", { name, exact: true });
        await choice.click();
        await expect(choice).toHaveAttribute("aria-checked", "true");
        const [background, foreground, link] = palettes[name];
        await expect.poll(() => canvasColors(page)).toEqual(
          Array.from({ length: frameCount }, () => [background, foreground]),
        );
        const details = await page.evaluate(() => {
          const controller = Reflect.get(window, "__readerController");
          return (controller.contentDocumentViews() as { document: Document }[]).map(({ document: doc }) => {
            const style = (selector: string) => doc.defaultView!.getComputedStyle(doc.querySelector(selector)!);
            return {
              canvas: style("html").backgroundColor,
              text: style("body > div.chapter p, body p").color,
              link: style(".ambra-color-probe > a").color,
              warning: [style(".ambra-color-probe p").color, style(".ambra-color-probe p").backgroundColor],
              diagram: style(".ambra-color-probe rect").fill,
              diagramLink: style(".ambra-color-probe svg a").color,
              filter: style("body").filter,
            };
          });
        });
        expect(details).toEqual(Array.from({ length: frameCount }, () => ({
          canvas: background, text: foreground, link,
          warning: ["rgb(255, 0, 0)", "rgb(255, 255, 0)"],
          diagram: "rgb(0, 128, 0)", diagramLink: "rgb(128, 0, 128)", filter: "none",
        })));
      }
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await page.screenshot({ path: test.info().outputPath(`alice-${mode}-dark.png`) });
      await page.evaluate(() => Reflect.get(window, "__readerController").flushProgress());
      await page.reload();
      await expect(page.getByRole("button", { name: "Text and page options", exact: true })).toBeVisible();
      await exposeReaderController(page);
      await expect.poll(() => canvasColors(page)).toEqual(
        Array.from({ length: frameCount }, () => palettes.Dark.slice(0, 2)),
      );
      await page.evaluate(() => Reflect.get(window, "__readerController").goToChapter(1));
      await expect.poll(() => canvasColors(page)).toEqual(
        Array.from({ length: frameCount }, () => palettes.Dark.slice(0, 2)),
      );
    } finally {
      await context.close();
    }
  });
}

test("#185 page palettes leave fixed-layout publisher pages unchanged", async () => {
  const { context, readerPage: page } = await launchReader(fixed);
  try {
    await exposeReaderController(page);
    const before = await canvasColors(page);
    expect(before.length).toBeGreaterThan(0);
    await page.evaluate(() => Reflect.get(window, "__readerController").setPageTheme("dark"));
    expect(await canvasColors(page)).toEqual(before);
    expect(await page.evaluate(() => Array.from(document.querySelectorAll("iframe")).every(frame =>
      !frame.contentDocument?.documentElement.hasAttribute("data-ambra-page-theme"),
    ))).toBe(true);
  } finally {
    await context.close();
  }
});
