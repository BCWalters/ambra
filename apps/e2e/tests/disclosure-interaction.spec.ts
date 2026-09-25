import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

const book = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/disclosure-pagination/initially-closed.epub",
);

async function totalPages(page: Page): Promise<number> {
  const text = await page
    .getByRole("slider", { name: "Position in book" })
    .getAttribute("aria-valuetext");
  return Number(text?.match(/of (\d+)/)?.[1]);
}

async function states(page: Page): Promise<boolean[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("iframe"))
      .filter(
        (frame) =>
          frame.getBoundingClientRect().width > 0 &&
          getComputedStyle(frame).visibility !== "hidden",
      )
      .flatMap((frame) =>
        Array.from(
          frame.contentDocument?.querySelectorAll("details") ?? [],
          (details) => details.open,
        ),
      ),
  );
}

async function changeMode(page: Page, mode: "Scroll" | "Paginated"): Promise<void> {
  await page.mouse.move(350, 2);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("menuitemradio", { name: mode, exact: true }).click();
  await page.keyboard.press("Escape");
}

async function visibleLines(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("iframe"))
      .filter(
        (frame) =>
          frame.getBoundingClientRect().width > 0 &&
          getComputedStyle(frame).visibility !== "hidden",
      )
      .flatMap((frame) => {
        const doc = frame.contentDocument!;
        const box = frame.getBoundingClientRect();
        return Array.from(doc.querySelectorAll<HTMLElement>("[data-line]"))
          .filter((line) => {
            const rect = line.getBoundingClientRect();
            const x = rect.left + 10;
            const y = rect.top + rect.height / 2;
            return (
              rect.height > 0 &&
              doc.elementFromPoint(x, y)?.closest("[data-line]") === line &&
              document.elementFromPoint(box.left + x, box.top + y) === frame
            );
          })
          .map((line) => line.dataset.line!);
      }),
  );
}

for (const width of [760, 1400]) {
  test(`${width}px disclosure keyboard activation, collapse, and mode changes retain state and focus`, async () => {
    const { context, readerPage: page } = await launchReader(book, {
      viewport: { width, height: 900 },
    });
    try {
      const summary = page.frameLocator("iframe").first().locator("#long-disclosure > summary");
      const columns = width === 760 ? 1 : 2;
      const collapsedTotal = await totalPages(page);
      await summary.focus();
      await page.keyboard.press("Space");
      await expect.poll(() => totalPages(page)).toBeGreaterThan(collapsedTotal);
      await expect.poll(() => states(page)).toEqual(Array(columns).fill(true));
      await expect(summary).toBeFocused();
      const expandedTotal = await totalPages(page);

      await page.keyboard.press("Space");
      await expect.poll(() => states(page)).toEqual(Array(columns).fill(false));
      await expect.poll(() => totalPages(page)).toBe(collapsedTotal);
      await expect(summary).toBeFocused();

      await page.keyboard.press("Enter");
      await expect.poll(() => totalPages(page)).toBe(expandedTotal);
      await expect(summary).toBeFocused();

      await changeMode(page, "Scroll");
      await expect(page.getByRole("slider", { name: "Position in book" })).toHaveCount(0);
      await expect.poll(() => states(page)).toEqual([true]);
      await summary.evaluate((element) =>
        Reflect.set(element.ownerDocument, "__originalDisclosureDocument", true),
      );
      await summary.click();
      await expect.poll(() => states(page)).toEqual([false]);
      expect(
        await summary.evaluate((element) =>
          Reflect.get(element.ownerDocument, "__originalDisclosureDocument"),
        ),
      ).toBe(true);
      await expect(summary).toBeFocused();

      await changeMode(page, "Paginated");
      await expect.poll(() => states(page)).toEqual(Array(columns).fill(false));
      await expect.poll(() => totalPages(page)).toBe(collapsedTotal);
      await summary.focus();
      await page.keyboard.press("Space");
      await expect.poll(() => totalPages(page)).toBe(expandedTotal);
      await expect.poll(() => states(page)).toEqual(Array(columns).fill(true));
      await expect(summary).toBeFocused();
    } finally {
      await context.close();
    }
  });

  test(`${width}px collapsing excludes hidden disclosure lines from page boundaries`, async () => {
    const { context, readerPage: page } = await launchReader(book, {
      viewport: { width, height: 900 },
    });
    try {
      const summary = page.frameLocator("iframe").first().locator("#long-disclosure > summary");
      const collapsedTotal = await totalPages(page);
      await summary.focus();
      await page.keyboard.press("Space");
      await expect.poll(() => totalPages(page)).toBeGreaterThan(collapsedTotal);
      await expect(summary).toBeFocused();
      await page.keyboard.press("Space");
      await expect.poll(() => totalPages(page)).toBe(collapsedTotal);
      await expect(summary).toBeFocused();

      const columns = width === 760 ? 1 : 2;
      const pages: string[][] = [];
      const slider = page.getByRole("slider", { name: "Position in book" });
      await exposeReaderController(page);
      await page.waitForFunction(() => {
        const c = Reflect.get(window, "__readerController");
        return !c.isApplyingLayout && !c.isLoadInFlight && !c.pendingLayout;
      });
      expect(await page.evaluate(() => Reflect.get(window, "__readerController").host.pageCount)).toBe(collapsedTotal);
      await expect(slider).toHaveAttribute("aria-valuetext", /^Page 1 of/);
      // Summary retains activation keys; page commands start from reading content.
      await page.frameLocator("iframe").first().locator("h1").click();
      await expect(summary).not.toBeFocused();
      for (let first = 0; first < collapsedTotal; first += columns) {
        if (first > 0) {
          await page.keyboard.press("ArrowRight");
          await expect(slider).toHaveAttribute(
            "aria-valuetext",
            new RegExp(`^Page ${first + 1} of`),
          );
          await page.waitForFunction(() => !Reflect.get(window, "__readerController").isTurningPage);
        }
        pages.push(await visibleLines(page));
      }
      await test.info().attach("collapsed-visible-lines.json", {
        body: JSON.stringify(pages),
        contentType: "application/json",
      });
      expect(pages.flat()).toEqual(
        Array.from({ length: 40 }, (_, index) => `T${String(index + 1).padStart(3, "0")}`),
      );
      expect(
        pages.every((lines) => lines.length > 0),
        "no blank views from hidden content",
      ).toBe(true);
    } finally {
      await context.close();
    }
  });
}

