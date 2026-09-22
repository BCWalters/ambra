import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { launchReader } from "../harness.js";

const here = path.dirname(fileURLToPath(import.meta.url));
let rtlBook: string;
let rtlChainedBook: string;
test.beforeAll(async ({ browserName }, info) => {
  const source = path.join(info.project.outputDir, `rtl-fixture-${browserName}`);
  fs.mkdirSync(source, { recursive: true });
  execFileSync("unzip", [
    "-q",
    "-o",
    path.resolve(here, "../fixtures/two-chapter.epub"),
    "-d",
    source,
  ]);
  const opf = path.join(source, "OEBPS/content.opf");
  fs.writeFileSync(
    opf,
    fs.readFileSync(opf, "utf8").replace("<spine", '<spine page-progression-direction="rtl"'),
  );
  rtlBook = path.join(info.project.outputDir, "reflowable-rtl.epub");
  execFileSync("zip", ["-q", "-X", "-0", rtlBook, "mimetype"], { cwd: source });
  execFileSync("zip", ["-q", "-X", "-r", rtlBook, "META-INF", "OEBPS"], { cwd: source });
  const chainedSource = path.join(info.project.outputDir, `rtl-chained-${browserName}`);
  fs.mkdirSync(chainedSource, { recursive: true });
  execFileSync("unzip", ["-q", "-o", path.resolve(here, "../fixtures/chained-single-page-chapters.epub"), "-d", chainedSource]);
  const chainedOpf = path.join(chainedSource, "OEBPS/package.opf");
  fs.writeFileSync(chainedOpf, fs.readFileSync(chainedOpf, "utf8").replace("<spine", '<spine page-progression-direction="rtl"'));
  rtlChainedBook = path.join(info.project.outputDir, "rtl-chained.epub");
  execFileSync("zip", ["-q", "-X", "-0", rtlChainedBook, "mimetype"], { cwd: chainedSource });
  execFileSync("zip", ["-q", "-X", "-r", rtlChainedBook, "META-INF", "OEBPS"], { cwd: chainedSource });
});

for (const direction of ["ltr", "rtl"]) {
  test(`${direction}: notes belong to the correct chapter and physical page of a boundary spread (#129, #100)`, async () => {
    const book = direction === "rtl" ? rtlChainedBook : path.resolve(here, "../fixtures/chained-single-page-chapters.epub");
    const { context, readerPage: page } = await launchReader(book, { viewport: { width: 1400, height: 900 } });
    try {
      await page.locator("iframe").first().evaluate(frame => {
        const doc = (frame as HTMLIFrameElement).contentDocument!;
        const range = doc.createRange();
        range.selectNodeContents(doc.querySelector("p")!);
        const selection = doc.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
        doc.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
      });
      await page.getByRole("button", { name: "Add note" }).click();
      await page.getByPlaceholder("Add a note…").fill("Note on the previous chapter of this pair");
      await page.getByRole("button", { name: "Save", exact: true }).click();
      const marker = page.getByRole("button", { name: "This highlight has a note" });
      await expect(marker).toHaveCount(1);
      const initial = await marker.boundingBox();
      expect(initial).not.toBeNull();
      if (direction === "rtl") expect(initial!.x).toBeGreaterThan(700);
      else expect(initial!.x).toBeLessThan(700);
      await page.keyboard.press("Escape");
      await page.keyboard.press(direction === "rtl" ? "ArrowLeft" : "ArrowRight");
      await page.waitForTimeout(600);
      await expect(marker).toHaveCount(0);
      await page.keyboard.press(direction === "rtl" ? "ArrowRight" : "ArrowLeft");
      await page.waitForTimeout(600);
      await expect(marker).toHaveCount(1);
      expect(await marker.boundingBox()).toEqual(initial);
    } finally {
      await context.close();
    }
  });
}

async function signature(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("iframe"))
      .filter((frame) => getComputedStyle(frame).visibility !== "hidden")
      .sort((a, b) => a.getBoundingClientRect().x - b.getBoundingClientRect().x)
      .map((frame) => {
        const doc = frame.contentDocument!;
        return `${doc.querySelector("h1")?.textContent}:${doc.body.style.transform}`;
      }),
  );
}

