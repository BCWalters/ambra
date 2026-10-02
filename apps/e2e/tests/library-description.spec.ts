import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";

const initialBook = fileURLToPath(new URL("../fixtures/reading-entry.epub", import.meta.url));
const unreadBook = fileURLToPath(new URL("../fixtures/long-content.epub", import.meta.url));
const title = "Ambra Long Content Test Fixture";
const description = "An original fallback description returned by the test metadata service.";

for (const width of [360, 1200]) {
  test(`${width}px: Library details enrich an unread book once, update other tabs, and retain attribution`, async () => {
    const requests: string[] = [];
    let release!: () => void;
    const responseReady = new Promise<void>(resolve => { release = resolve; });
    const { context, libraryPage: page } = await launchReader(initialBook, {
      viewport: { width, height: 800 },
      beforeBookImport: async library => {
        await library.context().route("https://openlibrary.org/**", async route => {
          const url = new URL(route.request().url());
          requests.push(url.href);
          if (url.pathname === "/search.json") {
            expect(url.searchParams.get("title")).toBe(title);
            await route.fulfill({ json: { docs: [{ key: "/works/OL_TEST" }] } });
          } else {
            expect(url.pathname).toBe("/works/OL_TEST.json");
            await responseReady;
            await route.fulfill({ json: { description } });
          }
        });
        await library.context().route("https://en.wikipedia.org/**", route => route.fulfill({ json: {} }));
      },
    });
    try {
      if (width > 600) await page.goto(`${page.url()}?view=tab`);
      await page.locator('input[type="file"]').setInputFiles(unreadBook);
      const detailsButton = page.getByRole("button", { name: `${title} details`, exact: true });
      await expect(detailsButton).toBeVisible();
      expect(requests).toHaveLength(0);
      const mirror = await context.newPage();
      await mirror.goto(page.url());
      await expect(mirror.getByRole("button", { name: `${title} details`, exact: true })).toBeVisible();
      await detailsButton.click();
      const details = page.getByRole("dialog", { name: "Book details", exact: true });
      await expect(details).toBeVisible();
      await expect.poll(() => requests.length).toBe(2);
      await mirror.getByRole("button", { name: `${title} details`, exact: true }).click();
      await expect(mirror.getByRole("dialog", { name: "Book details", exact: true })).toBeVisible();
      release();
      await expect(details.getByText(description, { exact: true })).toBeVisible();
      await expect(mirror.getByText(description, { exact: true })).toBeVisible();
      await expect(details.getByRole("link", { name: "Open Library", exact: true }))
        .toHaveAttribute("href", "https://openlibrary.org/works/OL_TEST");
      expect(requests).toHaveLength(2);
      await page.reload();
      await page.getByRole("button", { name: `${title} details`, exact: true }).click();
      await expect(page.getByText(description, { exact: true })).toBeVisible();
      expect(requests).toHaveLength(2);
      await page.getByRole("button", { name: "Close", exact: true }).click();
      await expect(page.locator("[data-library-collection] article")
        .filter({ has: detailsButton }).getByText("Not started", { exact: true })).toBeVisible();
    } finally {
      release();
      await context.close();
    }
  });
}
