import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { launchReader } from "../harness.js";

const publisherOrigin = "https://publisher-metadata.invalid";
const title = `Original metadata field guide ${"UnbrokenTitle".repeat(95)}`;
const creator = `Original metadata author ${"UnbrokenCreator".repeat(90)}`;
const publisher = `Original metadata publisher ${"UnbrokenPublisher".repeat(85)}`;
const identifier = `urn:ambra:metadata-display:${"UnbrokenIdentifier".repeat(80)}`;
const chapter = `Original chapter label ${"UnbrokenChapter".repeat(90)}`;
const firstParagraph = `First paragraph: &ldquo;Original observations&rdquo; &amp; careful notes. ${"A reader studies a quiet fictional garden. ".repeat(9)}`;
const secondParagraph = `Second paragraph: details remain readable. ${"The invented guide describes paths and small stone bridges. ".repeat(11)}`;
const thirdParagraph = `Third paragraph: original archive-only material. ${"This extra account belongs in the complete publisher metadata. ".repeat(25)}`;
const description = `<p>${firstParagraph}<a href="${publisherOrigin}/page">Publisher reference.</a><img src="${publisherOrigin}/image.png" /></p><p>${secondParagraph}</p><p>${thirdParagraph}</p><iframe src="${publisherOrigin}/frame">Ignored embedded content</iframe><script>Ignored executable content</script>`;
const rights = `<p>&copy; 2026 Original Authors &amp; Test Readers. ${"Permission for this original fixture is granted for automated reading tests. ".repeat(20)}</p>`;
const accessibilitySummary = "Original accessibility summary: logical reading order and alternative text.";
const accessibilityFeatures = "alternativeText, readingOrder";
const xml = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;");

