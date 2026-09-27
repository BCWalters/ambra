import { expect, test, type Locator, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";
import { contentStressCases, generateContentStressFixture } from "../content-stress-fixtures.js";

const generator = fileURLToPath(
  new URL("../scripts/generate-wide-table-repro.mjs", import.meta.url),
);

function minimalBook(directory: string, rtl = false): string {
  execFileSync(process.execPath, [generator, directory]);
  const book = path.join(directory, "wide-table.epub");
  if (rtl) {
    const root = path.join(directory, "source");
    const chapter = path.join(root, "EPUB/ch1.xhtml");
    const opf = path.join(root, "EPUB/package.opf");
    fs.writeFileSync(
      chapter,
      fs.readFileSync(chapter, "utf8").replace("<body>", '<body dir="rtl">'),
    );
    fs.writeFileSync(
      opf,
      fs.readFileSync(opf, "utf8").replace("<spine>", '<spine page-progression-direction="rtl">'),
    );
    execFileSync("zip", ["-q", "-X", book, "EPUB/ch1.xhtml", "EPUB/package.opf"], { cwd: root });
  }
  return book;
}

function styledBook(directory: string): string {
  const book = minimalBook(directory);
  const root = path.join(directory, "source");
  const chapter = path.join(root, "EPUB/ch1.xhtml");
  const xhtml = fs.readFileSync(chapter, "utf8");
  const rows = Array.from(
    { length: 24 },
    (_, row) =>
      `<tr><th scope="row">Row ${row + 1}</th><td>${
        row === 0
          ? '<img src="ornament.svg" alt="Synthetic ornament"/><table aria-label="Nested observations"><tr><td>Nested value</td></tr></table>'
          : `Observation ${row + 1}`
      }</td><td>Far cell ${row + 1}</td></tr>`,
  ).join("");
  fs.writeFileSync(
    chapter,
    xhtml
      .replace(
        "</style>",
        `
      body { --publisher-ink: #204060; }
      button { display: none !important; }
      .volume { color: var(--publisher-ink); font-family: monospace; }
      .volume > .frame > table { width: 1320px; table-layout: fixed; border: 3px solid #705020; }
      .volume > .frame > table > tbody > tr > td,
      .volume > .frame > table > tbody > tr > th { height: 48px; padding: 8px; }
      caption { text-align: start; background: #e0e8f0; }
      img { width: 48px; height: 32px; }
    </style>`,
      )
      .replace(
        /<body>[\s\S]*<\/body>/,
        `<body><h2 id="table">Wide table</h2>
      <div class="volume"><div class="frame"><table id="observations">
        <caption>Publisher field observations</caption>
        <thead><tr><th scope="col">Row</th><th scope="col">Observation</th><th scope="col">Far column</th></tr></thead>
        <tbody>${rows}</tbody></table></div></div>
      <p id="after">End of document.</p></body>`,
      ),
  );
  fs.writeFileSync(
    path.join(root, "EPUB/ornament.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="32"><rect width="48" height="32" fill="teal"/></svg>',
  );
  const opf = path.join(root, "EPUB/package.opf");
  fs.writeFileSync(
    opf,
    fs
      .readFileSync(opf, "utf8")
      .replace("urn:ambra:wide-table-repro", "urn:ambra:table-viewer-publisher-styles")
      .replace("Wide table reproduction", "Table viewer - publisher styles")
      .replace(
        "</manifest>",
        '<item id="ornament" href="ornament.svg" media-type="image/svg+xml"/></manifest>',
      ),
  );
  execFileSync(
    "zip",
    ["-q", "-X", book, "EPUB/ch1.xhtml", "EPUB/package.opf", "EPUB/ornament.svg"],
    { cwd: root },
  );
  return book;
}

async function sourceSnapshot(page: Page) {
  return page.evaluate(() => {
    const c = Reflect.get(window, "__readerController");
    const s = c.snapshot();
    const doc = c.primaryContentDocument() as Document;
    const table = doc.querySelector("table")!;
    const style = doc.defaultView!.getComputedStyle(table);
    return {
      spine: s.spineIndex as number,
      page: s.pageIndex as number,
      pages: s.bookPageCount as number | undefined,
      markup: table.innerHTML,
      width: table.offsetWidth,
      color: style.color,
      font: style.fontFamily,
      fontSize: style.fontSize,
    };
  });
}

function expandButton(page: Page) {
  return page
    .getByRole("main")
    .frameLocator("iframe")
    .first()
    .getByRole("button", { name: "Expand table", exact: true })
    .first();
}

async function expectCellVisible(page: Page, cell: Locator) {
  const viewport = page
    .getByRole("dialog", { name: "Table viewer", exact: true })
    .locator("iframe");
  await expect
    .poll(
      async () => {
        const box = await cell.boundingBox();
        const frame = await viewport.boundingBox();
        return (
          !!box &&
          !!frame &&
          box.x >= frame.x - 1 &&
          box.y >= frame.y - 1 &&
          box.x + box.width <= frame.x + frame.width + 1 &&
          box.y + box.height <= frame.y + frame.height + 1
        );
      },
      { message: "the complete requested table cell is inside the viewer viewport" },
    )
    .toBe(true);
}

async function wheelToCell(page: Page, cell: Locator) {
  const viewport = page
    .getByRole("dialog", { name: "Table viewer", exact: true })
    .locator("iframe");
  const frame = (await viewport.boundingBox())!;
  const box = (await cell.boundingBox())!;
  const x =
    box.x < frame.x
      ? box.x - frame.x - 40
      : box.x + box.width > frame.x + frame.width
        ? box.x + box.width - frame.x - frame.width + 40
        : 0;
  const y =
    box.y < frame.y
      ? box.y - frame.y - 40
      : box.y + box.height > frame.y + frame.height
        ? box.y + box.height - frame.y - frame.height + 40
        : 0;
  await page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 2);
  await page.mouse.wheel(x, y);
  await expectCellVisible(page, cell);
}

for (const [width, mode] of [
  [600, "paginated"],
  [1400, "paginated"],
  [900, "scroll"],
  [900, "rtl"],
] as const) {
  test(`table viewer exposes clipped cells without changing reading layout (${width}px ${mode}, #229)`, async () => {
    const book = minimalBook(test.info().outputPath("fixture"), mode === "rtl");
    const { context, readerPage: page } = await launchReader(book, {
      viewport: { width, height: 900 },
      showScrollbars: true,
    });
    try {
      await exposeReaderController(page);
      if (mode === "scroll")
        await page.evaluate(() => Reflect.get(window, "__readerController").setViewMode("scroll"));
      else await expect.poll(async () => (await sourceSnapshot(page)).pages).toBeGreaterThan(0);
      const before = await sourceSnapshot(page);
      const trigger = expandButton(page);
      await expect(trigger).toBeVisible();
      await page.screenshot({ path: test.info().outputPath(`table-trigger-${width}-${mode}.png`) });
      await trigger.focus();
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog", { name: "Table viewer", exact: true });
      await expect(dialog).toBeVisible();
      const frame = dialog.frameLocator("iframe");
      const table = frame.getByRole("table");
      await expect(table).toBeVisible();
      await expect(dialog).toHaveCSS("background-color", "rgba(10, 8, 6, 0.82)");
      const overlayBounds = (await dialog.boundingBox())!;
      const surfaceBounds = (await dialog.locator("iframe").boundingBox())!;
      expect(surfaceBounds.x - overlayBounds.x).toBeGreaterThanOrEqual(overlayBounds.width * 0.049);
      expect(surfaceBounds.x + surfaceBounds.width).toBeLessThanOrEqual(overlayBounds.x + overlayBounds.width * 0.951);
      expect(surfaceBounds.height).toBeLessThan(overlayBounds.height / 2);
      expect(surfaceBounds.y - overlayBounds.y).toBeGreaterThan(64);
      await expect(table.getByRole("columnheader")).toHaveCount(3);
      await expect(dialog.locator("output")).toHaveText("100%");
      const sandbox = await dialog.locator("iframe").getAttribute("sandbox");
      expect(sandbox).not.toBeNull();
      expect(sandbox).not.toMatch(/allow-(scripts|forms|top-navigation|popups)/);
      const last = table.getByRole("columnheader", { name: "Column 3", exact: true });
      await wheelToCell(page, last);
      await page.screenshot({ path: test.info().outputPath(`table-viewer-${width}-${mode}.png`) });

      const naturalWidth = (await table.boundingBox())!.width;
      const fontSize = await table.evaluate((node) => getComputedStyle(node).fontSize);
      await dialog.getByRole("button", { name: "Zoom in", exact: true }).click();
      await expect
        .poll(async () => Number((await dialog.locator("output").innerText()).replace("%", "")))
        .toBeGreaterThan(100);
      const percent = Number((await dialog.locator("output").innerText()).replace("%", ""));
      expect((await table.boundingBox())!.width / naturalWidth).toBeCloseTo(percent / 100, 2);
      expect(await table.evaluate((node) => getComputedStyle(node).fontSize)).toBe(fontSize);
      await dialog.getByRole("button", { name: "Actual size", exact: true }).click();
      await expect(dialog.locator("output")).toHaveText("100%");

      for (let i = 0; i < 10; i++) {
        await page.keyboard.press("Tab");
        await expect
          .poll(() => dialog.evaluate((node) => node.contains(document.activeElement)))
          .toBe(true);
      }
      await dialog.getByRole("button", { name: "Close", exact: true }).focus();
      await page.keyboard.press("Shift+Tab");
      await expect(dialog.locator("iframe")).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Shift+Tab");
      await expect(dialog.getByRole("button", { name: "Actual size", exact: true })).toBeFocused();
      await table.getByRole("columnheader", { name: "Column 1", exact: true }).click();
      for (const key of ["ArrowRight", "PageDown", "Home", "End"]) {
        await page.keyboard.press(key);
        expect(await sourceSnapshot(page)).toEqual(before);
      }
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(trigger).toBeFocused();
      expect(await sourceSnapshot(page)).toEqual(before);
      await page.keyboard.press("Enter");
      await expect(dialog).toBeVisible();
      await expect(dialog.locator("output")).toHaveText("100%");
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(trigger).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(dialog).toBeVisible();
      await dialog.click({ position: { x: 4, y: overlayBounds.height / 2 } });
      await expect(dialog).toBeHidden();
      await expect(trigger).toBeFocused();
    } finally {
      await context.close();
    }
  });
}

test("table viewer preserves inherited publisher styling, nested tables and resource images (#229)", async () => {
  const { context, readerPage: page } = await launchReader(
    styledBook(test.info().outputPath("fixture")),
    {
      viewport: { width: 760, height: 900 },
      showScrollbars: true,
    },
  );
  try {
    await exposeReaderController(page);
    await expect.poll(async () => (await sourceSnapshot(page)).pages).toBeGreaterThan(0);
    await expect(expandButton(page)).toBeHidden();
    await page.evaluate(() => Reflect.get(window, "__readerController").turnPage(1));
    await expect(expandButton(page)).toBeVisible();
    const before = await sourceSnapshot(page);
    const source = page.getByRole("main").frameLocator("iframe").first();
    await expect(source.getByRole("button", { name: "Expand table", exact: true })).toHaveCount(1);
    await expandButton(page).click();
    const dialog = page.getByRole("dialog", { name: "Table viewer", exact: true });
    const frame = dialog.frameLocator("iframe");
    const table = frame.locator("#observations");
    await expect(table).toBeVisible();
    const expectNoHorizontalScroll = async () => {
      await expect.poll(() => table.evaluate(node => {
        const root = node.ownerDocument.documentElement;
        return root.scrollWidth - root.clientWidth;
      }), { message: "a table that fits the overlay does not scroll through empty ancestor width" }).toBeLessThanOrEqual(1);
    };
    const expectCentered = async () => {
      await expect.poll(async () => {
        const bounds = (await table.boundingBox())!;
        const overlay = (await dialog.boundingBox())!;
        return Math.abs(bounds.x + bounds.width / 2 - (overlay.x + overlay.width / 2));
      }, { message: "the table itself is horizontally centered, not just its iframe" }).toBeLessThanOrEqual(1);
    };
    await expectCentered();
    await expectNoHorizontalScroll();
    await dialog.getByRole("button", { name: "Zoom out", exact: true }).click();
    await expectCentered();
    await expectNoHorizontalScroll();
    await dialog.getByRole("button", { name: "Actual size", exact: true }).click();
    await expectCentered();
    await expectNoHorizontalScroll();
    await table.evaluate(node => {
      const style = node.ownerDocument.createElement("style");
      // Model system scrollbars that occupy layout space instead of overlaying it.
      style.textContent = "html::-webkit-scrollbar { width: 16px; height: 16px; }";
      node.ownerDocument.head.append(style);
    });
    await expect.poll(() => table.evaluate(node => {
      const doc = node.ownerDocument;
      return doc.defaultView!.innerWidth - doc.documentElement.clientWidth;
    })).toBe(16);
    await expectNoHorizontalScroll();
    await expectCentered();
    await expect(table.locator("caption")).toHaveText("Publisher field observations");
    await expect(table.getByRole("table", { name: "Nested observations" })).toBeVisible();
    await expect(table).toHaveCSS("color", before.color);
    await expect(table).toHaveCSS("font-family", before.font);
    await expect(table).toHaveCSS("border-top-color", "rgb(112, 80, 32)");
    await expect
      .poll(() =>
        frame
          .getByRole("img", { name: "Synthetic ornament" })
          .evaluate(
            (node) =>
              (node as HTMLImageElement).complete && (node as HTMLImageElement).naturalWidth > 0,
          ),
      )
      .toBe(true);
    await wheelToCell(page, table.getByRole("cell", { name: "Far cell 24", exact: true }));
    await page.screenshot({ path: test.info().outputPath("table-viewer-styled-far-cell.png") });
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    expect(await sourceSnapshot(page)).toEqual(before);
  } finally {
    await context.close();
  }
});

test("twelve-column stress table remains fully reachable at narrow width and after resize (#229)", async () => {
  const variation = contentStressCases.find((item) => item.id === "wide-table-pre-narrow")!;
  const { book } = generateContentStressFixture(test.info().outputPath("fixture"), variation);
  const { context, readerPage: page } = await launchReader(book, {
    viewport: { width: 600, height: 900 },
  });

  try {
    await exposeReaderController(page);
    await expandButton(page).click();
    const dialog = page.getByRole("dialog", { name: "Table viewer", exact: true });
    const table = dialog.frameLocator("iframe").getByRole("table");
    await expect(table.getByRole("columnheader")).toHaveCount(12);
    await wheelToCell(page, table.getByRole("columnheader", { name: "Column 12", exact: true }));
    await page.setViewportSize({ width: 320, height: 780 });
    const controls = dialog.getByRole("button");
    for (const control of await controls.all()) {
      const box = (await control.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(320);
    }
    await dialog.getByRole("button", { name: "Zoom out", exact: true }).click();
    await wheelToCell(page, table.getByRole("columnheader", { name: "Column 12", exact: true }));
    await page.screenshot({ path: test.info().outputPath("table-viewer-320px.png") });
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  } finally {
    await context.close();
  }
});

test("table viewer follows page themes and leaves the source unchanged across opening and dismissal (#229)", async () => {
  const { context, readerPage: page } = await launchReader(
    minimalBook(test.info().outputPath("fixture")),
    {
      viewport: { width: 760, height: 900 },
    },
  );
  try {
    await exposeReaderController(page);
    for (const theme of ["Dark", "Sepia", "White"]) {
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page.getByRole("menuitem", { name: /^Page theme/ }).click();
      const option = page.getByRole("menuitemradio", { name: theme, exact: true });
      await option.click();
      await expect(option).toHaveAttribute("aria-checked", "true");
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await expect(page.getByRole("menu")).toHaveCount(0);
      const before = await sourceSnapshot(page);
      await expandButton(page).click();
      const dialog = page.getByRole("dialog", { name: "Table viewer", exact: true });
      const table = dialog.frameLocator("iframe").getByRole("table");
      await expect(table).toBeVisible();
      await expect(table).toHaveCSS("color", before.color);
      await page.screenshot({ path: test.info().outputPath(`table-theme-${theme}.png`) });
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await expect(dialog).toBeHidden();
      expect(await sourceSnapshot(page)).toEqual(before);
    }
    await expandButton(page).click();
    const dialog = page.getByRole("dialog", { name: "Table viewer", exact: true });
    await expect(dialog.frameLocator("iframe").getByRole("table")).toBeVisible();
    for (let i = 0; i < 15; i++) await page.keyboard.press("+");
    await expect(dialog.locator("output")).toHaveText("400%");
    await expect(dialog.getByRole("button", { name: "Zoom in", exact: true })).toBeDisabled();
    for (let i = 0; i < 18; i++) await page.keyboard.press("-");
    await expect(dialog.locator("output")).toHaveText("25%");
    await expect(dialog.getByRole("button", { name: "Zoom out", exact: true })).toBeDisabled();
    await page.keyboard.press("0");
    await expect(dialog.locator("output")).toHaveText("100%");
    await page.evaluate(() => Reflect.get(window, "__readerController").turnPage(1));
    await expect(dialog).toBeHidden();
  } finally {
    await context.close();
  }
});

test("table viewer keeps text and disclosures usable but makes links and forms read-only (#229)", async () => {
  const directory = test.info().outputPath("fixture");
  const book = minimalBook(directory);
  const root = path.join(directory, "source");
  const chapter = path.join(root, "EPUB/ch1.xhtml");
  fs.writeFileSync(
    chapter,
    fs.readFileSync(chapter, "utf8").replace(
      "</tbody>",
      `<tr><td colspan="3">
      <p><span id="selection">Selectable table text</span></p>
      <a href="#table">Chapter link</a>
      <details><summary>More observations</summary><p>Disclosed observation</p></details>
      <pre style="width:160px;overflow:auto;white-space:pre">${"Wide nested code sample ".repeat(20)}</pre>
      <form><label>Value<input name="value"/></label><button type="submit">Save</button></form>
    </td></tr></tbody>`,
    ),
  );
  execFileSync("zip", ["-q", "-X", book, "EPUB/ch1.xhtml"], { cwd: root });
  const { context, readerPage: page } = await launchReader(book, {
    viewport: { width: 900, height: 900 },
  });
  try {
    await exposeReaderController(page);
    await expandButton(page).click();
    const dialog = page.getByRole("dialog", { name: "Table viewer", exact: true });
    const frame = dialog.frameLocator("iframe");
    await expect(frame.getByRole("table")).toBeVisible();
    const iframeUrl = await dialog.locator("iframe").getAttribute("src");
    await expect(frame.getByText("Chapter link", { exact: true })).not.toHaveAttribute("href");
    await frame.getByText("Chapter link", { exact: true }).click();
    await expect(dialog.locator("iframe")).toHaveAttribute("src", iframeUrl!);
    await expect(frame.getByRole("textbox", { name: "Value" })).toBeDisabled();
    await expect(frame.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
    await frame.getByText("More observations", { exact: true }).click();
    await expect(frame.getByText("Disclosed observation", { exact: true })).toBeVisible();
    await frame.locator("#selection").dblclick();
    await expect
      .poll(() =>
        frame
          .locator("#selection")
          .evaluate((node) => node.ownerDocument.getSelection()?.toString().length ?? 0),
      )
      .toBeGreaterThan(0);
    await dialog.getByRole("button", { name: "Close", exact: true }).focus();
    await page.keyboard.press("Shift+Tab");
    const code = frame.locator("pre");
    await expect(code).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => code.evaluate(node => node.scrollLeft)).toBeGreaterThan(0);
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  } finally {
    await context.close();
  }
});
