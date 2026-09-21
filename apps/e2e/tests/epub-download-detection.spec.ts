import { expect, test } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { launchReader } from "../harness.js";

/**
 * The "EPUB mimetype handling" first version (`epubDownloadDetection.ts`):
 * downloading any `.epub` file, from any site, should surface a Chrome
 * notification offering to add it to the library — the browser otherwise
 * just leaves it sitting in the Downloads folder as an unrecognized
 * binary with no acknowledgment the reader exists at all.
 */
test("downloading a .epub file surfaces an add-to-library notification", async () => {
  const { context } = await launchReader(path.resolve(__dirname, "../real-books/alice-in-wonderland.epub"));

  // A `data:` URL with a `download` attribute is enough to make Chrome
  // treat this exactly like downloading a real `.epub` from any ordinary
  // website — no local file server needed to exercise the real
  // `chrome.downloads` event this feature actually listens for.
  const page = await context.newPage();
  await page.setContent(
    `<a id="dl" download="my-test-book.epub" href="data:application/epub+zip;base64,UEsDBA==">download</a>`,
  );
  const downloadPromise = page.waitForEvent("download");
  await page.click("#dl");
  await downloadPromise;
  await page.waitForTimeout(1500);

  const [serviceWorker] = context.serviceWorkers();
  const notifications = await serviceWorker!.evaluate(
    () => new Promise<Record<string, boolean>>((resolve) => chrome.notifications.getAll((n) => resolve(n))),
  );
  const ids = Object.keys(notifications);
  expect(ids.some((id) => id.startsWith("ambra-epub-download-"))).toBe(true);

  await context.close();
});