for (const width of [760, 1400]) {
  for (const style of ["slide", "rotate", "scroll"] as const) {
    test(`RTL ${width} ${style}: arrows, Space, chapter shortcuts, clicks, swipes and scrubber (#100)`, async () => {
      const { context, readerPage: page } = await launchReader(rtlBook, {
        viewport: { width, height: 900 },
      });
      const key = async (value: string) => {
        await page.keyboard.press(value);
        await page.waitForTimeout(550);
      };
      try {
        if (style !== "slide") {
          await page.getByRole("button", { name: "Settings" }).click();
          await page
            .getByRole("menuitemradio", { name: style === "rotate" ? /Page flip/ : /Film strip/ })
            .click();
          await page.keyboard.press("Escape");
        }
        await page.locator("iframe").first().evaluate(frame => {
          (frame as HTMLIFrameElement).focus();
          (frame as HTMLIFrameElement).contentDocument!.body.focus();
        });
        const initial = await signature(page);
        // The EPUB prose remains LTR; progression only mirrors page placement.
        expect(
          await page.evaluate(() =>
            Array.from(document.querySelectorAll("iframe")).map(
              (frame) =>
                frame.contentWindow!.getComputedStyle(frame.contentDocument!.body).direction,
            ),
          ),
        ).toEqual(width === 1400 ? ["ltr", "ltr"] : ["ltr"]);
        if (width === 1400) {
          const offsets = initial.map((text) => Number(text.match(/translateY\(([-\d.]+)px/)?.[1]));
          expect(offsets[0]).toBeLessThan(offsets[1]!);
          const folios = await page
            .getByText(/^Page \d+$/, { exact: true })
            .evaluateAll((elements) =>
              elements
                .map((element) => ({
                  number: Number(element.textContent!.slice(5)),
                  x: element.getBoundingClientRect().x,
                }))
                .sort((a, b) => a.x - b.x),
            );
          expect(folios).toHaveLength(2);
          expect(folios[0]!.number).toBe(folios[1]!.number + 1);
        }
        await key("ArrowLeft");
        const next = await signature(page);
        expect(next).not.toEqual(initial);
        await key("ArrowRight");
        expect(await signature(page)).toEqual(initial);
        await key("Space");
        expect(await signature(page)).toEqual(next);
        await key("Shift+Space");
        expect(await signature(page)).toEqual(initial);
        await page.mouse.click(40, 450);
        await page.waitForTimeout(550);
        expect(await signature(page)).toEqual(next);
        await page.mouse.click(width - 40, 450);
        await page.waitForTimeout(550);
        expect(await signature(page)).toEqual(initial);

        // Swipe right is forward in RTL. Dispatch touch pointer events to
        // avoid native mouse text selection, which correctly cancels turns.
        await page
          .locator("iframe")
          .last()
          .evaluate((frame) => {
            const doc = (frame as HTMLIFrameElement).contentDocument!;
            const event = (type: string, x: number) =>
              new PointerEvent(type, {
                pointerId: 7,
                pointerType: "touch",
                clientX: x,
                clientY: 450,
                bubbles: true,
              });
            doc.body.dispatchEvent(event("pointerdown", 100));
            doc.dispatchEvent(event("pointermove", 700));
            doc.dispatchEvent(event("pointerup", 700));
          });
        await page.waitForTimeout(650);
        expect(await signature(page)).toEqual(next);
        await key("ArrowRight");
        expect(await signature(page)).toEqual(initial);

        await key("Control+ArrowLeft");
        expect((await signature(page)).join(" ")).not.toEqual(initial.join(" "));
        await key("Control+ArrowRight");
        expect(await signature(page)).toEqual(initial);

        const slider = page.getByRole("slider", { name: "Position in book" });
        await slider.focus();
        await slider.press("End");
        await page.waitForTimeout(700);
        const box = await slider.boundingBox();
        expect(box).not.toBeNull();
        // Physical right edge seeks to the start in RTL.
        await page.mouse.click(box!.x + box!.width - 1, box!.y + box!.height / 2);
        await page.waitForTimeout(700);
        expect(await signature(page)).toEqual(initial);
      } finally {
        await context.close();
      }
    });
  }
}
