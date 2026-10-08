import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { clickReadingPage, launchReader } from "../harness.js";
import { navigationFixture } from "../navigation-fixture.js";
import { exposeReaderController } from "../reader-controller.js";

for (const scenario of [
  { name: "default Arabic", language: "ar", direction: undefined, rtl: true },
  { name: "explicit default Arabic", language: "ar", direction: "default", rtl: true },
  { name: "default English", language: "en", direction: undefined, rtl: false },
  { name: "Arabic with explicit LTR", language: "ar", direction: "ltr", rtl: false },
  { name: "English with explicit RTL", language: "en", direction: "rtl", rtl: true },
]) {
  test(`${scenario.name}: language fallback preserves physical progression and reading order (#382)`, async () => {
    const info = test.info();
    const book = navigationFixture(info, [1, 1, 1, 1]);
    const source = info.outputPath("navigation-source");
    const opf = path.join(source, "EPUB/package.opf");
    fs.writeFileSync(
      opf,
      fs
        .readFileSync(opf, "utf8")
        .replace("<dc:language>en</dc:language>", `<dc:language>${scenario.language}</dc:language>`)
        .replace(
          "<spine>",
          scenario.direction
            ? `<spine page-progression-direction="${scenario.direction}">`
            : "<spine>",
        ),
    );
    execFileSync("zip", ["-q", "-X", book, "EPUB/package.opf"], { cwd: source });
    const { context, readerPage: page } = await launchReader(book, {
      viewport: { width: 1400, height: 900 },
    });
    try {
      await exposeReaderController(page);
      const physicalOrder = () =>
        page
          .getByRole("main")
          .locator("iframe")
          .evaluateAll((frames) =>
            frames
              .filter((frame) => frame.checkVisibility())
              .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)
              .map(
                (frame) =>
                  (frame as HTMLIFrameElement).contentDocument!.querySelector("text")?.textContent,
              ),
          );
      const first = scenario.rtl ? ["C2Para 1.", "C1Para 1."] : ["C1Para 1.", "C2Para 1."];
      const next = scenario.rtl ? ["C4Para 1.", "C3Para 1."] : ["C3Para 1.", "C4Para 1."];
      const furniture = async (numbers: number[]) => {
        await expect.poll(() => page.getByText(/^Page \d+$/, { exact: true }).evaluateAll(elements =>
          elements.map(element => ({ number: Number(element.textContent!.slice(5)), x: element.getBoundingClientRect().x }))
            .sort((a, b) => a.x - b.x).map(page => page.number),
        )).toEqual(scenario.rtl ? [...numbers].reverse() : numbers);
        await expect.poll(async () => {
          const slider = page.getByRole("slider");
          const fraction = Number(await slider.getAttribute("aria-valuenow")) / 100;
          const width = (await slider.boundingBox())!.width;
          const left = await page.locator("[data-scrubber-thumb]").evaluate(element =>
            parseFloat(getComputedStyle(element).left),
          );
          return Math.abs(left - (scenario.rtl ? 1 - fraction : fraction) * width);
        }).toBeLessThan(1);
      };
      const settled = () =>
        page.waitForFunction(() => {
          const controller = Reflect.get(window, "__readerController");
          return (
            !controller.isTurningPage &&
            !controller.isLoadInFlight &&
            !controller.isApplyingLayout &&
            !controller.pendingLayout
          );
        });
      await expect.poll(physicalOrder).toEqual(first);
      await furniture([1, 2]);
      const gutter = await page.evaluate(() => {
        const controller = Reflect.get(window, "__readerController");
        const divider = controller.host.element.children[1] as HTMLElement;
        return {
          width: divider.getBoundingClientRect().width,
          background: getComputedStyle(divider).backgroundImage,
        };
      });
      expect(gutter.width).toBe(40);
      expect(gutter.background).toContain("0.055");
      if (scenario.name === "default English") {
        for (const theme of ["white", "sepia", "dark"]) {
          await page.evaluate(
            (theme) => Reflect.get(window, "__readerController").setPageTheme(theme),
            theme,
          );
          await expect.poll(physicalOrder).toEqual(first);
          const themed = await page.evaluate(() => {
            const divider = Reflect.get(window, "__readerController").host.element
              .children[1] as HTMLElement;
            return {
              width: divider.getBoundingClientRect().width,
              background: getComputedStyle(divider).backgroundImage,
            };
          });
          expect(themed.width).toBe(gutter.width);
          expect(themed.background).toBe(gutter.background);
          await page.screenshot({ path: info.outputPath(`gutter-${theme}.png`) });
        }
        await page.evaluate(() => Reflect.get(window, "__readerController").setPageTheme("white"));
      }
      await page.keyboard.press(scenario.rtl ? "ArrowLeft" : "ArrowRight");
      await expect.poll(physicalOrder).toEqual(next);
      await settled();
      await furniture([3, 4]);
      await page.keyboard.press(scenario.rtl ? "ArrowRight" : "ArrowLeft");
      await expect.poll(physicalOrder).toEqual(first);
      await settled();
      await clickReadingPage(page, scenario.rtl ? "left" : "right");
      await expect.poll(physicalOrder).toEqual(next);
      await settled();
      await page.reload();
      await expect(page.getByRole("main").locator("iframe").first()).toBeVisible();
      await expect(page.getByRole("progressbar")).toHaveCount(0);
      await exposeReaderController(page);
      await expect.poll(physicalOrder).toEqual(next);
      await page.setViewportSize({ width: 1450, height: 950 });
      await expect.poll(physicalOrder).toEqual(next);
      await settled();
      await furniture([3, 4]);
    } finally {
      await context.close();
    }
  });
}

test("original W3C pkg-spine-progression-default: Arabic metadata controls physical page order (#382)", async () => {
  const book = process.env.AMBRA_DEFAULT_PROGRESSION_EPUB;
  test.skip(!book, "Set AMBRA_DEFAULT_PROGRESSION_EPUB to the pinned original publication.");
  if (!book) throw new Error("The original default-progression publication path is required.");
  const { context, readerPage: page } = await launchReader(book, {
    viewport: { width: 1400, height: 900 },
  });
  try {
    await exposeReaderController(page);
    const facts = await page.evaluate(() => {
      const controller = Reflect.get(window, "__readerController");
      const physicalOrder = controller
        .contentDocumentViews()
        .map((view: { spineIndex: number; document: Document }) => {
          const frame = view.document.defaultView?.frameElement;
          if (!frame) throw new Error("Original publication frame is unavailable.");
          return { spineIndex: view.spineIndex, left: frame.getBoundingClientRect().left };
        })
        .sort((a: { left: number }, b: { left: number }) => a.left - b.left)
        .map((view: { spineIndex: number }) => view.spineIndex);
      return {
        language: controller.pkg.metadata.language,
        declared: controller.pkg.pageProgressionDirection,
        effective: controller.snapshot().pageProgressionDirection,
        physicalOrder,
      };
    });
    expect(facts).toEqual({
      language: "ar",
      declared: "default",
      effective: "rtl",
      physicalOrder: [1, 0],
    });
    await page.keyboard.press("ArrowLeft");
    await expect
      .poll(() =>
        page.evaluate(
          () => Reflect.get(window, "__readerController").host.positions.first.spineIndex,
        ),
      )
      .toBe(2);
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(() =>
        page.evaluate(
          () => Reflect.get(window, "__readerController").host.positions.first.spineIndex,
        ),
      )
      .toBe(0);
  } finally {
    await context.close();
  }
});
