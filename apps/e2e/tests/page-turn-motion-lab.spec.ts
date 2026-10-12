import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const root = new URL("../../../scripts/page-turn-lab/", import.meta.url);
const files = new Map([
  ["/", ["index.html", "text/html"]],
  ["/lab.css", ["lab.css", "text/css"]],
  ["/lab.mjs", ["lab.mjs", "text/javascript"]],
  ["/renderers.mjs", ["renderers.mjs", "text/javascript"]],
  ["/motion.mjs", ["motion.mjs", "text/javascript"]],
]);
const server = createServer((request, response) => {
  const resource = files.get(request.url ?? "/");
  if (!resource) {
    response.writeHead(404).end();
    return;
  }
  void readFile(new URL(resource[0]!, root)).then(bytes => {
    response.writeHead(200, { "Content-Type": resource[1]! }).end(bytes);
  }, error => {
    console.error("Motion lab resource load failed", error);
    response.writeHead(500).end();
  });
});
let url: string;
test.beforeAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing lab server port");
  url = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

for (const direction of ["ltr", "rtl"]) {
  for (const content of ["text", "art"]) {
    test(`${direction} ${content}: two-sided curl has destination content and commits only after completion`, async ({ page }) => {
      await page.goto(url);
      await page.locator("#direction").selectOption(direction);
      await page.locator("#content").selectOption(content);
      await page.locator("#progress").fill("0.75");
      await expect(page.locator(".strip")).toHaveCount(32);
      await expect(page.locator("#book")).toHaveAttribute("data-spread", "0");
      const faces = await page.locator(".back [data-page]").evaluateAll(elements =>
        [...new Set(elements.map(element => (element as HTMLElement).dataset.page))]);
      expect(faces).toEqual(["3"]);
      expect(await page.locator(".back").first().evaluate(element => getComputedStyle(element).color)).toBe("rgb(49, 55, 45)");
      const transforms = await page.locator(".strip").evaluateAll(elements =>
        elements.map(element => (element as HTMLElement).style.transform));
      expect(new Set(transforms).size).toBe(32);
      await page.locator("#progress").fill("1");
      await test.info().attach("landed-reverse-page", { body: await page.locator("#book").screenshot(), contentType: "image/png" });
      await page.locator("#commit").click();
      await expect(page.locator("#book")).toHaveAttribute("data-spread", "1");
      await expect(page.locator(".strip")).toHaveCount(0);
      await page.locator("#previous").click();
      await expect(page.locator("#book")).toHaveAttribute("data-spread", "0");
    });
  }
}

test("mouse drag follows travel, returns below 40%, commits above it and cancels on reversal", async ({ page }) => {
  await page.goto(url);
  const bounds = await page.locator("#book").boundingBox();
  if (!bounds) throw new Error("Book preview is missing");
  const x = bounds.x + bounds.width * 0.95;
  const y = bounds.y + bounds.height * 0.5;
  for (const [distance, reversed, expected] of [[0.2, false, "0"], [0.65, true, "0"], [0.65, false, "1"]] as const) {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - bounds.width * distance, y, { steps: 10 });
    await expect(page.locator("#book")).toHaveAttribute("data-state", "turning");
    expect(Number(await page.locator("#book").getAttribute("data-progress"))).toBeCloseTo(distance, 1);
    if (reversed) await page.mouse.move(x - bounds.width * 0.35, y);
    else await page.waitForTimeout(150);
    await page.mouse.up();
    await expect(page.locator("#book")).toHaveAttribute("data-state", "idle");
    await expect(page.locator("#book")).toHaveAttribute("data-spread", expected);
  }
});

for (const style of ["slide", "film", "rigid"]) {
  test(`${style}: cancel, resize and reduced-motion commit clean up their own rendering`, async ({ page }) => {
    await page.goto(url);
    await page.locator("#style").selectOption(style);
    await page.locator("#progress").fill("0.6");
    await page.setViewportSize({ width: 500, height: 800 });
    await page.locator("#cancel").click();
    await expect(page.locator("#book")).toHaveAttribute("data-spread", "0");
    await expect(page.locator("#moving")).toBeEmpty();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.locator("#next").click();
    await expect(page.locator("#book")).toHaveAttribute("data-spread", "1");
    await expect(page.locator("#moving")).toBeEmpty();
  });
}