test("a disclosure toggle during a held spread load shares the latest queued resize", async () => {
  const { context, readerPage: page } = await launchReader(book, {
    // Crossing into spread mode loads new documents; ordinary spread resizes no longer do.
    viewport: { width: 900, height: 900 },
  });
  try {
    const collapsedTotal = await totalPages(page);
    await page.evaluate(() => {
      const prototype = HTMLIFrameElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, "src")!;
      const gate = { held: false, release: () => {} };
      Reflect.set(window, "__disclosureLoadGate", gate);
      Object.defineProperty(prototype, "src", {
        ...descriptor,
        set(this: HTMLIFrameElement, value: string) {
          const siblings = this.parentElement?.querySelectorAll("iframe");
          if (!gate.held && siblings?.length === 2 && siblings[1] === this) {
            gate.held = true;
            Object.defineProperty(prototype, "src", descriptor);
            const block = (event: Event) => event.stopImmediatePropagation();
            this.addEventListener("load", block, true);
            gate.release = () => {
              this.removeEventListener("load", block, true);
              descriptor.set!.call(this, value);
            };
            return;
          }
          descriptor.set!.call(this, value);
        },
      });
    });
    await page.setViewportSize({ width: 1300, height: 900 });
    await page.waitForFunction(() => Reflect.get(window, "__disclosureLoadGate").held);
    await page
      .frameLocator("iframe")
      .first()
      .locator("summary")
      .evaluate((element) => {
        element.focus();
        (element as HTMLElement).click();
      });
    await page.setViewportSize({ width: 1100, height: 900 });
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await page.evaluate(() => Reflect.get(window, "__disclosureLoadGate").release());
    await expect.poll(() => states(page)).toEqual([true, true]);
    await expect.poll(() => totalPages(page)).toBeGreaterThan(collapsedTotal);
    await expect.poll(() => page.locator("iframe").count()).toBe(2);
    expect(
      await page
        .locator("iframe")
        .evaluateAll((frames) =>
          frames.map((frame) => Math.round(frame.getBoundingClientRect().width)),
        ),
    ).toEqual([530, 530]);
    await expect(page.frameLocator("iframe").first().locator("summary")).toBeFocused();
    await page.frameLocator("iframe").first().locator("h1").click();
    await expect(page.frameLocator("iframe").first().locator("summary")).not.toBeFocused();
    const slider = page.getByRole("slider", { name: "Position in book" });
    await page.keyboard.press("ArrowRight");
    await expect(slider).toHaveAttribute("aria-valuetext", /^Page 3 of/);
    await page.keyboard.press("ArrowLeft");
    await expect(slider).toHaveAttribute("aria-valuetext", /^Page 1 of/);
    await expect.poll(() => states(page)).toEqual([true, true]);
    await expect(page.getByRole("alert")).toHaveCount(0);
  } finally {
    await context.close();
  }
});
