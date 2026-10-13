import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

const book = fileURLToPath(new URL("../fixtures/two-chapter.epub", import.meta.url));
async function report(page: Page): Promise<string> {
  return page.evaluate(() => Reflect.get(window, "__readerController").getDiagnosticsText());
}
async function reveal(page: Page) {
  await page.mouse.move(10, 2);
  await expect(page.getByRole("button", { name: /^(Bookmark this page|Remove bookmark)$/ })
    .locator("..")).toHaveCSS("pointer-events", "auto");
}

test("error Copy diagnostics binds the visible notification, operation and available exception chain (#421)", async () => {
  const { context, readerPage: page } = await launchReader(book);
  try {
    await page.evaluate(() => {
      Object.defineProperty(navigator.clipboard, "writeText", {
        configurable: true,
        value: async (text: string) => { Reflect.set(window, "__copiedDiagnostics", text); },
      });
      const controller = Reflect.get(window, "__readerController");
      const cause = new Error("Original native cause");
      const error = new Error("Original native exception", { cause });
      controller.reportActionFailure(error);
      Reflect.set(window, "__originalNotification", controller.snapshot().errorDiagnostics);
      error.message = "Mutated exception";
      cause.message = "Mutated cause";
    });
    const alert = page.getByRole("status").filter({ has: page.getByRole("button", { name: "Copy diagnostics", exact: true }) });
    await expect(alert).toBeVisible();
    const visible = await alert.textContent();
    await alert.getByRole("button", { name: "Copy diagnostics", exact: true }).click();
    const copied = await page.evaluate(() => Reflect.get(window, "__copiedDiagnostics") as string);
    const original = await page.evaluate(() => Reflect.get(window, "__originalNotification").message as string);
    expect(visible).toContain(original);
    expect(copied).toContain(`Message: ${JSON.stringify(original)}`);
    expect(copied).toContain('Operation: "update the reader"');
    expect(copied).toContain("Original native exception");
    expect(copied).toContain("Original native cause");
    expect(copied).toContain('Stack: "Error: Original native exception');
    expect(copied).not.toContain("Mutated");
    expect(copied).toContain("review before sharing");
    const retained = await page.evaluate(() => {
      const controller = Reflect.get(window, "__readerController");
      controller.dismissError();
      controller.reportActionFailure(new Error("Replacement native exception"));
      return controller.getDiagnosticsText(Reflect.get(window, "__originalNotification")) as string;
    });
    expect(retained).toContain("Original native exception");
    expect(retained).not.toContain("Replacement native exception");
    expect(await report(page)).not.toContain("Associated notification");
  } finally {
    await context.close();
  }
});

test("error diagnostics explicitly omit unavailable exception and cause information (#421)", async () => {
  const { context, readerPage: page } = await launchReader(book);
  try {
    await page.evaluate(() => {
      Object.defineProperty(navigator.clipboard, "writeText", {
        configurable: true,
        value: async (text: string) => { Reflect.set(window, "__copiedDiagnostics", text); },
      });
      Reflect.get(window, "__readerController").reportActionFailure("Plain native failure");
    });
    await page.getByRole("button", { name: "Copy diagnostics", exact: true }).click();
    const copied = await page.evaluate(() => Reflect.get(window, "__copiedDiagnostics") as string);
    expect(copied).toContain('Exception message: "Plain native failure"');
    expect(copied).toContain("Exception name: unavailable");
    expect(copied).toContain("Stack: unavailable");
    expect(copied).toContain("Cause: unavailable");
  } finally {
    await context.close();
  }
});

test("opening notifications can copy their bound diagnostics before a reader controller exists (#421)", async () => {
  const { context, readerPage: page } = await launchReader(book);
  try {
    await page.goto(page.url().split("?")[0]!);
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("No book selected");
    await page.evaluate(() => {
      Object.defineProperty(navigator.clipboard, "writeText", {
        configurable: true,
        value: async (text: string) => { Reflect.set(window, "__copiedDiagnostics", text); },
      });
    });
    await alert.getByRole("button", { name: "Copy diagnostics", exact: true }).click();
    const copied = await page.evaluate(() => Reflect.get(window, "__copiedDiagnostics") as string);
    expect(copied).toContain("No book selected");
    expect(copied).toContain('Operation: "open reader"');
    expect(copied).toContain("reader: not initialized");
    expect(copied).toContain("Stack: unavailable");
    expect(copied).toContain("Cause: unavailable");
  } finally {
    await context.close();
  }
});

