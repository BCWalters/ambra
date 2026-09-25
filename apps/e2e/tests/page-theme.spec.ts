import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

const sourceBook = fileURLToPath(new URL("../fixtures/two-chapter.epub", import.meta.url));
const fixed = fileURLToPath(new URL("../fixtures/fxl-spread-ltr.epub", import.meta.url));
const palettes = {
  White: ["rgb(255, 255, 255)", "rgb(26, 26, 26)", "rgb(11, 87, 164)"],
  Sepia: ["rgb(250, 247, 241)", "rgb(35, 32, 25)", "rgb(42, 93, 176)"],
  Dark: ["rgb(35, 35, 35)", "rgb(232, 230, 225)", "rgb(138, 180, 248)"],
} as const;

function publisherThemeBook(info: TestInfo): string {
  if (process.env.AMBRA_E2E_ALICE_EPUB) return process.env.AMBRA_E2E_ALICE_EPUB;
  const source = info.outputPath("publisher-theme-source");
  fs.mkdirSync(source, { recursive: true });
  execFileSync("unzip", ["-q", sourceBook, "-d", source]);
  for (const chapter of ["ch1.xhtml", "ch2.xhtml"]) {
    const file = path.join(source, "OEBPS", chapter);
    const content = fs.readFileSync(file, "utf8");
    expect(content).toContain("<body>");
    expect(content).toContain("</head>");
    fs.writeFileSync(file, content
      .replace("<body>", '<body class="tei tei-text">')
      .replace("</head>", `<style>
        body.tei.tei-text { color: black; background-color: white; }
        a:link, a:visited { color: blue; }
      </style></head>`));
  }
  const book = info.outputPath("publisher-theme.epub");
  execFileSync("zip", ["-q", "-X", "-0", book, "mimetype"], { cwd: source });
  execFileSync("zip", ["-q", "-X", "-r", book, "META-INF", "OEBPS"], { cwd: source });
  return book;
}

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
  test(`#185 page palettes override publisher resets in ${mode} mode`, async () => {
    const { context, readerPage: page } = await launchReader(publisherThemeBook(test.info()), {
      viewport: { width: mode === "spread" ? 1400 : 900, height: 900 },
    });
    try {
      await exposeReaderController(page);
      await page.evaluate(async ({ mode, initialSpine }) => {
        const controller = Reflect.get(window, "__readerController");
        if (mode === "scroll") await controller.setViewMode("scroll");
        await controller.openSpineItem(initialSpine);
      }, { mode, initialSpine: process.env.AMBRA_E2E_ALICE_EPUB ? 3 : 0 });
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
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      for (const name of ["Sepia", "White", "Dark"] as const) {
        const choice = page.getByRole("combobox", { name: "Page theme", exact: true });
        await choice.selectOption(name.toLowerCase());
        await expect(choice).toHaveValue(name.toLowerCase());
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

test("#203 page theme syncs between Library and different books, persists, and overrides legacy book themes", async () => {
  const { context, libraryPage: library, readerPage: first } = await launchReader(sourceBook);
  try {
    await exposeReaderController(first);
    await library.locator('input[type="file"]').setInputFiles(
      fileURLToPath(new URL("../fixtures/long-content.epub", import.meta.url)),
    );
    const opened = context.waitForEvent("page");
    await library.getByRole("button", { name: /^Open Ambra Long Content/ }).click();
    const second = await opened;
    await expect(second.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
    await exposeReaderController(second);
    await library.getByRole("button", { name: "Settings", exact: true }).click();
    const libraryTheme = library.getByRole("combobox", { name: "Page theme", exact: true });
    await libraryTheme.selectOption("sepia");
    for (const page of [first, second])
      await expect.poll(() => canvasColors(page)).toEqual([palettes.Sepia.slice(0, 2)]);

    await first.getByRole("button", { name: "Settings", exact: true }).focus();
    await first.getByRole("button", { name: "Settings", exact: true }).press("Enter");
    await first.getByRole("combobox", { name: "Page theme", exact: true }).selectOption("dark");
    await expect(libraryTheme).toHaveValue("dark");
    for (const page of [first, second])
      await expect.poll(() => canvasColors(page)).toEqual([palettes.Dark.slice(0, 2)]);

    // Emulate an existing v7 per-book record. It must not override app settings on reopen.
    await first.evaluate(async () => {
      const c = Reflect.get(window, "__readerController");
      const settings = await c.library.getBookReadingSettings(c.bookId);
      await new Promise<void>((resolve, reject) => {
        const tx = c.library.db.transaction("bookReadingSettings", "readwrite");
        tx.objectStore("bookReadingSettings").put({ bookId: c.bookId, settings: { ...settings, pageTheme: "sepia" } });
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
      });
    });
    await first.reload();
    await expect(first.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
    await exposeReaderController(first);
    await expect.poll(() => canvasColors(first)).toEqual([palettes.Dark.slice(0, 2)]);
    await library.reload();
    await library.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(libraryTheme).toHaveValue("dark");
    for (const page of [library, first, second]) await expect(page.getByRole("alert")).toHaveCount(0);
  } finally {
    await context.close();
  }
});
