import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { launchReader } from "../harness.js";
import { navigationFixture } from "../navigation-fixture.js";

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="green"/><script>parent.__embeddedImageScript=true;</script><image href="https://embedded-data.invalid/private" width="1" height="1"/></svg>';
const dataSvg = `data:image/svg+xml,${encodeURIComponent(svg)}`;
const dataPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1kAAAAASUVORK5CYII=";

function fixture(info: TestInfo, invalidCover = false): string {
  const book = navigationFixture(info, [1], () => `<p id="host">3.1.3 Embedded image resources</p>
    <img id="svg" src="${dataSvg}" width="20" height="20"/><img id="png" src="${dataPng}" width="20" height="20"/>
    <img id="responsive" srcset="${dataSvg} 1x, ${dataSvg} 2x" width="20" height="20"/>
    <object id="object" data="${dataSvg}" type="image/svg+xml" width="20" height="20">Alternative</object>
    <embed id="embed" src="${dataSvg}" type="image/svg+xml" width="20" height="20"/>
    <video id="poster" poster="${dataSvg}" width="20" height="20"/>
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><image id="svg-image" href="${dataSvg}" width="20" height="20"/></svg>
    <div id="css" style="width:20px;height:20px;background-image:url('${dataSvg}')"/>
    <img id="invalid" src="data:image/png;base64,!"/><img id="missing" src="absent.png"/>
    <iframe id="blocked-data-frame" src="${dataSvg}"/><iframe title="Packaged child" src="child.xhtml"/>
    <a id="blocked-data-link" href="${dataSvg}">Data navigation remains blocked</a>
    <link id="blocked-data-style" rel="stylesheet" href="data:text/css,p%7Bcolor:red%7D"/>`);
  const source = info.outputPath("navigation-source");
  fs.writeFileSync(path.join(source, "EPUB/child.xhtml"),
    `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Child</title></head><body><img id="child-image" src="${dataSvg}" width="20" height="20"/></body></html>`);
  const opf = path.join(source, "EPUB/package.opf");
  fs.writeFileSync(opf, fs.readFileSync(opf, "utf8")
    .replace("</manifest>", `<item id="child" href="child.xhtml" media-type="application/xhtml+xml"/>
      <item id="cover" href="${invalidCover ? "data:text/html,blocked" : dataPng}" media-type="image/png" properties="cover-image"/></manifest>`)
    .replace("Navigation boundaries", "3.1.3 Embedded data images"));
  execFileSync("zip", ["-q", "-X", "-r", book, "EPUB"], { cwd: source });
  const identified = info.outputPath("3.1.3-embedded-data-images.epub");
  fs.renameSync(book, identified);
  return identified;
}

async function readingFrame(page: Page) {
  const url: string = await page.evaluate(() =>
    Reflect.get(window, "__readerController").contentDocumentViews()[0].document.URL);
  const frame = page.frames().find(frame => frame.url() === url);
  if (!frame) throw new Error("The committed reading frame was not found.");
  return frame;
}

test("bounded embedded images work in markup, CSS, srcset, SVG and opaque children without scripts or remote fetching (#336)", async () => {
  const requests: string[] = [];
  const { readerPage: page, libraryPage: library, context } = await launchReader(fixture(test.info()), {
    beforeBookImport: async library => {
      library.context().on("request", request => {
        if (request.url().includes("embedded-data.invalid")) requests.push(request.url());
      });
    },
  });
  try {
    const frame = await readingFrame(page);
    await expect.poll(() => library.locator("[data-library-collection] img").first().evaluate(element =>
      element instanceof HTMLImageElement ? element.naturalWidth : 0)).toBeGreaterThan(0);
    await expect(frame.locator("#host")).toBeVisible();
    for (const id of ["svg", "png", "responsive", "object", "embed"]) {
      await expect(frame.locator(`#${id}`)).toBeVisible();
      await expect.poll(() => frame.locator(`#${id}`).evaluate(element =>
        element instanceof HTMLImageElement ? element.naturalWidth : 0)).toBeGreaterThan(0);
    }
    await expect(frame.locator("#poster")).toHaveAttribute("poster", /^blob:/);
    await expect(frame.locator("#svg-image")).toHaveAttribute("href", /^blob:/);
    await expect(frame.locator("#css")).toHaveCSS("background-image", /^url\("blob:/);
    for (const id of ["invalid", "missing", "blocked-data-frame"]) {
      await expect(frame.locator(`#${id}`)).not.toHaveAttribute("src");
    }
    await expect(frame.locator("#blocked-data-style")).not.toHaveAttribute("href");
    await expect(frame.locator("#blocked-data-link")).toHaveAttribute("href", "#");
    await expect.poll(() => frame.childFrames().filter(child => child.url().startsWith("blob:")).length).toBe(1);
    const child = frame.childFrames().find(child => child.url().startsWith("blob:"))!;
    await expect.poll(() => child.locator("#child-image").evaluate(element =>
      element instanceof HTMLImageElement ? element.naturalWidth : 0)).toBe(20);
    await expect(child.locator("#child-image")).toHaveAttribute("src", /^data:image\/svg\+xml;base64,/);
    expect(await frame.evaluate(() => Reflect.has(window, "__embeddedImageScript"))).toBe(false);
    expect(await page.evaluate(() => Reflect.has(window, "__embeddedImageScript"))).toBe(false);
    expect(requests).toEqual([]);
    await expect(page.getByRole("alert")).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("an unavailable optional data cover does not block importing or reading the publication (#336)", async () => {
  const { readerPage: page, libraryPage: library, context } = await launchReader(fixture(test.info(), true));
  try {
    const frame = await readingFrame(page);
    await expect(frame.locator("#host")).toBeVisible();
    await expect(library.locator("[data-library-collection] [data-generated-cover]")).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
  } finally {
    await context.close();
  }
});

for (const name of ["pub-data-urls_browsing-context", "pub-data-urls_top-level-content", "pub-file-urls"]) {
  test(`original W3C ${name}: embedded images render and local file frames remain blocked (#336)`, async () => {
    const directory = process.env.AMBRA_DATA_URL_EPUB_DIR;
    test.skip(!directory, "Set AMBRA_DATA_URL_EPUB_DIR to the pinned URLs/origins folder.");
    const requests: string[] = [];
    const { readerPage: page, context } = await launchReader(path.join(directory!, `${name}.epub`), {
      beforeBookImport: async library => {
        library.context().on("request", request => {
          if (request.url().startsWith("file:")) requests.push(request.url());
        });
      },
    });
    try {
      const frame = await readingFrame(page);
      await expect(frame.locator("body")).toBeVisible();
      if (name === "pub-file-urls") {
        await expect(frame.locator("iframe")).toHaveCount(3);
        for (const iframe of await frame.locator("iframe").all()) {
          await expect(iframe).not.toHaveAttribute("src");
          await expect(iframe).toHaveAttribute("sandbox", "");
        }
      } else {
        const image = frame.locator("img").first();
        await expect(image).toBeVisible();
        await expect(image).toHaveAttribute("src", /^blob:/);
        await expect.poll(() => image.evaluate(element =>
          element instanceof HTMLImageElement ? element.naturalWidth : 0)).toBeGreaterThan(0);
      }
      expect(requests).toEqual([]);
      await expect(page.getByRole("alert")).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
}
