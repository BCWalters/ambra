import { expect, test } from "@playwright/test";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";
import { navigationFixture } from "../navigation-fixture.js";

for (const rtl of [false, true]) {
  for (const single of [false, true]) {
    test(`${single ? "single" : "spread"} ${rtl ? "RTL" : "LTR"}: composited child backface culling preserves native curve paint`, async () => {
      const { context, readerPage: page } = await launchReader(
        navigationFixture(test.info(), [12], undefined, rtl ? "rtl" : "ltr"),
        { viewport: { width: 1547, height: 878 } },
      );
      try {
        await exposeReaderController(page);
        await page.evaluate(async single => {
          const c = Reflect.get(window, "__readerController");
          await c.setAlwaysShowOnePage(single);
          await c.setPageTurnAnimationStyle("none");
          await c.turnPage(1);
          await c.setPageTurnAnimationStyle("rotate");
          const create = c.pageTurnOrchestrator.createCurledLeaf.bind(c.pageTurnOrchestrator);
          c.pageTurnOrchestrator.createCurledLeaf = (...args: unknown[]) => {
            const leaf = create(...args);
            const settle = leaf.settle.bind(leaf);
            leaf.settle = async (...settleArgs: unknown[]) => {
              Reflect.set(window, "__cullingLeaf", leaf);
              await new Promise<void>(resolve => Reflect.set(window, "__releaseCullingLeaf", resolve));
              return settle(...settleArgs);
            };
            return leaf;
          };
          Reflect.set(window, "__cullingTurn", c.turnPage(1));
        }, single);
        await page.waitForFunction(() => !!Reflect.get(window, "__releaseCullingLeaf"));
        await page.getByRole("button", { name: "Bookmark this page", exact: true }).focus();
        await expect(page.getByRole("tooltip").filter({ hasText: "Bookmark this page" })).toBeVisible();
        const leaf = page.locator("[data-ambra-curled-leaf]");
        const initial = await leaf.evaluate(element => {
          const doc = (element as HTMLIFrameElement).contentDocument!;
          return Array.from(doc.querySelectorAll<HTMLElement>("[data-face]"))
            .flatMap(face => Array.from(face.children).map(child => {
              if (!(child instanceof doc.defaultView!.HTMLElement))
                throw new Error("Curled face has a non-HTML paint child.");
              return child.style.backfaceVisibility;
            }));
        });
        expect(initial.length).toBeGreaterThanOrEqual(80);
        expect(initial.every(value => value === "hidden")).toBe(true);
        for (const progress of [0.2, 0.48, 0.52, 0.8]) {
          const paint = async (enabled: boolean) => {
            const count = await page.evaluate(({ progress, enabled }) => {
              const frame = document.querySelector<HTMLIFrameElement>("[data-ambra-curled-leaf]")!;
              const doc = frame.contentDocument!;
              const faces = doc.querySelectorAll<HTMLElement>("[data-face]");
              let count = 0;
              for (const face of faces) {
                for (const child of face.children) {
                  if (!(child instanceof doc.defaultView!.HTMLElement))
                    throw new Error("Curled face has a non-HTML paint child.");
                  child.style.backfaceVisibility = enabled ? "hidden" : "visible";
                  count++;
                }
              }
              Reflect.get(window, "__cullingLeaf").paint(progress);
              return count;
            }, { progress, enabled });
            expect(count).toBeGreaterThanOrEqual(80);
            // Focus and tooltip readiness keep idle chrome stable while
            // comparing the composed viewport, not a scrolled iframe.
            return page.screenshot({ animations: "disabled" });
          };
          const original = await paint(false);
          const culled = await paint(true);
          const difference = await page.evaluate(async ([before, after]) => {
            const pixels = async (encoded: string) => {
              const image = new Image();
              image.src = `data:image/png;base64,${encoded}`;
              await image.decode();
              const canvas = document.createElement("canvas");
              canvas.width = image.width;
              canvas.height = image.height;
              const context = canvas.getContext("2d");
              if (!context) throw new Error("Native backface comparison canvas is unavailable.");
              context.drawImage(image, 0, 0);
              return context.getImageData(0, 0, canvas.width, canvas.height);
            };
            const a = await pixels(before!);
            const b = await pixels(after!);
            if (a.width !== b.width || a.height !== b.height)
              throw new Error("Native backface comparison dimensions differ.");
            let maximum = 0;
            for (let index = 0; index < a.data.length; index++)
              maximum = Math.max(maximum, Math.abs(a.data[index]! - b.data[index]!));
            return maximum;
          }, [original.toString("base64"), culled.toString("base64")]);
          await test.info().attach(`backface-paint-${progress}`, {
            body: culled, contentType: "image/png",
          });
          expect(difference, `progress ${progress} native backface paint difference`).toBeLessThanOrEqual(1);
        }
        await page.evaluate(async () => {
          Reflect.get(window, "__releaseCullingLeaf")();
          await Reflect.get(window, "__cullingTurn");
        });
      } finally {
        await context.close();
      }
    });

    test(`${single ? "single" : "spread"} ${rtl ? "RTL" : "LTR"}: curled paper covers visible strip joints`, async () => {
      const { context, readerPage: page } = await launchReader(
        navigationFixture(test.info(), [12], undefined, rtl ? "rtl" : "ltr"),
        { viewport: { width: 1540, height: 878 } },
      );
      try {
        await exposeReaderController(page);
        await page.evaluate(async (single) => {
          const c = Reflect.get(window, "__readerController");
          await c.setAlwaysShowOnePage(single);
          await c.setPageTurnAnimationStyle("none");
          await c.turnPage(1);
          await c.setPageTurnAnimationStyle("rotate");
          const create = c.pageTurnOrchestrator.createCurledLeaf.bind(c.pageTurnOrchestrator);
          c.pageTurnOrchestrator.createCurledLeaf = (...args: unknown[]) => {
            const leaf = create(...args);
            const settle = leaf.settle.bind(leaf);
            leaf.settle = async (...settleArgs: unknown[]) => {
              Reflect.set(window, "__seamLeaf", leaf);
              await new Promise<void>((resolve) =>
                Reflect.set(window, "__releaseSeamLeaf", resolve),
              );
              return settle(...settleArgs);
            };
            return leaf;
          };
          Reflect.set(window, "__seamTurn", c.turnPage(1));
        }, single);
        await page.waitForFunction(() => !!Reflect.get(window, "__releaseSeamLeaf"));
        const measurements = [];
        for (const progress of single ? [0.1, 0.2, 0.35] : [0.2, 0.35, 0.48, 0.52, 0.65, 0.8]) {
          const clip = await page.evaluate((progress) => {
            const leaf = Reflect.get(window, "__seamLeaf");
            leaf.paint(progress);
            const frame = document.querySelector<HTMLIFrameElement>("[data-ambra-curled-leaf]")!;
            const doc = frame.contentDocument!;
            const strips = Array.from(doc.querySelectorAll<HTMLElement>("[data-segment]"));
            // Solid paper over a contrasting scene isolates coverage from publication ink.
            strips[0]!.parentElement!.style.background = "#ff00ff";
            for (const underlay of doc.querySelectorAll<HTMLElement>("[data-leaf-underlay]"))
              underlay.style.visibility = "hidden";
            for (const face of doc.querySelectorAll<HTMLElement>("[data-segment] > [data-face]")) {
              face.replaceChildren();
              face.style.background = "#fff";
            }
            const bounds = strips.map((strip) => strip.getBoundingClientRect());
            const origin = frame.getBoundingClientRect();
            // Exclude the outer silhouette, where edge antialiasing is expected.
            const left = Math.ceil(Math.max(0, Math.min(...bounds.map((r) => r.left)))) + 8;
            const right =
              Math.floor(Math.min(frame.clientWidth, Math.max(...bounds.map((r) => r.right)))) - 8;
            const y =
              (Math.max(...bounds.map((r) => r.top)) + Math.min(...bounds.map((r) => r.bottom))) /
              2;
            if (right <= left) throw new Error("Curled paper has no interior raster to sample.");
            return {
              x: origin.left + left,
              y: Math.floor(origin.top + y),
              width: right - left,
              height: 1,
            };
          }, progress);
          const screenshot = await page.screenshot({
            clip,
            path: test.info().outputPath(`joints-${progress}.png`),
          });
          const leakage = await page.evaluate(async (encoded) => {
            const image = new Image();
            image.src = `data:image/png;base64,${encoded}`;
            await image.decode();
            const canvas = document.createElement("canvas");
            canvas.width = image.width;
            canvas.height = image.height;
            const context = canvas.getContext("2d")!;
            context.drawImage(image, 0, 0);
            const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
            let peak = 0;
            let total = 0;
            for (let i = 0; i < pixels.length; i += 4) {
              const leak = Math.max(0, Math.min(pixels[i]!, pixels[i + 2]!) - pixels[i + 1]!);
              peak = Math.max(peak, leak);
              total += leak / 255;
            }
            return { peak, total };
          }, screenshot.toString("base64"));
          measurements.push({ progress, ...leakage });
        }
        console.log("STRIP_JOINT_LEAKAGE", measurements);
        for (const measurement of measurements) {
          expect(
            measurement.peak,
            `progress ${measurement.progress} peak background leakage`,
          ).toBeLessThan(64);
          expect(
            measurement.total,
            `progress ${measurement.progress} equivalent exposed pixels`,
          ).toBeLessThan(1);
        }
        await page.evaluate(async () => {
          Reflect.get(window, "__releaseSeamLeaf")();
          await Reflect.get(window, "__seamTurn");
        });
      } finally {
        await context.close();
      }
    });
  }
}
