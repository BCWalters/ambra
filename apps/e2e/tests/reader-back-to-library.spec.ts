import { expect, test } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const LONG_CONTENT_EPUB = path.resolve(here, "..", "fixtures", "long-content.epub");

test("embedded Library opens a full Library tab only through its explicit secondary action", async () => {
  const { context, readerPage } = await launchReader(LONG_CONTENT_EPUB, { viewport: { width: 900, height: 900 } });
  try {
    const originalUrl = readerPage.url();
    const frame = await readerPage.locator("iframe").first().elementHandle();
    const initialPages = context.pages().length;
    await readerPage.getByRole("button", { name: "Library", exact: true }).click();
    const panel = readerPage.locator("[data-ambra-library-panel]");
    await expect(panel).toBeVisible();
    expect(context.pages()).toHaveLength(initialPages);
    const opened = context.waitForEvent("page");
    await panel.getByRole("button", { name: "Open library in new tab", exact: true }).click();
    const library = await opened;
    await expect(library).toHaveURL(/library\/index\.html\?view=tab/);
    await expect(library.getByRole("button", { name: /^Open Ambra Long Content Test Fixture/ }).first()).toBeVisible();
    expect(context.pages()).toHaveLength(initialPages + 1);
    expect(readerPage.url()).toBe(originalUrl);
    expect(await frame!.evaluate(element => element.isConnected)).toBe(true);
  } finally {
    await context.close();
  }
});
