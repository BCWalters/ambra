import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { clickReadingPage, launchReader, READER_FRAME_SELECTOR } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";
import { navigationFixture } from "../navigation-fixture.js";

for (const fixed of [false, true]) {
  for (const rtl of [false, true]) {
    test(`${fixed ? "fixed" : "reflowable"} single ${rtl ? "RTL" : "LTR"}: backward leaf restores the previous page over the current page`, async () => {
      const epub = navigationFixture(
        test.info(),
        fixed ? [1, 1, 1] : [60],
        (_chapter, index) =>
          fixed
            ? `<p>Fixed page ${_chapter + 1}</p>`
            : `<p id="p${index}">${index}. ${"A quiet path through the hills leads home. ".repeat(30)}</p>`,
        rtl ? "rtl" : "ltr",
      );
      if (fixed) {
        const source = test.info().outputPath("navigation-source");
        const opf = path.join(source, "EPUB/package.opf");
        fs.writeFileSync(
          opf,
          fs
            .readFileSync(opf, "utf8")
            .replace(
              "</metadata>",
              '<meta property="rendition:layout">pre-paginated</meta><meta property="rendition:spread">none</meta></metadata>',
            ),
        );
        for (const index of [0, 1, 2]) {
          const document = path.join(source, `EPUB/c${index}.xhtml`);
          fs.writeFileSync(
            document,
            fs
              .readFileSync(document, "utf8")
              .replace("<head>", '<head><meta name="viewport" content="width=600,height=900"/>'),
          );
        }
        execFileSync("zip", ["-q", "-X", "-r", epub, "EPUB"], { cwd: source });
      }
      const { context, readerPage: page } = await launchReader(epub, {
        viewport: { width: 1547, height: 878 },
      });
      try {
        await exposeReaderController(page);
        await page.evaluate(async (fixed) => {
          const c = Reflect.get(window, "__readerController");
          await c.setAlwaysShowOnePage(true);
          if (!fixed) await c.openSpineItem(0, { fragment: "p17" });
          await c.setPageTurnAnimationStyle("rotate");
          if (!fixed) {
            Reflect.set(window, "__sourceHost", c.host);
            Reflect.set(window, "__sourceDocument", c.host.element.contentDocument);
          }
          const create = c.pageTurnOrchestrator.createCurledLeaf.bind(c.pageTurnOrchestrator);
          c.pageTurnOrchestrator.createCurledLeaf = (...args: unknown[]) => {
            const leaf = create(...args);
            const settle = leaf.settle.bind(leaf);
            leaf.settle = async (...args: unknown[]) => {
              leaf.paint(Reflect.get(window, "__holdSingleProgress"));
              await new Promise<void>((resolve) =>
                Reflect.set(window, "__releaseSingleLeaf", resolve),
              );
              Reflect.set(window, "__releaseSingleLeaf", undefined);
              return settle(...args);
            };
            return leaf;
          };
        }, fixed);
        const initialCfi = await page.evaluate(() =>
          Reflect.get(window, "__readerController").currentReadingCfi(),
        );
        const captures: {
          front: string | null;
          underlay: string | null;
          transforms: string[];
        }[] = [];
        for (const direction of [1, -1] as const) {
          await page.evaluate(
            (progress) => Reflect.set(window, "__holdSingleProgress", progress),
            direction === 1 ? 0.25 : 0.75,
          );
          const before = await page.evaluate(() =>
            Reflect.get(window, "__readerController").currentReadingCfi(),
          );
          const physical = rtl ? -direction : direction;
          await clickReadingPage(page, physical === 1 ? "right" : "left");
          await page.waitForFunction(() => !!Reflect.get(window, "__releaseSingleLeaf"));
          const ink = await page
            .locator("[data-ambra-curled-leaf]")
            .evaluate((frame: HTMLIFrameElement) => {
              const doc = frame.contentDocument!;
              return {
                front: doc.querySelector("[data-flat-leaf-face='front'] [data-page-copy]")!
                  .textContent,
                underlay: doc.querySelector("[data-leaf-underlay] [data-page-copy]")!.textContent,
                faces: Array.from(doc.querySelectorAll("[data-face] [data-page-copy]")).map(
                  (copy) => copy.textContent,
                ),
                transforms: Array.from(doc.querySelectorAll<HTMLElement>("[data-segment]")).map(
                  (segment) => segment.style.transform,
                ),
              };
            });
          expect(ink.front).not.toBe(ink.underlay);
          expect(ink.faces).toHaveLength(40);
          for (const face of ink.faces) expect(face).toBe(ink.front);
          captures.push(ink);
          if (!fixed)
            expect(
              await page.evaluate(() =>
                Reflect.get(window, "__readerController").currentReadingCfi(),
              ),
            ).toBe(before);
          await page.screenshot({
            path: test.info().outputPath(`single-leaf-${direction}.png`),
          });
          await page.evaluate(() => Reflect.get(window, "__releaseSingleLeaf")());
          await page.waitForFunction(
            () => !Reflect.get(window, "__readerController").isTurningPage,
          );
          if (!fixed)
            expect(
              await page.evaluate(() => {
                const c = Reflect.get(window, "__readerController");
                return (
                  c.host === Reflect.get(window, "__sourceHost") &&
                  c.host.element.contentDocument === Reflect.get(window, "__sourceDocument")
                );
              }),
            ).toBe(true);
          await expect(page.locator(READER_FRAME_SELECTOR)).toHaveCount(1);
          expect(
            await page.evaluate(() => Reflect.get(window, "__readerController").snapshot().error),
          ).toBeUndefined();
        }
        expect(captures[1]!.front).toBe(captures[0]!.front);
        expect(captures[1]!.underlay).toBe(captures[0]!.underlay);
        expect(captures[0]!.transforms).toHaveLength(20);
        expect(captures[1]!.transforms).toEqual(captures[0]!.transforms);
        expect(
          await page.evaluate(() => Reflect.get(window, "__readerController").currentReadingCfi()),
        ).toBe(initialCfi);
      } finally {
        await context.close();
      }
    });
  }
}
