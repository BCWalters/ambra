import { expect, test, type CDPSession } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { clickReadingPage, launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";
import { navigationFixture } from "../navigation-fixture.js";

// DOM serialization and per-frame screencast encoding interrupt native curl timing.
test.use({ trace: { mode: "retain-on-failure", snapshots: false, screenshots: false } });

test("curled copies preserve explicit initial values below contrasting parents", async () => {
  const { context, readerPage: page } = await launchReader(
    navigationFixture(test.info(), [4], (_chapter, index) =>
      `<div style="height:600px;color:rgb(180,20,30);font-weight:700;font-style:italic;direction:rtl">
        <p><span id="initial-ink-${index}" style="--original-ink:rgb(0,0,0);color:var(--original-ink);font-weight:400;font-style:normal;direction:ltr;unicode-bidi:normal">${"An original passage in plain ink. ".repeat(100)}</span></p>
      </div>`),
    { viewport: { width: 1547, height: 878 } },
  );
  try {
    await exposeReaderController(page);
    await page.evaluate(async () => {
      const c = Reflect.get(window, "__readerController");
      await c.setPageTurnAnimationStyle("rotate");
      const create = c.pageTurnOrchestrator.createCurledLeaf.bind(c.pageTurnOrchestrator);
      c.pageTurnOrchestrator.createCurledLeaf = (...args: unknown[]) => {
        const leaf = create(...args);
        const prepare = leaf.prepare.bind(leaf);
        leaf.prepare = async (...pages: unknown[]) => {
          await prepare(...pages);
          const source = (pages[0] as { element: HTMLIFrameElement }).element.contentDocument!;
          const frame = document.querySelector<HTMLIFrameElement>("[data-ambra-curled-leaf]")!;
          const copies = frame.contentDocument!.querySelectorAll("[data-face='front'] [id^='initial-ink-']");
          if (copies.length === 0) throw new Error("Contrasting paint fixture is missing.");
          const frozen = frame.contentDocument!.querySelectorAll(
            "[data-ambra-frozen-paint]:not([data-ambra-frozen-furniture])",
          );
          const rules = new Set(Array.from(frozen, element => element.getAttribute("data-ambra-frozen-paint")));
          const furniture = Array.from(frame.contentDocument!.querySelectorAll<HTMLElement>(
            "[data-ambra-turn-furniture], [data-ambra-turn-furniture] *",
          ));
          const furnitureSelectors = new Set(furniture.map(element =>
            `[data-ambra-frozen-paint="${element.getAttribute("data-ambra-frozen-paint")}"]`));
          const furnitureRules = Array.from(frame.contentDocument!.styleSheets)
            .flatMap(sheet => Array.from(sheet.cssRules))
            .filter((rule): rule is CSSStyleRule => rule.type === CSSRule.STYLE_RULE)
            .filter(rule => furnitureSelectors.has(rule.selectorText));
          Reflect.set(window, "__frozenPaintStats", {
            nodes: frozen.length,
            rules: rules.size,
            furnitureNodes: furniture.length,
            furnitureInlineBytes: furniture.reduce((sum, element) => sum + element.style.cssText.length, 0),
            furnitureInlineVariables: furniture.reduce((sum, element) =>
              sum + Array.from(element.style).filter(property => property.startsWith("--")).length, 0),
            furnitureSharedVariables: furnitureRules.reduce((sum, rule) =>
              sum + Array.from(rule.style).filter(property => property.startsWith("--")).length, 0),
            inline: Array.from(frozen)
              .filter(element => element.getAttribute("style")?.trim())
              .map(element => `${element.localName}: ${element.getAttribute("style")}`),
          });
          for (const copy of copies) {
            const original = source.getElementById(copy.id);
            if (!original) throw new Error("Original contrasting ink is missing.");
            const expected = source.defaultView!.getComputedStyle(original);
            const actual = frame.contentDocument!.defaultView!.getComputedStyle(copy);
            for (const property of ["color", "font-weight", "font-style", "direction", "unicode-bidi", "--original-ink"]) {
              if (actual.getPropertyValue(property) !== expected.getPropertyValue(property))
                throw new Error(`Curled copy changed ${property} below a contrasting parent.`);
            }
          }
          Reflect.set(window, "__initialPaintVerified", true);
        };
        return leaf;
      };
      await c.turnPage(1);
    });
    expect(await page.evaluate(() => Reflect.get(window, "__initialPaintVerified"))).toBe(true);
    const stats = await page.evaluate(() => Reflect.get(window, "__frozenPaintStats"));
    await test.info().attach("frozen-paint-allocation", {
      body: JSON.stringify(stats),
      contentType: "application/json",
    });
    expect(stats.nodes).toBeGreaterThan(stats.rules * 10);
    expect(stats.inline).toEqual([]);
    expect(stats.furnitureNodes).toBeGreaterThan(0);
    expect(stats.furnitureInlineVariables).toBe(0);
    expect(stats.furnitureSharedVariables).toBe(0);
    expect(stats.furnitureInlineBytes).toBeLessThan(stats.furnitureNodes * 1000);
    await expect(page.locator("[data-ambra-curled-leaf]")).toHaveCount(0);
  } finally {
    await context.close();
  }
});

async function runLongChapterTurn(verifyGeometry: boolean): Promise<void> {
  const epub = process.env.AMBRA_E2E_LONG_CHAPTER;
  const { context, readerPage: page } = await launchReader(
    epub ??
      navigationFixture(
        test.info(),
        [500],
        (_chapter, index) =>
          `<p id="p${index}">${index}. ${"A quiet path through the hills leads home. ".repeat(30)}</p>`,
      ),
    {
      viewport: { width: 1547, height: 878 },
    },
  );
  const timeline: unknown[] = [];
  let tracingSession: CDPSession | undefined;
  let profiling = false;
  try {
    await exposeReaderController(page);
    await page.evaluate(
      async ({ realBook, verifyGeometry }) => {
        const c = Reflect.get(window, "__readerController");
        const index = c.pkg.spine.findIndex((item: { manifestItem: { path: string } }) =>
          item.manifestItem.path.includes("reflections-on-the-revolution-in-france.xhtml"),
        );
        if (realBook && index < 0) throw new Error("Long chapter not found.");
        await c.setPageTurnAnimationStyle("none");
        await c.openSpineItem(realBook ? index : 0, { landOnPageIndex: realBook ? 100 : 10 });
        await c.setPageTurnAnimationStyle("rotate");
        const turn = c.turnPage.bind(c);
        c.turnPage = async (direction: 1 | -1) => {
          const start = performance.now();
          Reflect.set(window, "__turnStarted", start);
          await turn(direction);
          Reflect.set(window, "__lastTurnMs", performance.now() - start);
        };
        const create = c.pageTurnOrchestrator.createCurledLeaf.bind(c.pageTurnOrchestrator);
        Reflect.set(window, "__leafMetrics", []);
        c.pageTurnOrchestrator.createCurledLeaf = (...args: unknown[]) => {
          const leaf = create(...args);
          const prepare = leaf.prepare.bind(leaf);
          const paint = leaf.paint.bind(leaf);
          const settle = leaf.settle.bind(leaf);
          const frames: number[] = [];
          let last: number | undefined;
          let measuring = false;
          leaf.paint = (progress: number) => {
            if (measuring) {
              const now = performance.now();
              if (last !== undefined) frames.push(now - last);
              last = now;
            }
            paint(progress);
          };
          leaf.prepare = async (...prepareArgs: unknown[]) => {
            await prepare(...prepareArgs);
            const frame = document.querySelector<HTMLIFrameElement>("[data-ambra-curled-leaf]")!;
            Reflect.get(window, "__leafMetrics").push({
              preparationMs: Number(frame.dataset.preparationMs),
              nodes: frame.contentDocument!.querySelectorAll("*").length,
              textLength: frame.contentDocument!.body.textContent!.length,
              frames,
              onsetMs: performance.now() - Reflect.get(window, "__turnStarted"),
              foregroundPrioritized:
                c.foregroundPaginationOperation !== undefined &&
                c.foregroundPaginationOperation === c.operations.current,
            });
            last = undefined;
            measuring = !verifyGeometry;
            leaf.settle = async (...settleArgs: unknown[]) => {
              await settle(...settleArgs);
              measuring = false;
              if (!verifyGeometry) return;
              const geometry = [];
              for (const [index, face] of ["front", "back"].entries()) {
                const front = prepareArgs[index] as {
                  element: HTMLIFrameElement;
                  capture?: () => () => void;
                };
                const restore = front.capture?.();
                try {
                  leaf.paint(index);
                  const source = front.element.contentDocument!;
                  const copyViewport = frame.contentDocument!.querySelector<HTMLElement>(
                    `[data-face='${face}'] [data-page-copy]`,
                  )!;
                  if (
                    frame.contentDocument!.defaultView!.getComputedStyle(copyViewport).clipPath !==
                    front.element.ownerDocument.defaultView!.getComputedStyle(front.element)
                      .clipPath
                  ) {
                    throw new Error("Turning copy does not preserve the canonical page clip.");
                  }
                  for (const root of [
                    frame.contentDocument!.documentElement,
                    frame.contentDocument!.body,
                  ]) {
                    if (
                      frame.contentDocument!.defaultView!.getComputedStyle(root).overflow !==
                      "hidden"
                    )
                      throw new Error("Turning surface permits scrollbars.");
                  }
                  const origin = copyViewport.getBoundingClientRect();
                  const samples = Array.from(source.querySelectorAll<HTMLElement>("p"))
                    .filter((element) => {
                      const rect = element.getBoundingClientRect();
                      return rect.top < front.element.clientHeight && rect.bottom > 0;
                    })
                    .map((element) => {
                      const copy = Array.from(copyViewport.querySelectorAll<HTMLElement>("p")).find(
                        (candidate) => candidate.textContent === element.textContent,
                      );
                      if (!copy)
                        throw new Error(`Visible paragraph missing from leaf: ${element.id}`);
                      const a = element.getBoundingClientRect();
                      const b = copy.getBoundingClientRect();
                      const sourceWalker = source.createTreeWalker(element, NodeFilter.SHOW_TEXT);
                      const copyWalker = frame.contentDocument!.createTreeWalker(
                        copy,
                        NodeFilter.SHOW_TEXT,
                      );
                      const words = [];
                      for (
                        let node = sourceWalker.nextNode();
                        node;
                        node = sourceWalker.nextNode()
                      ) {
                        const copiedNode = copyWalker.nextNode();
                        if (!copiedNode || copiedNode.textContent !== node.textContent)
                          throw new Error("Leaf text differs from source.");
                        for (const match of node.textContent!.matchAll(/\S+/g)) {
                          const sourceRange = source.createRange();
                          sourceRange.setStart(node, match.index);
                          sourceRange.setEnd(node, match.index + match[0].length);
                          const original = sourceRange.getBoundingClientRect();
                          if (original.top < 0 || original.bottom > front.element.clientHeight)
                            continue;
                          const copiedRange = frame.contentDocument!.createRange();
                          copiedRange.setStart(copiedNode, match.index);
                          copiedRange.setEnd(copiedNode, match.index + match[0].length);
                          const painted = copiedRange.getBoundingClientRect();
                          words.push({
                            word: match[0],
                            dx: painted.left - origin.left - original.left,
                            dy: painted.top - origin.top - original.top,
                            dw: painted.width - original.width,
                          });
                        }
                      }
                      return {
                        id: element.id,
                        dy: b.top - origin.top - a.top,
                        dw: b.width - a.width,
                        words,
                      };
                    });
                  if (samples.length === 0) throw new Error("No visible paragraphs tested.");
                  geometry.push(...samples.map((sample) => ({ ...sample, face })));
                } finally {
                  restore?.();
                }
              }
              leaf.paint(1);
              Reflect.set(window, "__leafGeometry", geometry);
            };
          };
          return leaf;
        };
      },
      { realBook: !!epub, verifyGeometry },
    );
    await page.waitForFunction(
      () => Reflect.get(window, "__readerController").snapshot().bookPageIndex !== undefined,
      { timeout: 30000 },
    );
    if (process.env.AMBRA_E2E_PROFILE_CURL === "1") {
      tracingSession = await context.newCDPSession(page);
      tracingSession.on("Tracing.dataCollected", (event) => timeline.push(...event.value));
      await tracingSession.send("Tracing.start", {
        categories: "devtools.timeline",
        transferMode: "ReportEvents",
      });
      profiling = true;
    }
    for (const [i, direction] of [1, 1, -1, 1].entries()) {
      if (i === 0) {
        await clickReadingPage(page, "right");
        await page.waitForFunction(() => Reflect.get(window, "__leafMetrics").length > 0);
        await page.waitForFunction(() => !Reflect.get(window, "__readerController").isTurningPage);
      } else
        await page.evaluate(
          async (direction: 1 | -1) => {
            const c = Reflect.get(window, "__readerController");
            await c.turnPage(direction);
          },
          direction as 1 | -1,
        );
      const timing = await page.evaluate(() => Reflect.get(window, "__lastTurnMs"));
      await test.info().attach(`turn-${i}`, {
        body: JSON.stringify({
          timing,
          metrics: await page.evaluate(() => Reflect.get(window, "__leafMetrics")),
        }),
        contentType: "application/json",
      });
      await expect(page.locator("[data-ambra-curled-leaf]")).toHaveCount(0);
      await expect(page.locator("[data-ambra-turn-furniture]")).toHaveCount(0);
      expect(
        await page.evaluate(() => Reflect.get(window, "__readerController").snapshot().error),
      ).toBeUndefined();
      if (verifyGeometry) {
        const geometry = await page.evaluate(() => Reflect.get(window, "__leafGeometry"));
        await test.info().attach(`geometry-${i}`, {
          body: JSON.stringify(geometry),
          contentType: "application/json",
        });
        for (const sample of geometry) {
          expect(
            Math.abs(sample.dy),
            `${sample.face} ${sample.id} vertical paint position`,
          ).toBeLessThan(0.1);
          expect(Math.abs(sample.dw), `${sample.id} paragraph measure`).toBeLessThan(1);
          for (const word of sample.words) {
            expect(Math.abs(word.dx), `${word.word} horizontal paint position`).toBeLessThan(1);
            expect(
              Math.abs(word.dy),
              `${sample.face} ${word.word} vertical paint position`,
            ).toBeLessThan(0.1);
            expect(Math.abs(word.dw), `${word.word} painted width`).toBeLessThan(1);
          }
        }
      }
      const metrics = await page.evaluate(() => Reflect.get(window, "__leafMetrics").at(-1));
      expect(
        metrics.foregroundPrioritized,
        "background pagination must yield to the foreground curl",
      ).toBe(true);
      expect(metrics.preparationMs).toBeLessThan(250);
      expect(metrics.textLength).toBeLessThan(500000);
      expect(metrics.onsetMs).toBeLessThan(750);
      expect(timing).toBeLessThan(1500);
      if (!verifyGeometry) {
        const gaps = metrics.frames.slice().sort((a: number, b: number) => a - b);
        expect(gaps.length).toBeGreaterThan(5);
        expect(gaps[Math.ceil(gaps.length * 0.95) - 1]).toBeLessThan(40);
        expect(Math.max(...gaps)).toBeLessThan(100);
      }
      const snapshot = await page.evaluate(() =>
        Reflect.get(window, "__readerController").snapshot(),
      );
      const numbers = snapshot.spreadPageNumbers ?? [
        snapshot.bookPageIndex,
        snapshot.bookPageIndex + 1,
      ];
      for (const number of numbers)
        await expect(page.getByText(`Page ${number}`, { exact: true })).toHaveCount(1);
      await page.screenshot({ path: test.info().outputPath(`long-chapter-${i}.png`) });
    }
    if (!verifyGeometry)
      console.log(
        "LONG_CHAPTER_METRICS",
        await page.evaluate(() =>
          Reflect.get(window, "__leafMetrics").map(
            (metric: {
              preparationMs: number;
              onsetMs: number;
              textLength: number;
              nodes: number;
              frames: number[];
            }) => {
              const frames = metric.frames.slice().sort((a, b) => a - b);
              return {
                preparationMs: metric.preparationMs,
                onsetMs: metric.onsetMs,
                nodes: metric.nodes,
                textLength: metric.textLength,
                p95FrameMs: frames[Math.ceil(frames.length * 0.95) - 1],
                worstFrameMs: Math.max(...frames),
              };
            },
          ),
        ),
      );
  } finally {
    try {
      const session = tracingSession;
      if (session && profiling) {
        const complete = new Promise<void>((resolve) =>
          session.once("Tracing.tracingComplete", () => resolve()),
        );
        await session.send("Tracing.end");
        await complete;
        await test.info().attach("native-curl-timeline", {
          body: JSON.stringify(timeline),
          contentType: "application/json",
        });
      }
    } finally {
      await context.close();
    }
  }
}

for (const verifyGeometry of [false, true])
  test(
    verifyGeometry
      ? "long chapter: curved copies preserve paragraph and word geometry"
      : "long chapter: curved turn preparation and handoff stay bounded",
    () => runLongChapterTurn(verifyGeometry),
  );

for (const rtl of [false, true]) {
  for (const fixed of [false, true]) {
    test(`${fixed ? "fixed" : "reflowable"} ${rtl ? "rtl" : "ltr"}: real curved leaf displays both faces and cleans up without replacing the stationary page`, async () => {
      const epub = fixed
        ? path.resolve("fixtures", rtl ? "fxl-spread-rtl.epub" : "fxl-spread-ltr.epub")
        : navigationFixture(test.info(), [1]);
      if (!fixed) {
        const source = test.info().outputPath("navigation-source");
        const opf = path.join(source, "EPUB/package.opf");
        fs.writeFileSync(
          opf,
          fs
            .readFileSync(opf, "utf8")
            .replace("<spine>", `<spine page-progression-direction="${rtl ? "rtl" : "ltr"}">`),
        );
        fs.writeFileSync(
          path.join(source, "EPUB/c0.xhtml"),
          `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Leaf test</title></head><body>${Array.from(
            { length: 80 },
            (_, i) =>
              `<p id="p${i}">${i}. ${"A quiet path through the hills leads home. ".repeat(10)}</p>`,
          ).join("")}</body></html>`,
        );
        execFileSync("zip", ["-q", "-X", "-r", epub, "EPUB"], { cwd: source });
      }
      const { context, readerPage: page } = await launchReader(epub, {
        viewport: { width: 1547, height: 878 },
      });
      try {
        await exposeReaderController(page);
        if (!fixed)
          await page.waitForFunction(
            () => Reflect.get(window, "__readerController").snapshot().bookPageIndex !== undefined,
          );
        await page.evaluate(async (fixed) => {
          const c = Reflect.get(window, "__readerController");
          await c.setPageTurnAnimationStyle("none");
          if (fixed) await c.turnPage(1);
          await c.setPageTurnAnimationStyle("rotate");
          const create = c.pageTurnOrchestrator.createCurledLeaf.bind(c.pageTurnOrchestrator);
          c.pageTurnOrchestrator.createCurledLeaf = (...args: unknown[]) => {
            const leaf = create(...args);
            const prepare = leaf.prepare.bind(leaf);
            leaf.prepare = async (...prepareArgs: unknown[]) => {
              if (!fixed) {
                for (const overlay of document.querySelectorAll<HTMLElement>(
                  "[data-ambra-turn-furniture]",
                )) {
                  if (getComputedStyle(overlay).opacity !== "0")
                    throw new Error("Capture-only furniture is visible before the leaf is ready.");
                }
              }
              await prepare(...prepareArgs);
              const surface = document.querySelector<HTMLIFrameElement>(
                "[data-ambra-curled-leaf]",
              )!;
              const surfaceBounds = surface.getBoundingClientRect();
              const errors = [];
              const folios = [];
              const inkErrors = [];
              for (const [index, progress] of [0, 1].entries()) {
                leaf.paint(progress);
                const source = (
                  prepareArgs[index] as { element: HTMLElement }
                ).element.getBoundingClientRect();
                const flat = surface.contentDocument!.querySelector<HTMLElement>(
                  `[data-flat-leaf-face="${index === 0 ? "front" : "back"}"]`,
                )!.getBoundingClientRect();
                errors.push({
                  left:
                    flat.left + surfaceBounds.left - source.left,
                  right:
                    flat.right +
                    surfaceBounds.left -
                    source.right,
                });
                const originalFurniture = (prepareArgs[index] as { furniture?: HTMLElement })
                  .furniture;
                if (originalFurniture) {
                  const canvas = document.createElement("canvas");
                  canvas.width = canvas.height = 1;
                  const context = canvas.getContext("2d")!;
                  for (const original of originalFurniture.querySelectorAll("span")) {
                    const copy = Array.from(
                      surface.contentDocument!.querySelectorAll<HTMLElement>(
                        `[data-face='${index === 0 ? "front" : "back"}'] [data-ambra-turn-furniture] span`,
                      ),
                    ).find((span) => span.textContent === original.textContent)!;
                    const originalStyle = getComputedStyle(original);
                    const background = getComputedStyle(original.parentElement!).backgroundColor;
                    context.globalAlpha = 1;
                    context.fillStyle = background;
                    context.fillRect(0, 0, 1, 1);
                    context.globalAlpha = Number(originalStyle.opacity);
                    context.fillStyle = originalStyle.color;
                    context.fillRect(0, 0, 1, 1);
                    const expectedColor = context.getImageData(0, 0, 1, 1).data;
                    context.globalAlpha = 1;
                    context.fillStyle = background;
                    context.fillRect(0, 0, 1, 1);
                    context.fillStyle = surface
                      .contentDocument!.defaultView!.getComputedStyle(copy)
                      .getPropertyValue("-webkit-text-fill-color");
                    context.fillRect(0, 0, 1, 1);
                    const actualColor = context.getImageData(0, 0, 1, 1).data;
                    inkErrors.push(
                      Math.max(
                        ...expectedColor.map((value, channel) =>
                          Math.abs(value - actualColor[channel]!),
                        ),
                      ),
                    );
                  }
                  const expected = Array.from(originalFurniture.querySelectorAll("span")).map(
                    (span) => span.textContent,
                  );
                  const visible = new Set(
                    Array.from(
                      surface.contentDocument!.querySelectorAll<HTMLElement>(
                        `[data-face='${index === 0 ? "front" : "back"}'] [data-ambra-turn-furniture] span`,
                      ),
                    )
                      .filter((span) => {
                        const face = span
                          .closest<HTMLElement>("[data-face]")!
                          .getBoundingClientRect();
                        const rect = span.getBoundingClientRect();
                        const x = rect.left + rect.width / 2;
                        const y = rect.top + rect.height / 2;
                        return (
                          x >= face.left && x <= face.right && y >= face.top && y <= face.bottom
                        );
                      })
                      .map((span) => span.textContent),
                  );
                  folios.push({ expected, visible: [...visible] });
                }
              }
              Reflect.set(window, "__leafEndpoints", errors);
              Reflect.set(window, "__leafFolios", folios);
              Reflect.set(window, "__leafInkErrors", inkErrors);
              leaf.paint(0);
            };
            const settle = leaf.settle.bind(leaf);
            leaf.settle = async (...settleArgs: unknown[]) => {
              leaf.paint(0.7);
              await new Promise<void>((resolve) => Reflect.set(window, "__releaseLeaf", resolve));
              Reflect.set(window, "__releaseLeaf", undefined);
              return settle(...settleArgs);
            };
            return leaf;
          };
          Reflect.set(window, "__turnDone", c.turnPage(1));
        }, fixed);
        const leaf = page.locator("[data-ambra-curled-leaf]");
        await expect(leaf).toBeVisible();
        await expect.poll(() => leaf.getAttribute("data-progress")).not.toBeNull();
        const details = await leaf.evaluate((element) => {
          const frame = element as HTMLIFrameElement;
          const doc = frame.contentDocument!;
          return {
            sandbox: frame.getAttribute("sandbox"),
            scripts: doc.querySelectorAll("script").length,
            segments: doc.querySelectorAll("[data-segment]").length,
            text: doc.body.textContent,
            preparationMs: Number(frame.dataset.preparationMs),
            uniformShading: Array.from(doc.querySelectorAll<HTMLElement>("[data-face]")).every(
              (face) => {
                const content = face.firstElementChild as HTMLElement;
                const shade = face.lastElementChild as HTMLElement;
                const furniture = face.querySelector<HTMLElement>("[data-ambra-turn-furniture]");
                return (
                  content.style.zIndex === "0" &&
                  shade.style.zIndex === "1" &&
                  (!furniture ||
                    (furniture.parentElement!.style.zIndex === "2" &&
                      Array.from(furniture.children).every(
                        (band) => (band as HTMLElement).style.background === "transparent",
                      ) &&
                      Array.from(furniture.querySelectorAll("span")).every(
                        (text) =>
                          text.style.opacity === "1" && text.style.color.startsWith("color-mix("),
                      )))
                );
              },
            ),
          };
        });
        expect(details.uniformShading).toBe(true);
        const inkErrors = await page.evaluate(
          () => Reflect.get(window, "__leafInkErrors") as number[],
        );
        expect(inkErrors.every((error) => error <= 1)).toBe(true);
        expect(details.sandbox).toBe("allow-same-origin");
        expect(details.scripts).toBe(0);
        expect(details.segments).toBe(20);
        expect(details.text?.length).toBeGreaterThan(10);
        const endpoints = await page.evaluate(() => Reflect.get(window, "__leafEndpoints"));
        for (const endpoint of endpoints) {
          expect(Math.abs(endpoint.left)).toBeLessThan(1);
          expect(Math.abs(endpoint.right)).toBeLessThan(1);
        }
        if (!fixed) {
          const folios = await page.evaluate(() => Reflect.get(window, "__leafFolios"));
          expect(folios).toHaveLength(2);
          for (const face of folios) {
            expect(face.expected.some((text: string) => text.startsWith("Page "))).toBe(true);
            for (const text of face.expected) expect(face.visible).toContain(text);
          }
          const stationary = page
            .locator("[data-ambra-turn-furniture]")
            .filter({ hasText: "Page " });
          expect(
            await stationary.evaluateAll(
              (elements) =>
                elements.filter((element) => (element as HTMLElement).style.zIndex === "3").length,
            ),
          ).toBe(1);
        }
        await test.info().attach("leaf-details", {
          body: JSON.stringify(details),
          contentType: "application/json",
        });
        await test
          .info()
          .attach("leaf-in-motion", { body: await page.screenshot(), contentType: "image/png" });
        await page.screenshot({ path: test.info().outputPath("curled-leaf.png") });
        await page.evaluate(() => Reflect.get(window, "__releaseLeaf")());
        await page.evaluate(async () => {
          await Reflect.get(window, "__turnDone");
        });
        await expect(leaf).toHaveCount(0);
        await expect(page.locator("[data-ambra-turn-furniture]")).toHaveCount(0);
        expect(
          await page.evaluate(() => Reflect.get(window, "__readerController").snapshot().error),
        ).toBeUndefined();
        await page.evaluate(() => {
          const c = Reflect.get(window, "__readerController");
          Reflect.set(window, "__turnDone", c.turnPage(-1));
        });
        await expect(leaf).toBeVisible();
        await page.waitForFunction(() => !!Reflect.get(window, "__releaseLeaf"));
        await page.evaluate(() => Reflect.get(window, "__releaseLeaf")());
        await page.evaluate(async () => {
          await Reflect.get(window, "__turnDone");
        });
        await expect(leaf).toHaveCount(0);
      } finally {
        await context.close();
      }
    });
  }
}

for (const single of [false, true]) {
  for (const fixed of [false, true]) {
    for (const rtl of [false, true]) {
      for (const reducedMotion of [false, true]) {
        for (const style of ["rotate", "slide", "scroll"] as const) {
          const threshold = single && style === "rotate" ? 0.25 : 0.4;
          test(`${fixed ? "fixed" : "reflowable"} ${single ? "single" : "spread"} ${rtl ? "rtl" : "ltr"} ${style} ${reducedMotion ? "reduced motion" : "animated"}: edge drag returns, cancels and commits at ${threshold * 100}%`, async () => {
            const epub = fixed
              ? path.resolve("fixtures", rtl ? "fxl-spread-rtl.epub" : "fxl-spread-ltr.epub")
              : navigationFixture(test.info(), [50, 50]);
            if (!fixed && rtl) {
              const source = test.info().outputPath("navigation-source");
              const opf = path.join(source, "EPUB/package.opf");
              fs.writeFileSync(
                opf,
                fs
                  .readFileSync(opf, "utf8")
                  .replace("<spine>", '<spine page-progression-direction="rtl">'),
              );
              execFileSync("zip", ["-q", "-X", "-r", epub, "EPUB"], { cwd: source });
            }
            const { context, readerPage: page } = await launchReader(epub, {
              viewport: fixed && single ? { width: 680, height: 900 } : { width: 1547, height: 878 },
            });
            try {
              await exposeReaderController(page);
              await page.emulateMedia({
                reducedMotion: reducedMotion ? "reduce" : "no-preference",
              });
              await page.evaluate(
                async ({ fixed, single, style }) => {
                  const c = Reflect.get(window, "__readerController");
                  await c.setPageTurnAnimationStyle("none");
                  await c.setAlwaysShowOnePage(single);
                  if (fixed) await c.turnPage(1);
                  await c.setPageTurnAnimationStyle(style);
                },
                { fixed, single, style },
              );
              expect(
                await page.evaluate(() => Reflect.get(window, "__readerController").snapshot().isSpread),
              ).toBe(!single);
              const initial = await page.evaluate(() =>
                Reflect.get(window, "__readerController").currentReadingCfi(),
              );
              const bounds = await page.evaluate((rtl) => {
                const c = Reflect.get(window, "__readerController");
                const edges = [...c.pageMargins().edges].sort((a, b) => a.left - b.left);
                const edge = edges[rtl ? 0 : edges.length - 1];
                return {
                  x: rtl ? edge.left + 3 : edge.right - 3,
                  y: edge.top + edge.height / 2,
                  width: c.width,
                  frameWidths: c
                    .contentDocumentViews()
                    .map(
                      ({ document: doc }: { document: Document }) =>
                        doc.defaultView!.frameElement!.getBoundingClientRect().width,
                    ),
                };
              }, rtl);
              for (const [fraction, action] of [
                [threshold - 0.01, "return"],
                [0.45, "Escape"],
                [0.45, "blur"],
                [0.45, "pointercancel"],
                [threshold, "commit"],
              ] as const) {
                await page.mouse.move(bounds.x, bounds.y);
                await page.mouse.down();
                await page.mouse.move(
                  bounds.x + (rtl ? 1 : -1) * Math.ceil(bounds.width * fraction),
                  bounds.y,
                  {
                    steps: 12,
                  },
                );
                const leaf = page.locator("[data-ambra-curled-leaf]");
                await expect
                  .poll(() =>
                    page.evaluate(
                      () => Reflect.get(window, "__readerController").controlledTurn?.progress,
                    ),
                  )
                  .toBeCloseTo(fraction, 2);
                if (!reducedMotion && style === "rotate") {
                  await expect.poll(async () => Number(await leaf.getAttribute("data-progress")))
                    .toBeCloseTo(fraction, 2);
                } else {
                  await expect(leaf).toHaveCount(0);
                  if (!reducedMotion) {
                    await page.waitForFunction(
                      () => Reflect.get(window, "__readerController").isAnimatingPageTurn,
                    );
                    const widths = await page.evaluate(() =>
                      Reflect.get(window, "__readerController")
                        .contentDocumentViews()
                        .map(
                          ({ document: doc }: { document: Document }) =>
                            doc.defaultView!.frameElement!.getBoundingClientRect().width,
                        ),
                    );
                    widths.forEach((width: number, index: number) =>
                      expect(Math.abs(width - bounds.frameWidths[index])).toBeLessThan(0.1),
                    );
                  }
                }
                expect(
                  await page.evaluate(() =>
                    Reflect.get(window, "__readerController").currentReadingCfi(),
                  ),
                ).toBe(initial);
                await page.waitForTimeout(300);
                if (action === "Escape") await page.keyboard.press("Escape");
                if (action === "blur")
                  await page.evaluate(() => {
                    Object.defineProperty(document, "hasFocus", {
                      configurable: true,
                      value: () => false,
                    });
                    try {
                      window.dispatchEvent(new Event("blur"));
                    } finally {
                      Reflect.deleteProperty(document, "hasFocus");
                    }
                  });
                if (action === "pointercancel")
                  await page.evaluate(() => {
                    const c = Reflect.get(window, "__readerController");
                    document.dispatchEvent(
                      new PointerEvent("pointercancel", {
                        pointerId: c.controlledTurn.start.pointerId,
                      }),
                    );
                  });
                await page.mouse.up();
                await expect(leaf).toHaveCount(0);
                await page.waitForFunction(
                  () => !Reflect.get(window, "__readerController").isTurningPage,
                );
                const current = await page.evaluate(() =>
                  Reflect.get(window, "__readerController").currentReadingCfi(),
                );
                if (action === "commit") {
                  expect(current).not.toBe(initial);
                  const persisted = await page.evaluate(async () => {
                    const c = Reflect.get(window, "__readerController");
                    return (await c.library.getProgress(c.bookId))?.cfi;
                  });
                  expect(persisted).toBe(current);
                } else expect(current).toBe(initial);
                if (!fixed) {
                  const snapshot = await page.evaluate(() =>
                    Reflect.get(window, "__readerController").snapshot(),
                  );
                  expect(snapshot.isAnimatingPageTurn).toBe(false);
                  const numbers =
                    snapshot.spreadPageNumbers ??
                    (single
                      ? [snapshot.bookPageIndex]
                      : [snapshot.bookPageIndex, snapshot.bookPageIndex + 1]);
                  for (const number of numbers)
                    await expect(page.getByText(`Page ${number}`, { exact: true })).toHaveCount(1);
                  const titles = page.locator("[data-ambra-page-furniture='header'] > span");
                  await expect(titles.filter({ hasText: snapshot.title })).toHaveCount(1);
                  await expect(
                    titles.filter({ hasText: snapshot.currentChapterLabel }),
                  ).toHaveCount(1);
                }
                expect(
                  await page.evaluate(
                    () => Reflect.get(window, "__readerController").snapshot().error,
                  ),
                ).toBeUndefined();
              }
            } finally {
              await context.close();
            }
          });
        }
      }
    }
  }
}
