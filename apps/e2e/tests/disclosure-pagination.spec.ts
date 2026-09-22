import { chromium, expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EXTENSION_PATH, launchReader } from "../harness.js";

// Issue #132. Generate: node apps/e2e/scripts/generate-disclosure-fixture.mjs
// Do not weaken/skip failures when native <details>
// toggles fail to invalidate pagination or are lost when hosts are recreated.
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../real-books/disclosure-pagination",
);
const fixtures = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/disclosure-pagination",
);
test.setTimeout(90_000);

async function sample(page: Page) {
  return page.evaluate(() => {
    const frames = Array.from(document.querySelectorAll("iframe")).filter(
      (f) => f.getBoundingClientRect().width > 0 && getComputedStyle(f).visibility !== "hidden",
    );
    const lines: string[] = [];
    const states: boolean[] = [];
    for (const frame of frames) {
      const doc = frame.contentDocument;
      if (!doc) continue;
      const details = doc.querySelector<HTMLDetailsElement>("#long-disclosure");
      if (details) states.push(details.open);
      for (const line of doc.querySelectorAll<HTMLElement>("[data-line]")) {
        const rect = line.getBoundingClientRect();
        // Hit-test both documents: the outer iframe clip must contain the line,
        // not merely the full flowing document's DOM/innerText.
        const x = rect.left + 10;
        const y = rect.top + rect.height / 2;
        const box = frame.getBoundingClientRect();
        if (
          rect.height > 0 &&
          doc.elementFromPoint(x, y)?.closest("[data-line]") === line &&
          document.elementFromPoint(box.left + x, box.top + y) === frame
        )
          lines.push(line.dataset.line!);
      }
    }
    const slider = document.querySelector('[role="slider"][aria-label="Position in book"]');
    const position = slider?.getAttribute("aria-valuetext") ?? "";
    return { position, states, lines };
  });
}

async function move(page: Page, key: "ArrowRight" | "ArrowLeft") {
  const before = await sample(page);
  await page.keyboard.press(key);
  // The production page-turn animation finishes before we sample painted
  // content, including its outgoing/incoming sibling iframes.
  await page.waitForTimeout(650);
  return { before, after: await sample(page) };
}

for (const fixture of ["initially-closed", "closed-no-summary", "closed-contents-wrapper"]) {
  test(`${fixture}: hidden descendants do not create duplicate content or phantom pages`, async () => {
    const { context, readerPage } = await launchReader(path.join(fixtures, `${fixture}.epub`), {
      viewport: { width: 760, height: 900 },
    });
    try {
      await expect.poll(async () => (await sample(readerPage)).position).toMatch(/Page 1 of 2 /);
      const first = await sample(readerPage);
      const { after: second } = await move(readerPage, "ArrowRight");
      expect(second.position).toMatch(/Page 2 of 2 /);
      expect([...first.lines, ...second.lines]).toEqual(
        Array.from({ length: 40 }, (_, index) => `T${String(index + 1).padStart(3, "0")}`),
      );
      const { after: end } = await move(readerPage, "ArrowRight");
      expect(end).toEqual(second);
      const { after: back } = await move(readerPage, "ArrowLeft");
      expect(back).toEqual(first);
    } finally {
      await context.close();
    }
  });
}

for (const width of [760, 1400]) {
  for (const authoredOpen of [false, true]) {
    test(`${width}px ${authoredOpen ? "authored-open" : "user-expanded"} disclosure survives turns and preserves every line (#132)`, async () => {
      const profile = path.join(root, `profile-${process.pid}-${Date.now()}`);
      const runtime = path.join(root, "runtime");
      fs.mkdirSync(runtime, { recursive: true });
      fs.mkdirSync(profile, { recursive: true });
      const context = await chromium.launchPersistentContext(profile, {
        headless: false,
        args: [
          `--disable-extensions-except=${EXTENSION_PATH}`,
          `--load-extension=${EXTENSION_PATH}`,
        ],
        viewport: { width, height: 900 },
        env: { ...process.env, TMPDIR: runtime },
      });
      try {
        const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
        const library = await context.newPage();
        await library.goto(
          `chrome-extension://${worker.url().split("/")[2]}/src/library/index.html`,
        );
        await library
          .locator('input[type="file"]')
          .setInputFiles(
            path.join(fixtures, `${authoredOpen ? "authored-open" : "initially-closed"}.epub`),
          );
        const opening = context.waitForEvent("page");
        await library.getByRole("button", { name: /^Open / }).click({ force: true });
        const page = await opening;
        await page.bringToFront();
        const disclosure = page.frameLocator("iframe").first().locator("#long-disclosure");
        await expect(disclosure).toBeAttached();
        await expect.poll(async () => (await sample(page)).position).toMatch(/Page \d+ of \d+/);
        const collapsed = await sample(page);
        if (!authoredOpen) {
          await disclosure.locator("summary").click();
          await expect(disclosure).toHaveAttribute("open", "");
          await page.waitForTimeout(1000);
        }
        await page.mouse.move(0, 450);
        const expanded = await sample(page);
        const forward = [expanded];
        for (let turn = 0; turn < 20; turn++) {
          const { before, after } = await move(page, "ArrowRight");
          if (after.position === before.position) break;
          forward.push(after);
        }
        const backward = [forward.at(-1)!];
        for (let turn = 0; turn < 20; turn++) {
          const { before, after } = await move(page, "ArrowLeft");
          if (after.position === before.position) break;
          backward.push(after);
        }
        const report = { width, authoredOpen, collapsed, expanded, forward, backward };
        fs.writeFileSync(
          test.info().outputPath("measurements.json"),
          JSON.stringify(report, null, 2),
        );
        console.log(
          `disclosure-pagination: ${JSON.stringify({
            width,
            authoredOpen,
            collapsed: collapsed.position,
            expanded: expanded.position,
            forward: forward.map((s) => ({
              position: s.position,
              states: s.states,
              first: s.lines[0],
              last: s.lines.at(-1),
              count: s.lines.length,
            })),
            backward: backward.map((s) => ({
              position: s.position,
              states: s.states,
              first: s.lines[0],
              last: s.lines.at(-1),
              count: s.lines.length,
            })),
          })}`,
        );
        await test.info().attach("disclosure-pagination.json", {
          body: JSON.stringify(report, null, 2),
          contentType: "application/json",
        });
        if (!authoredOpen) {
          const total = (label: string) => Number(label.match(/of (\d+)/)?.[1]);
          expect
            .soft(total(expanded.position), "opening 90 lines must repaginate the book")
            .toBeGreaterThan(total(collapsed.position));
        }
        expect
          .soft(
            forward.every((s) => s.states.length > 0 && s.states.every(Boolean)),
            "expanded state survives forward host recreation",
          )
          .toBe(true);
        expect
          .soft(
            backward.every((s) => s.states.length > 0 && s.states.every(Boolean)),
            "expanded state survives backward host recreation",
          )
          .toBe(true);
        const expected = [
          ...Array.from({ length: 90 }, (_, i) => `D${String(i + 1).padStart(3, "0")}`),
          ...Array.from({ length: 40 }, (_, i) => `T${String(i + 1).padStart(3, "0")}`),
        ];
        expect
          .soft(
            forward.flatMap((s) => s.lines),
            "each expanded line is visible exactly once in forward order",
          )
          .toEqual(expected);
        expect
          .soft(
            backward.reverse().flatMap((s) => s.lines),
            "each expanded line is visible exactly once after navigating back",
          )
          .toEqual(expected);
      } finally {
        await context.close();
        fs.rmSync(profile, { recursive: true, force: true });
      }
    });
  }
}
