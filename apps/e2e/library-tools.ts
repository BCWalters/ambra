import { expect, type Page } from "@playwright/test";

export async function expandLibraryTools(page: Page): Promise<void> {
  await expect(page.locator("[data-library-filters]")).toBeAttached();
  const toggle = page.locator("[data-library-tools-toggle]");
  if (await toggle.count() && await toggle.getAttribute("aria-expanded") === "false") {
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
  }
}