function metadataFixture(info: TestInfo, ordinaryIdentity = false) {
  const source = info.outputPath("metadata-source");
  fs.mkdirSync(path.join(source, "META-INF"), { recursive: true });
  fs.mkdirSync(path.join(source, "EPUB"));
  fs.writeFileSync(path.join(source, "mimetype"), "application/epub+zip");
  fs.writeFileSync(path.join(source, "META-INF/container.xml"),
    `<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  fs.writeFileSync(path.join(source, "EPUB/package.opf"),
    `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">${xml(identifier)}</dc:identifier><dc:title>${xml(ordinaryIdentity ? "A Quiet Fictional Garden" : title)}</dc:title><dc:creator>${xml(ordinaryIdentity ? "Original Test Author" : creator)}</dc:creator><dc:publisher>${xml(ordinaryIdentity ? "Original Test Press" : publisher)}</dc:publisher><dc:description>${xml(description)}</dc:description><dc:rights>${xml(rights)}</dc:rights><dc:language>en</dc:language><meta property="schema:accessibilitySummary">${xml(accessibilitySummary)}</meta><meta property="schema:accessibilityFeature">alternativeText</meta><meta property="schema:accessibilityFeature">readingOrder</meta><meta property="dcterms:modified">2026-09-24T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>`);
  fs.writeFileSync(path.join(source, "EPUB/nav.xhtml"),
    `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol><li><a href="chapter.xhtml">${xml(chapter)}</a></li></ol></nav></body></html>`);
  fs.writeFileSync(path.join(source, "EPUB/chapter.xhtml"),
    `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${xml(chapter)}</title></head><body><h1>A quiet fictional garden</h1><p>This original paragraph gives the reader a real passage to display while its publication metadata is inspected.</p></body></html>`);
  const target = info.outputPath("metadata-display.epub");
  execFileSync("zip", ["-q", "-X", "-0", target, "mimetype"], { cwd: source });
  execFileSync("zip", ["-q", "-X", "-r", target, "META-INF", "EPUB"], { cwd: source });
  return target;
}

async function noHorizontalOverflow(page: Page, container: Locator) {
  const bounds = await container.evaluate(element => ({
    scroll: element.scrollWidth, width: element.clientWidth,
    left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right,
  }));
  expect(bounds.scroll).toBeLessThanOrEqual(bounds.width + 1);
  expect(bounds.left).toBeGreaterThanOrEqual(-1);
  expect(bounds.right).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(page.viewportSize()!.width + 1);
}

async function checkDisclosure(
  page: Page, panel: Locator, name: string, limits: { preview: number; expanded: number },
) {
  const more = panel.getByRole("button", { name: `Show more: ${name}`, exact: true });
  await expect(more).toHaveAttribute("aria-expanded", "false");
  const id = await more.getAttribute("aria-controls");
  expect(id).toBeTruthy();
  const value = panel.locator(`[id=${JSON.stringify(id)}]`);
  await expect(value).toHaveCount(1);
  const preview = (await value.textContent())!;
  expect(preview.length).toBeGreaterThan(0);
  expect(preview.length).toBeLessThanOrEqual(limits.preview);
  expect(preview).toMatch(/…$/);
  expect(preview.split(/\n\s*\n/).length).toBeLessThanOrEqual(2);
  await more.focus();
  await more.press("Enter");
  const less = panel.getByRole("button", { name: `Show less: ${name}`, exact: true });
  await expect(less).toBeFocused();
  await expect(less).toHaveAttribute("aria-expanded", "true");
  await expect(less).toHaveAttribute("aria-controls", id!);
  const expanded = (await value.textContent())!;
  expect(expanded.length).toBeGreaterThan(preview.length);
  expect(expanded.length).toBeLessThanOrEqual(limits.expanded);
  expect(expanded.split(/\n\s*\n/).length).toBeLessThanOrEqual(2);
  expect(expanded).toMatch(/…$/);
  await expect(value.locator("*")).toHaveCount(0);
  if (name === "Description") {
    expect(preview).toContain("“Original observations” & careful notes.");
    expect(expanded).toContain("Second paragraph:");
    expect(expanded).not.toContain("Third paragraph:");
    expect(expanded).not.toMatch(/<\/?p>|&(?:amp|ldquo|rdquo);|Ignored (?:embedded|executable) content/);
    await page.screenshot({
      path: test.info().outputPath(`${page.url().includes("/library/") ? "library" : "reader"}-description-expanded.png`),
    });
  }
  if (name === "Rights") {
    expect(preview).toContain("© 2026 Original Authors & Test Readers.");
    expect(expanded).not.toMatch(/<\/?p>|&(?:amp|copy);/);
    await expect(value).toHaveCSS("font-size", "12px");
  }
  await noHorizontalOverflow(page, panel);
  await less.press("Space");
  await expect(more).toBeFocused();
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await expect(value).toHaveText(preview);
  if (name === "Description") {
    await page.screenshot({
      path: test.info().outputPath(`${page.url().includes("/library/") ? "library" : "reader"}-description-collapsed.png`),
    });
  }
  return { preview, expanded };
}

async function checkDefaultDetails(page: Page, panel: Locator) {
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("heading", { name: "Description", exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Publication details", exact: true })).toHaveAttribute("aria-expanded", "false");
  await expect(panel.getByRole("button", { name: "Show more: Rights", exact: true })).toBeHidden();
  await expect(panel.getByText(accessibilitySummary, { exact: true })).toBeHidden();
  await expect(panel.getByText(accessibilityFeatures, { exact: true })).toBeHidden();
  await noHorizontalOverflow(page, panel);
  await page.screenshot({
    path: test.info().outputPath(`${page.url().includes("/library/") ? "library" : "reader"}-default-details.png`),
  });
}

async function checkDetails(page: Page, panel: Locator) {
  await checkDefaultDetails(page, panel);
  const displayed = {
    description: await checkDisclosure(page, panel, "Description", { preview: 700, expanded: 1400 }),
    title: await checkDisclosure(page, panel, "Title", { preview: 100, expanded: 480 }),
    creator: await checkDisclosure(page, panel, "Creator", { preview: 100, expanded: 480 }),
    publisher: await checkDisclosure(page, panel, "Publisher", { preview: 160, expanded: 600 }),
  };
  const publication = panel.getByRole("button", { name: "Publication details", exact: true });
  await publication.click();
  await expect(publication).toHaveAttribute("aria-expanded", "true");
  const publicationBody = panel.locator(".fui-AccordionPanel");
  await expect(publicationBody).toHaveCount(1);
  await expect(publicationBody.getByText("Rights", { exact: true })).toBeVisible();
  for (const value of [accessibilitySummary, accessibilityFeatures]) {
    const text = publicationBody.getByText(value, { exact: true });
    await expect(text).toBeVisible();
    await expect(text).toHaveCSS("font-size", "12px");
  }
  const displayedRights = await checkDisclosure(page, publicationBody, "Rights", { preview: 140, expanded: 600 });
  const displayedIdentifier = await checkDisclosure(page, panel, "Identifier", { preview: 160, expanded: 600 });
  await noHorizontalOverflow(page, panel);
  await publication.click();
  await expect(publicationBody.getByText(accessibilitySummary, { exact: true })).toBeHidden();
  await expect(panel.getByRole("button", { name: "Show more: Rights", exact: true })).toBeHidden();
  return { ...displayed, rights: displayedRights, identifier: displayedIdentifier };
}

test("ordinary title: default Book Details foregrounds Description and hides publication facts (#178)", async ({ browserName: _browserName }, info) => {
  const { context, readerPage, libraryPage } = await launchReader(metadataFixture(info, true), {
    viewport: { width: 900, height: 900 },
  });
  const requests: string[] = [];
  try {
    await context.route(`${publisherOrigin}/**`, async route => {
      requests.push(route.request().url());
      await route.abort();
    });
    await readerPage.emulateMedia({ reducedMotion: "reduce" });
    await libraryPage.emulateMedia({ reducedMotion: "reduce" });
    const readerDetails = readerPage.getByRole("button", { name: "Book details", exact: true });
    await readerDetails.focus();
    await readerDetails.press("Enter");
    await checkDefaultDetails(readerPage, readerPage.getByRole("complementary", { name: "Book details", exact: true }));
    const libraryDetails = libraryPage.getByRole("button", { name: "A Quiet Fictional Garden details", exact: true });
    await libraryDetails.focus();
    await libraryDetails.press("Enter");
    await checkDefaultDetails(libraryPage, libraryPage.getByRole("dialog", { name: "Book details", exact: true }));
    expect(requests).toEqual([]);
  } finally {
    await context.close();
  }
});

for (const width of [320, 1400]) {
  const libraryWidth = Math.max(width, 360);
  test(`${width}px reader / ${libraryWidth}px Library: bound plain-text metadata without changing the archive (#171/#172)`, async ({ browserName: _browserName }, info) => {
    test.setTimeout(120_000);
    expect(description.length).toBeGreaterThan(2000);
    expect(rights.length).toBeGreaterThan(1000);
    const { context, readerPage, libraryPage } = await launchReader(metadataFixture(info), {
      viewport: { width, height: 900 },
    });
    const publisherRequests: string[] = [];
    try {
      await context.route(`${publisherOrigin}/**`, async route => {
        publisherRequests.push(route.request().url());
        await route.abort();
      });
      await readerPage.emulateMedia({ reducedMotion: "reduce" });
      await libraryPage.emulateMedia({ reducedMotion: "reduce" });
      // The Library document's existing minimum shell width is 360px.
      await libraryPage.setViewportSize({ width: libraryWidth, height: 900 });
      await noHorizontalOverflow(libraryPage, libraryPage.getByRole("main"));
      const cover = libraryPage.getByRole("button", { name: /^Open Original metadata field guide/ });
      const card = cover.locator("..").locator("..");
      await expect(cover).toBeVisible();
      await noHorizontalOverflow(libraryPage, card);

      const readerDetails = readerPage.getByRole("button", { name: "Book details", exact: true });
      await readerDetails.focus();
      await readerDetails.press("Enter");
      const readerPanel = readerPage.getByRole("complementary", { name: "Book details", exact: true });
      const inReader = await checkDetails(readerPage, readerPanel);

      const libraryDetails = libraryPage.getByRole("button", { name: `${title} details`, exact: true });
      await libraryDetails.focus();
      await libraryDetails.press("Enter");
      const libraryPanel = libraryPage.getByRole("dialog", { name: "Book details", exact: true });
      expect(await checkDetails(libraryPage, libraryPanel)).toEqual(inReader);

      await readerPanel.getByRole("button", { name: "EPUB Inspector", exact: true }).click();
      const inspector = readerPage.getByRole("dialog", { name: "EPUB Inspector", exact: true });
      await inspector.getByRole("tab", { name: "Metadata", exact: true }).click();
      for (const original of [title, creator, publisher, identifier, description, rights]) {
        await expect(inspector.getByText(original, { exact: true }).first()).toHaveText(original);
      }
      await inspector.getByRole("tab", { name: /^Files/ }).click();
      await inspector.locator('button[data-file-path="EPUB/package.opf"]').click();
      await expect(inspector.locator("pre")).toContainText(xml(description));
      await expect(inspector.locator("pre")).toContainText(xml(rights));
      expect(publisherRequests).toEqual([]);
      await info.attach("metadata-display", {
        body: JSON.stringify({ width, libraryWidth, displayed: inReader, publisherRequests }, null, 2),
        contentType: "application/json",
      });
    } finally {
      await context.close();
    }
  });
}