test("diagnostics identify panel/dialog modes and settings, and copy all 500 retained events (#177)", async () => {
  const { context, readerPage: page } = await launchReader(book, {
    viewport: { width: 1400, height: 900 },
  });
  try {
    await exposeReaderController(page);
    await page.waitForFunction(() => {
      const c = Reflect.get(window, "__readerController");
      return c?.host && !c.isLoadInFlight && !c.isTurningPage && !c.isApplyingLayout && !c.pendingLayout;
    });
    for (const [name, surface] of [
      ["Contents", "toc"], ["Annotations", "annotations"],
      ["Search", "search"], ["Book details", "details"],
    ] as const) {
      await reveal(page);
      await page.getByRole("button", { name, exact: true }).click();
      await expect.poll(() => report(page)).toContain(`surface ${surface} opened`);
      await page.keyboard.press("Escape");
      await expect.poll(() => report(page)).toContain(`surface ${surface} closed`);
    }

    const mod = await page.evaluate(() => /Mac|iPhone|iPad|iPod/i.test(navigator.platform) ? "Meta" : "Control");
    for (const [label, mode] of [["Page", "page"], ["Percentage", "percentage"]] as const) {
      await page.evaluate(() => Reflect.get(window, "__readerController").restoreContentFocus());
      await page.keyboard.press(`${mod}+${mode === "percentage" ? "Shift+" : ""}g`);
      await expect(page.getByRole("dialog", { name: `Go to ${label}`, exact: true })).toBeVisible();
      await expect.poll(() => report(page)).toContain(`surface go-to opened mode=${mode}`);
      await page.keyboard.press("Escape");
      await expect.poll(() => report(page)).toContain(`surface go-to closed mode=${mode}`);
    }
    await page.evaluate(async () => {
      await Reflect.get(window, "__readerController").setBrightness(0.8);
    });
    await expect.poll(() => report(page)).toContain('setting requested name="brightness" before=1 after=0.8');

    await reveal(page);
    await page.getByRole("button", { name: "Help & About", exact: true }).click();
    const help = page.getByRole("dialog", { name: "Help & About", exact: true });
    await expect(help).toBeVisible();
    await expect.poll(() => report(page)).toContain("surface help opened");
    // Capture only the explicitly requested clipboard write, not the OS clipboard.
    // Seed more than the cap after UI settling to prove neither export nor Copy
    // has the previous 100-entry limitation.
    const generated = await page.evaluate(() => {
      Object.defineProperty(navigator.clipboard, "writeText", {
        configurable: true,
        value: async (text: string) => { Reflect.set(window, "__copiedDiagnostics", text); },
      });
      const c = Reflect.get(window, "__readerController");
      for (let index = 0; index < 510; index++) {
        c.recordDiagnosticEvent({ kind: "search", queryLength: 10000 + index });
      }
      return c.getDiagnosticsText() as string;
    });
    expect(generated).toContain("retained 500/500");
    expect(generated).not.toContain("queryLength=10009");
    expect(generated).toContain("queryLength=10010");
    expect(generated).toContain("queryLength=10509");
    expect(generated.match(/\] search queryLength=/g)).toHaveLength(500);
    await help.getByRole("button", { name: "Copy diagnostics", exact: true }).click();
    await expect.poll(() => page.evaluate(() => Reflect.get(window, "__copiedDiagnostics"))).toContain("queryLength=10509");
    const copied = await page.evaluate(() => Reflect.get(window, "__copiedDiagnostics") as string);
    expect(copied.match(/\] search queryLength=/g)).toHaveLength(500);
    expect(copied).toContain("queryLength=10010");
    expect(copied).toContain("review before sharing");
    expect(copied.length).toBeLessThan(310000);
  } finally {
    await context.close();
  }
});
