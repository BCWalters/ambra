import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(new URL("../../../apps/e2e/package.json", import.meta.url));
const { chromium } = require("@playwright/test");
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
const errors = [];
page.on("pageerror", error => errors.push(error.message));
let checks = 0;
function check(condition, label) {
  assert.ok(condition, label);
  checks += 1;
}

try {
  await page.goto(new URL("../inspector-explore.html", import.meta.url).href);
  const results = page.locator("[data-result-id]");
  const detailButton = name => page.locator("#detail").getByRole("button", { name, exact: true });
  check(await results.count() === 5, "Browse all five images across four chapters");
  await page.locator('[data-result-id="bridge"]').click();
  check(await page.locator("#detail h3").innerText() === "The blue footbridge", "Selecting a result opens its detail");
  check(await page.locator("#reading-chapter").inputValue() === "0", "Selection does not move the reader");
  await detailButton("Show in book").click();
  check(await page.locator("#reading-chapter").inputValue() === "1", "Explicit navigation moves the reader");
  check(await page.locator(".reading-target").getAttribute("data-reading-id") === "bridge", "Exact element highlighted in the book");
  await detailButton("Source").click();
  check((await page.locator("#detail pre").innerText()).includes('class="wide"'), "Source displays original sample markup");
  check(await detailButton("Source").evaluate(node => node === document.activeElement), "Source switch retains keyboard focus");

  await page.locator("#query").fill("blue");
  check(await results.count() === 1, "Text search narrows results");
  check(await page.locator("#content-type").locator('option[value="images"]').innerText() === "Images (1)", "Type counts follow search");
  await page.locator("#clear").click();
  check(await results.count() === 5, "Clear restores results");
  check(await page.locator("#query").evaluate(node => node === document.activeElement), "Clear returns focus to search");

  await page.locator("#try-source").click();
  check(await results.count() === 1, "Literal empty-alt search returns one sample");
  check(await page.locator("#detail pre mark").innerText() === 'alt=""', "Source query highlighted at the matching location");
  check((await page.locator("#detail dl").innerText()).includes('Empty: alt=""'), "Empty alt shown without an audit verdict");
  await page.locator("#search-mode").selectOption("text");
  check(await results.count() === 0, "Text and source search have distinct scopes");
  await page.getByRole("button", { name: "Reset filters", exact: true }).click();
  check(await results.count() === 22, "Empty-state reset restores all sample elements");

  await page.locator("#try-tables").click();
  check(await results.count() === 3, "Browse tables");
  check(await page.locator("#detail table").count() === 1, "Table preview renders a table");
  await page.locator("#chapter-filter").selectOption("2");
  check(await results.count() === 1, "Chapter filter narrows table inventory");
  check(await page.locator("#reading-chapter").inputValue() === "1", "Chapter filtering does not move the reader");
  await page.locator("#chapter-filter").selectOption("3");
  check(await results.count() === 0, "A chapter without tables has an explicit empty state");

  await page.locator("#reset").click();
  for (let index = 0; index < 4; index += 1) await detailButton("Next").click();
  check(await detailButton("Next").isDisabled(), "Next stops at final result");
  check(await detailButton("Previous").evaluate(node => node === document.activeElement), "Focus remains usable at navigation boundary");
  await detailButton("Previous").click();
  check(await page.locator("#detail h3").innerText() === "A bench beneath the apple trees", "Previous walks filtered results in book order");

  await page.locator("#expand").click();
  check(await page.locator("#reader").isHidden(), "Expanded inspector hides the reader");
  await detailButton("Show in book").click();
  check(await page.locator("#reader").isVisible(), "Show in book restores the reader from expanded view");
  check(await page.locator("#reading-chapter").inputValue() === "2", "Expanded-view navigation uses selected location");

  await page.locator("#content-type").selectOption("links");
  await page.locator('[data-result-id="orchard-return"]').click();
  await detailButton("Preview").click();
  await page.locator("#detail").getByRole("link", { name: "Return to the river" }).click();
  check(await page.locator(".reading-target").getAttribute("data-reading-id") === "river-start", "Sample EPUB links navigate within the book");

  await page.locator("#try-images").click();
  await page.locator("#query").fill('<img onerror="throw 1">');
  check(await results.count() === 0, "Search input is treated as text, not markup");
  await page.locator("#reset").click();
  for (const appearance of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: appearance });
    for (const width of [1440, 1100, 900, 850, 620, 390, 320]) {
      await page.setViewportSize({ width, height: 1050 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      check(!overflow, `No horizontal page overflow at ${width}px in ${appearance} mode`);
      check(await page.locator("#query").isVisible(), `Search remains available at ${width}px in ${appearance} mode`);
    }
  }
  await page.emulateMedia({ forcedColors: "active" });
  check(await results.count() === 5, "Results remain available in forced colors");
  check(errors.length === 0, `No browser errors: ${errors.join("; ")}`);
  console.log(`Inspector explorer prototype: ${checks} checks passed.`);
} finally {
  await browser.close();
}
