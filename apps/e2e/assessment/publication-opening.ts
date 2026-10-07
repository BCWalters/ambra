import { expect, type Page } from "@playwright/test";
import type { LaunchedReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";
import { assessmentPublication } from "./native-assessment.js";

type Opening =
  | { readonly status: "opened"; readonly page: Page }
  | { readonly status: "rejected"; readonly stage: "import" | "reader"; readonly message: string };

export async function openAssessmentPublication(
  launched: LaunchedReader,
  id: string,
): Promise<Opening> {
  const { libraryPage, context, extensionId } = launched;
  await libraryPage.bringToFront();
  const status = libraryPage.getByTestId("library-import-status");
  const dismiss = status.getByRole("button", { name: "Dismiss", exact: true });
  if (await dismiss.count()) await dismiss.click();
  const input = libraryPage.locator('input[type="file"]');
  await expect(input).toBeEnabled();
  await input.setInputFiles(assessmentPublication(id));
  const error = libraryPage.getByRole("alert");
  const open = status.getByRole("button", { name: /^Open /i }).first();
  await expect
    .poll(async () => (await error.count()) > 0 || (await open.count()) > 0, { timeout: 20_000 })
    .toBe(true);
  if (await error.count())
    return { status: "rejected", stage: "import", message: await error.innerText() };
  await expect(open).toBeEnabled();
  const [page] = await Promise.all([
    context.waitForEvent("page", { timeout: 15_000 }),
    open.click(),
  ]);
  await page.waitForURL(`chrome-extension://${extensionId}/src/reader/index.html*`);
  await page.waitForLoadState("domcontentloaded");
  const readerError = page.getByRole("alert");
  const frame = page.getByRole("main").locator("iframe").first();
  await expect
    .poll(async () => (await readerError.count()) > 0 || (await frame.isVisible()), {
      timeout: 20_000,
    })
    .toBe(true);
  if (await readerError.count())
    return { status: "rejected", stage: "reader", message: await readerError.innerText() };
  await expect(page.getByRole("progressbar")).toHaveCount(0, { timeout: 20_000 });
  await exposeReaderController(page);
  return { status: "opened", page };
}