for (const direction of ["ltr", "rtl"]) {
  test(`${direction}: a backward release flick above 40% still completes the turn`, async ({ page }) => {
    await page.goto(url);
    await page.locator("#direction").selectOption(direction);
    const bounds = await page.locator("#book").boundingBox();
    if (!bounds) throw new Error("Book preview is missing");
    const side = direction === "ltr" ? 1 : -1;
    const x = bounds.x + bounds.width * (side === 1 ? 0.95 : 0.05);
    const y = bounds.y + bounds.height * 0.5;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - side * bounds.width * 0.75, y, { steps: 10 });
    await page.mouse.move(x - side * bounds.width * 0.45, y);
    expect(Number(await page.locator("#book").getAttribute("data-progress"))).toBeCloseTo(0.45, 1);
    await page.mouse.up();
    await expect(page.locator("#book")).toHaveAttribute("data-state", "idle");
    await expect(page.locator("#book")).toHaveAttribute("data-spread", "1");
  });
}

test("Escape and changing styles during a turn do not commit or leave stale layers", async ({ page }) => {
  await page.goto(url);
  const bounds = await page.locator("#book").boundingBox();
  if (!bounds) throw new Error("Book preview is missing");
  await page.mouse.move(bounds.x + bounds.width * 0.9, bounds.y + bounds.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.2, bounds.y + bounds.height * 0.5);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(page.locator("#book")).toHaveAttribute("data-state", "idle");
  await expect(page.locator("#book")).toHaveAttribute("data-spread", "0");
  await page.locator("#next").click();
  await page.locator("#style").selectOption("slide");
  await expect(page.locator("#book")).toHaveAttribute("data-state", "idle");
  await expect(page.locator("#book")).toHaveAttribute("data-spread", "0");
  await expect(page.locator("#moving")).toBeEmpty();
  await page.locator("#next").click();
  await expect(page.locator("#book")).toHaveAttribute("data-spread", "1");
});

test("Slide and Film strip gutters travel with their own spreads", async ({ page }) => {
  await page.goto(url);
  const initial = await page.locator(".spine").boundingBox();
  const book = await page.locator("#book").boundingBox();
  if (!initial || !book) throw new Error("Preview geometry is missing");
  await page.locator("#style").selectOption("slide");
  await page.locator("#progress").fill("0.35");
  const moving = await page.locator("#moving .spine").boundingBox();
  if (!moving) throw new Error("Slide has no outgoing gutter");
  expect(moving.x).toBeCloseTo(initial.x - book.width * 0.35, 0);
  await page.locator("#style").selectOption("film");
  await page.locator("#progress").fill("0.35");
  const outgoing = await page.locator("#moving .spine").boundingBox();
  const incoming = await page.locator("#base .spine").boundingBox();
  if (!outgoing || !incoming) throw new Error("Film strip is missing a spread gutter");
  expect(outgoing.x).toBeCloseTo(initial.x - book.width * 0.35, 0);
  expect(incoming.x).toBeCloseTo(initial.x + book.width * 0.65, 0);
});

test("Film strip preserves page widths and clips paint to a constant book window", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 1000 });
  await page.goto(url);
  await page.locator("#style").selectOption("film");
  const book = await page.locator("#book").boundingBox();
  if (!book) throw new Error("Book preview geometry is missing");
  for (const progress of ["0.1", "0.35", "0.5", "0.75", "1"]) {
    await page.locator("#progress").fill(progress);
    const state = await page.evaluate(() => {
      const book = document.getElementById("book")!;
      const bounds = book.getBoundingClientRect();
      const y = bounds.y + bounds.height / 2;
      return {
        widths: [...book.querySelectorAll(".page")].map(page => page.getBoundingClientRect().width),
        overflow: getComputedStyle(book).overflow,
        outsidePaint: [bounds.left - 5, bounds.right + 5].some(x => book.contains(document.elementFromPoint(x, y))),
      };
    });
    expect(state.overflow).toBe("hidden");
    expect(state.outsidePaint).toBe(false);
    for (const width of state.widths) expect(width).toBeCloseTo(book.width / 2, 2);
  }
});
