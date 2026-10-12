import { expect, test } from "@playwright/test";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";
import { navigationFixture } from "../navigation-fixture.js";

test("flat leaf preserves furniture rasterization and body ink weight", async () => {
  const epub = navigationFixture(
    test.info(),
    [80],
    (_chapter, page) =>
      `<p style="height:600px;margin:0">Page ${page + 1}. A quiet path through the hills leads home.</p>`,
  );
  const { context, readerPage: page } = await launchReader(epub, {
    viewport: { width: 1547, height: 878 },
  });
  try {
    await exposeReaderController(page);
    await page.evaluate(async () => {
      const c = Reflect.get(window, "__readerController");
      await c.setPageTurnAnimationStyle("none");
      await c.turnPage(1);
      await c.setPageTurnAnimationStyle("rotate");
    });
    await page.mouse.click(500, 400);
    await page.waitForTimeout(1000);
    const clips = await page.locator("[data-ambra-page-furniture] > span").evaluateAll((spans) =>
      spans.map((span) => {
        const rect = span.getBoundingClientRect();
        return {
          text: span.textContent,
          clip: {
            x: Math.floor(rect.left) - 2,
            y: Math.floor(rect.top) - 2,
            width: Math.ceil(rect.width) + 4,
            height: Math.ceil(rect.height) + 4,
          },
          color: getComputedStyle(span).color,
          opacity: getComputedStyle(span).opacity,
        };
      }),
    );
    expect(clips).toHaveLength(4);
    const bodyClip = await page.evaluate(() => {
      const c = Reflect.get(window, "__readerController");
      const frame = c.host.columnElement("right") as HTMLIFrameElement;
      const doc = frame.contentDocument!;
      const origin = frame.getBoundingClientRect();
      const paragraph = Array.from(doc.querySelectorAll("p")).find((p) => {
        const range = doc.createRange();
        range.selectNodeContents(p);
        const rect = range.getBoundingClientRect();
        return rect.top > 0 && rect.bottom < frame.clientHeight;
      });
      if (!paragraph) throw new Error("No visible paragraph to compare.");
      const range = doc.createRange();
      range.selectNodeContents(paragraph);
      const rect = range.getBoundingClientRect();
      return {
        text: paragraph.textContent,
        color: getComputedStyle(paragraph).color,
        opacity: getComputedStyle(paragraph).opacity,
        clip: {
          x: Math.floor(origin.left + rect.left) - 2,
          y: Math.floor(origin.top + rect.top) - 2,
          width: Math.ceil(rect.width) + 4,
          height: Math.ceil(rect.height) + 4,
        },
      };
    });
    clips.push(bodyClip);
    const staticImages: string[] = [];
    for (const [index, item] of clips.entries())
      staticImages.push(
        (
          await page.screenshot({
            path: test.info().outputPath(`static-${index}.png`),
            clip: item.clip,
          })
        ).toString("base64"),
      );
    await page.evaluate(() => {
      const c = Reflect.get(window, "__readerController");
      const create = c.pageTurnOrchestrator.createCurledLeaf.bind(c.pageTurnOrchestrator);
      c.pageTurnOrchestrator.createCurledLeaf = (...args: unknown[]) => {
        const leaf = create(...args);
        const settle = leaf.settle.bind(leaf);
        leaf.settle = async (...args: unknown[]) => {
          leaf.paint(0);
          Reflect.set(window, "__colorLeaf", leaf);
          await new Promise<void>((resolve) => Reflect.set(window, "__releaseColorLeaf", resolve));
          return settle(...args);
        };
        return leaf;
      };
      Reflect.set(window, "__colorTurn", c.turnPage(1));
    });
    await page.waitForFunction(() => !!Reflect.get(window, "__releaseColorLeaf"));
    for (const [index, item] of clips.entries()) {
      const animated = await page.screenshot({
        path: test.info().outputPath(`flat-${index}.png`),
        clip: item.clip,
      });
      const difference = await page.evaluate(
        async ([before, after]) => {
          const pixels = async (encoded: string) => {
            const image = new Image();
            image.src = `data:image/png;base64,${encoded}`;
            await image.decode();
            const canvas = document.createElement("canvas");
            canvas.width = image.width;
            canvas.height = image.height;
            const context = canvas.getContext("2d")!;
            context.drawImage(image, 0, 0);
            return context.getImageData(0, 0, canvas.width, canvas.height).data;
          };
          const a = await pixels(before!);
          const b = await pixels(after!);
          let total = 0;
          let originalInk = 0;
          let animatedInk = 0;
          let originalMinimum = 255;
          let animatedMinimum = 255;
          for (let i = 0; i < a.length; i += 4) {
            total += Math.abs(a[i]! - b[i]!);
            originalInk += 255 - a[i]!;
            animatedInk += 255 - b[i]!;
            originalMinimum = Math.min(originalMinimum, a[i]!);
            animatedMinimum = Math.min(animatedMinimum, b[i]!);
          }
          return {
            mean: total / (a.length / 4),
            inkRatio: animatedInk / originalInk,
            originalMinimum,
            animatedMinimum,
          };
        },
        [staticImages[index]!, animated.toString("base64")],
      );
      expect(Math.abs(difference.inkRatio - 1), `${item.text} native ink weight`).toBeLessThan(
        0.01,
      );
      expect(difference.animatedMinimum, `${item.text} darkest ink`).toBe(
        difference.originalMinimum,
      );
      if (index < 4)
        expect(difference.mean, `${item.text} native raster difference`).toBeLessThan(1);
    }
    await page.screenshot({ path: test.info().outputPath("flat-page.png") });
    await page.evaluate(async () => {
      Reflect.get(window, "__releaseColorLeaf")();
      await Reflect.get(window, "__colorTurn");
    });
  } finally {
    await context.close();
  }
});
