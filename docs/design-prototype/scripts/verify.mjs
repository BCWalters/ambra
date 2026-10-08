/* global books, renderLibrary, narrationTargets, narrationIndex, addSampleBookmark, syncPageBookmark, bookmarkRows, sortedBooks */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(new URL("../../../apps/e2e/package.json", import.meta.url));
const { chromium } = require("@playwright/test");
const directory = fileURLToPath(new URL("..", import.meta.url));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(10000);
const errors = [];
page.on("pageerror", error => errors.push(error.message));
const report = { responsive: [], interactions: [], contrast: [], screenshots: [] };
const check = (condition, label) => {
  assert.ok(condition, label);
  report.interactions.push(label);
};
const view = name => page.locator(`[data-view="${name}"]`).click();
const palettes = ["ambra", "silver", "green", "blue", "purple"];
const theme = async name => {
  await page.emulateMedia({ colorScheme: name });
  await page.waitForFunction(expected => document.documentElement.dataset.theme === expected, name);
};
const pageTheme = async name => {
  await page.locator("[data-app-settings]:visible").click();
  if (!await page.locator("#app-reading").getAttribute("open").then(value => value !== null)) await page.locator("#app-reading summary").click();
  await page.locator("#app-page-theme").selectOption(name);
};

try {
  await page.goto(new URL("../index.html", import.meta.url).href);
  const extensionRequire = createRequire(new URL("../../../apps/extension/package.json", import.meta.url));
  const { createElement } = extensionRequire("react");
  const { renderToStaticMarkup } = extensionRequire("react-dom/server");
  const { QuestionCircle24Regular, Settings24Regular, Library24Regular, TextBulletList24Regular, TextFont24Regular, Search24Regular, Bookmark24Regular, Bookmark24Filled, Pin24Regular, PinOff24Regular, Play24Regular, Pause24Regular } = extensionRequire("@fluentui/react-icons");
  for (const [id, component] of [["i-help", QuestionCircle24Regular], ["i-gear", Settings24Regular], ["i-library", Library24Regular], ["i-contents", TextBulletList24Regular], ["i-text", TextFont24Regular], ["i-reader-search", Search24Regular], ["i-page-bookmark", Bookmark24Regular], ["i-page-bookmarked", Bookmark24Filled], ["i-pin", Pin24Regular], ["i-unpin", PinOff24Regular], ["i-play", Play24Regular], ["i-pause", Pause24Regular]]) {
    const expected = renderToStaticMarkup(createElement(component)).match(/<path d="([^"]+)"/)[1];
    check(await page.locator(`#${id} path`).getAttribute("d") === expected && await page.locator(`#${id} path`).getAttribute("stroke") === "none", `${id} uses the unmodified standard Fluent glyph without added stroke`);
  }
  check(await page.locator("#interface-theme").inputValue() === "ambra", "Ambra remains the default");
  check(await page.locator("[data-theme-choice]").count() === 0, "No separate light/dark setting");
  for (const width of [1440, 900, 620, 360, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const palette of palettes) {
      await page.locator("#interface-theme").selectOption(palette);
    for (const color of ["light", "dark"]) {
      await theme(color);
      for (const name of ["library", "reader", "popup"]) {
        await view(name);
        const sizes = await page.evaluate(() => ({
          scroll: document.documentElement.scrollWidth,
          client: document.documentElement.clientWidth,
        }));
        assert.ok(sizes.scroll <= sizes.client, `Overflow: ${width}/${palette}/${color}/${name}`);
        report.responsive.push({ width, palette, appearance: color, view: name });
      }
    }
    }
  }
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.locator("#interface-theme").selectOption("ambra");
  for (const count of ["6", "0"]) {
    await page.locator("#sample-count").selectOption(count);
    for (const width of [1440, 360, 320]) {
      await page.setViewportSize({ width, height: 740 });
      for (const appearance of ["light", "dark"]) {
        await theme(appearance);
        for (const name of ["library", "reader", "popup"]) {
          await view(name);
          const settings = page.locator(`#view-${name} [data-app-settings]`);
          const help = page.locator(`#view-${name} [data-help]`);
          await settings.click();
          await page.waitForFunction(() => document.querySelector("#app-settings").matches(":popover-open") && document.querySelector("#app-settings").style.top !== "");
          check(await page.locator("#app-settings").evaluate((popover, reader) => {
            const reading = popover.querySelector("#app-reading"), ui = popover.querySelector("#app-interface");
            const readingFirst = Boolean(reading.compareDocumentPosition(ui) & Node.DOCUMENT_POSITION_FOLLOWING);
            return reading.open === reader && readingFirst === reader &&
              document.activeElement.id === (reader ? "app-page-theme" : "app-theme");
          }, name === "reader"), `Contextual settings order, expansion, and initial focus: ${count}/${width}/${appearance}/${name}`);
          const bounds = await page.locator("#app-settings").boundingBox();
          const frame = await settings.locator("xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' frame ')]").boundingBox();
          check(bounds.x >= frame.x && bounds.x + bounds.width <= frame.x + frame.width + 1 && bounds.y >= 0 && bounds.y + bounds.height <= 741, `Settings anchored within surface and viewport: ${count}/${width}/${appearance}/${name}`);
          check(await page.locator("#app-theme").isVisible() && await page.locator("#app-language").isDisabled(), `App settings show theme and explicit disconnected language control: ${name}`);
          check(await page.locator("#app-settings #book-size, #app-settings #book-font").count() === 0 && await page.locator("#app-settings #app-page-theme").count() === 1, `Ambra settings preserve global page-theme scope and exclude per-book typography: ${name}`);
          await page.keyboard.press("Escape");
          check(!await page.locator("#app-settings").isVisible() && await settings.evaluate(el => el === document.activeElement), `Settings Escape restores trigger: ${name}`);
          await help.click();
          check(await page.locator("#help-dialog").isVisible(), `Help available: ${count}/${width}/${appearance}/${name}`);
          const helpBounds = await page.locator("#help-dialog").boundingBox();
          check(helpBounds.x >= 0 && helpBounds.x + helpBounds.width <= width && helpBounds.y >= 0 && helpBounds.y + helpBounds.height <= 741, `Help fits viewport: ${count}/${width}/${appearance}/${name}`);
          if (name === "popup") {
            const popup = await page.locator("#popup-wrap .frame").boundingBox();
            check(helpBounds.x >= popup.x && helpBounds.x + helpBounds.width <= popup.x + popup.width + 1, "Compact help stays within popup width");
          }
          await page.locator("#help-shortcuts-button").click();
          check(await page.locator("#help-shortcuts").isVisible() && await page.locator("#help-shortcuts .shortcut-list > div").count() === 11, `All existing reader commands represented: ${name}`);
          check(await page.locator("#help-dialog").evaluate(el => el.scrollWidth <= el.clientWidth), `Shortcuts do not overflow: ${width}/${name}`);
          await page.locator("#help-back").click();
          check(await page.locator("#help-shortcuts-button").evaluate(el => el === document.activeElement), "Help Back restores shortcuts action focus");
          await page.keyboard.press("Escape");
          check(!await page.locator("#help-dialog").isVisible() && await help.evaluate(el => el === document.activeElement), `Help Escape restores originating control: ${name}`);
        }
      }
    }
  }
  await page.setViewportSize({ width: 1440, height: 1100 });
  await theme("light");
  await page.locator("#sample-count").selectOption("6");
  await view("library");
  await page.locator('#view-library [data-app-settings]').click();
  await page.locator("#app-settings").screenshot({ path: `${directory}app-settings.png` });
  report.screenshots.push("app-settings.png");
  const unchangedPaper = await page.locator("#paper").getAttribute("data-paper");
  await page.locator("#app-theme").selectOption("blue");
  check(!await page.locator("#app-settings").isVisible() && await page.locator("#interface-theme").inputValue() === "blue" && await page.locator("html").getAttribute("data-palette") === "blue", "App theme applies globally and dismisses settings");
  check(await page.locator("#paper").getAttribute("data-paper") === unchangedPaper, "App settings never change book appearance");
  await page.locator("#interface-theme").selectOption("ambra");
  await page.locator('#view-library [data-app-settings]').click();
  check(await page.locator("#app-theme").inputValue() === "ambra", "Review and app theme controls stay synchronized");
  await page.locator("#view-library h2").first().click();
  check(!await page.locator("#app-settings").isVisible(), "Settings dismiss on outside click without modal overlay");
  await page.locator('[data-details="0"]').click();
  await page.locator('#view-library [data-app-settings]').click();
  await page.keyboard.press("Escape");
  check(await page.locator("#book-details").isVisible(), "Settings Escape does not close underlying book panel");
  await page.locator('#view-library [data-help]').click();
  await page.locator("#help-dialog").screenshot({ path: `${directory}help-about.png` });
  report.screenshots.push("help-about.png");
  await page.locator("#help-about summary").first().focus();
  await page.keyboard.press("Tab");
  check(await page.locator("#close-help").evaluate(el => el === document.activeElement), "Help traps forward keyboard focus");
  await page.keyboard.press("Shift+Tab");
  check(await page.locator("#help-about summary").first().evaluate(el => el === document.activeElement), "Help traps reverse keyboard focus");
  check(await page.locator('#help-home a[href="https://ambraepub.org/en/docs/"]').count() === 1 && await page.locator('#help-home a[href="https://github.com/BCWalters/ambra/issues"]').count() === 1 && await page.locator('#help-home a[href="mailto:AmbraEPUB@outlook.com"]').count() === 1, "Help preserves guide, issue reporting, and feedback destinations");
  await page.evaluate(() => {
    globalThis.originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async text => { globalThis.copiedReport = text; } } });
  });
  await page.locator("#copy-diagnostics").click();
  await page.locator("#diagnostic-status").filter({ hasText: "copied" }).waitFor();
  check(await page.evaluate(() => globalThis.copiedReport.startsWith("Ambra design prototype") && !globalThis.copiedReport.includes("The Quiet Coast") && !globalThis.copiedReport.includes("file:///")), "Diagnostics explicitly identify prototype and omit book data/local paths");
  await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error("Clipboard permission denied"); }; });
  await page.locator("#copy-diagnostics").click();
  await page.locator("#diagnostic-error").filter({ hasText: "Clipboard permission denied" }).waitFor();
  check(await page.locator("#copy-diagnostics").isEnabled() && await page.locator("#diagnostic-status").textContent() === "", "Clipboard errors surface explicitly and allow retry");
  await page.evaluate(() => {
    if (globalThis.originalClipboardDescriptor) Object.defineProperty(navigator, "clipboard", globalThis.originalClipboardDescriptor);
    else delete navigator.clipboard;
    delete globalThis.originalClipboardDescriptor;
    delete globalThis.copiedReport;
  });
  await page.locator("#help-shortcuts-button").click();
  await page.locator("#help-dialog").screenshot({ path: `${directory}help-shortcuts.png` });
  report.screenshots.push("help-shortcuts.png");
  await page.locator("#close-help").click();
  check(await page.locator("#book-details").isVisible(), "Help dismissal preserves underlying book panel");
  await page.locator("#close-book-details").click();
  await view("library");
  const originalLabels = await page.evaluate(() => books.map(({ title, author }) => ({ title, author })));
  const longTitle = "Notes on the Coast: A Detailed Account of the Islands, Their Weather, and the Many Journeys Between Them";
  await page.evaluate(title => {
    books[1].title = title;
    books[1].author = "Alexandra Example, Benjamin Example, and Christopher Example";
    books[3].title = "LongTitleWithoutSpaces".repeat(8);
    books[4].title = "海辺の読書と旅の長い物語".repeat(8);
    renderLibrary();
  }, longTitle);
  for (const width of [1440, 900, 620, 360, 320]) {
    await page.setViewportSize({ width, height: 1100 });
    const rows = await page.locator("#book-grid .book").evaluateAll(cards => cards.map(card => {
      const rect = selector => card.querySelector(selector).getBoundingClientRect();
      return {
        row: Math.round(card.getBoundingClientRect().top),
        titleHeight: rect(".book-title").height,
        authorHeight: rect(".book-author").height,
        author: rect(".book-author").top,
        progress: rect(".progress").top,
        meta: rect(".book-meta").top,
      };
    }));
    check(rows.every(row => row.titleHeight === 42 && row.authorHeight === 18), `Titles reserve exactly two lines and authors one: ${width}px`);
    check(rows.every(row => rows.filter(peer => peer.row === row.row).every(peer => Math.abs(peer.author - row.author) < 1 && Math.abs(peer.progress - row.progress) < 1 && Math.abs(peer.meta - row.meta) < 1)), `Author/progress/details align within each row, including unread books: ${width}px`);
    for (const index of [1, 3, 4]) {
      check(await page.locator("#book-grid .book-title").nth(index).evaluate(el => el.scrollHeight > el.clientHeight && getComputedStyle(el).webkitLineClamp === "2"), `Long title is clamped with ellipsis: ${width}px/book ${index}`);
    }
    check(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `Long title and author do not overflow: ${width}px`);
  }
  check(await page.locator('#book-grid [data-open="1"]').getAttribute("aria-label") === `Open ${longTitle}`, "Full long title retained in accessible book name");
  await page.locator('[data-details="1"]').click();
  check(await page.locator("#book-details-content .detail-identity h3").textContent() === longTitle && await page.locator("#book-details-content .detail-identity h3").evaluate(el => el.scrollHeight <= el.clientHeight), "Book details show full untruncated title");
  await page.locator("#close-book-details").click();
  await page.evaluate(labels => {
    labels.forEach((label, index) => Object.assign(books[index], label));
    renderLibrary();
  }, originalLabels);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.locator("#library-search").fill("mara");
  check(await page.locator("#book-grid .book").count() === 1, "Search by author");
  check(await page.locator("#library-count").isVisible() && await page.locator("#library-count").textContent() === "1 of 6 books", "Filtered result count appears only during search");
  await page.locator("#library-search").fill("no matching book");
  check(await page.locator("#library-empty").isVisible(), "Empty search state");
  await page.locator("#library-search").fill("");
  check(!await page.locator("#library-count").isVisible(), "Unfiltered library has no duplicate count");
  check(!await page.locator("#view-library .frame").textContent().then(text => text.includes("Sample library")), "Demo library label removed from app preview");
  await page.locator("#library-sort").selectOption("title");
  check(await page.locator("#book-grid .book-title").first().textContent() === "A Season of Light", "Title sort");
  await page.locator("#library-sort").selectOption("author");
  check((await page.locator("#book-grid .book-author").allTextContents()).join("|") === "Iris Wren|James Joyce|Lewis Carroll|Mara Vale|Nora Fen|W. H. Davies", "Author sort");
  await page.locator("#library-sort").selectOption("oldest");
  check(await page.locator("#book-grid .book-title").first().textContent() === "A Season of Light", "Oldest added sort");
  check(await page.locator("#view-library .storage-summary").textContent() === "6 books · 71.8 MB used · 100 GB available", "Library storage footer");
  await page.locator("#library-sort").selectOption("recent");
  await page.locator('[data-details="0"]').click();
  check(await page.locator("#book-details").isVisible() && !await page.locator("#details-dialog").isVisible(), "Book details panel replaces modal");
  check(await page.locator("#book-details-content").getByText("Publication details", { exact: true }).isVisible(), "Publication details retained");
  check(await page.locator("#book-details-content [data-file-size]").textContent() === "3.1 MB", "File size retained in publication details");
  check(await page.locator("#book-details-content .detail-author").count() === 1 && await page.locator("#book-details-content dt").allTextContents().then(labels => !labels.includes("Author")), "Author shown once in metadata, beside cover");
  check(await page.locator("#book-details-content .detail-publisher").textContent() === "Ambra Sample Editions" && await page.locator("#book-details-content dt").allTextContents().then(labels => !labels.includes("Publisher")), "Publisher shown under author without redundant label");
  check(!await page.locator("#book-details-content").textContent().then(text => text.includes("Available for an imported EPUB") || text.includes("Sample progress")), "Demo explanations removed from book details");
  await page.keyboard.press("Escape");
  await page.locator("#book-details").waitFor({ state: "hidden" });
  check(await page.locator('[data-details="0"]').evaluate(el => el === document.activeElement), "Escape and book panel focus restoration");
  await page.locator('[data-details="1"]').click();
  check(await page.locator("#book-details-content .detail-publisher").textContent() === "Standard Ebooks" && await page.locator("#book-details-content [data-file-size]").textContent() === "2.2 MB", "Real sample publisher and file size match source");
  await page.locator("#close-book-details").click();
  await page.locator(".resume [data-open]").click();
  check(await page.locator("#view-reader").isVisible(), "Continue reading");
  const libraryGlyph = await page.locator('#book-grid [data-details="0"] use').getAttribute("href");
  check(await page.locator("#reader-details-toggle use").getAttribute("href") === libraryGlyph, "Same book-information glyph in reader and library");
  await page.locator("#reader-details-toggle").click();
  check(await page.locator("#reader-details-content").isVisible() && await page.locator("#panel-title").textContent() === "Book details", "Reader book-information icon opens details panel");
  check(await page.locator("#reader-details-content .detail-publisher").textContent() === "Ambra Sample Editions" && await page.locator("#reader-details-content [data-file-size]").textContent() === "3.1 MB", "Reader shares publisher and file-size layout");
  await page.locator("#close-panel").click();
  check(await page.locator("#reader-details-toggle").evaluate(el => el === document.activeElement), "Reader details close restores icon focus");
  await page.locator("#notes-toggle").click();
  const paper = await page.locator("#paper").evaluate(el => getComputedStyle(el).backgroundColor);
  await theme("light");
  check(await page.locator("#paper").evaluate(el => getComputedStyle(el).backgroundColor) === paper, "Interface theme preserves page");
  await page.locator("#interface-theme").selectOption("green");
  await theme("dark");
  check(await page.locator("#interface-theme").inputValue() === "green", "Browser appearance preserves selected color theme");
  check(await page.locator("#paper").evaluate(el => getComputedStyle(el).backgroundColor) === paper, "Browser dark appearance preserves page");
  await theme("light");
  await page.locator("#interface-theme").selectOption("ambra");
  await pageTheme("dark");
  check(await page.locator("#paper").evaluate(el => getComputedStyle(el).backgroundColor) !== paper, "Independent page theme");
  check(await page.locator("html").getAttribute("data-theme") === "light", "Page theme preserves interface");
  await pageTheme("white");
  check((await page.locator("#notes-toggle").textContent()).trim() === "Annotations" && await page.locator("#panel-title").textContent() === "Annotations", "Annotations naming matches between toolbar and panel");
  check((await page.locator("#annotation-filter option").allTextContents()).join("|") === "All annotations (4)|Highlights (3)|Notes (2)|Bookmarks (1)", "Single Show dropdown preserves all categories and counts");
  await page.locator("#annotation-filter").selectOption("highlights");
  check(await page.locator(".annotation:visible").count() === 3 && await page.locator('.annotation[data-kind="highlights"]').isVisible(), "Highlights filter includes highlights with and without notes");
  check(await page.locator('.annotation[data-kind="highlights"] .note').count() === 0 && await page.locator('.annotation[data-kind="highlights"] .quote').textContent() === await page.locator("#paper .highlight-only").textContent(), "Plain highlight has no fabricated note and matches highlighted sample text");
  await page.locator("#annotation-filter").selectOption("notes");
  check(await page.locator(".annotation:visible").count() === 2 && !await page.locator('.annotation[data-kind="highlights"]').isVisible(), "Notes filter includes only highlights with attached notes");
  await page.locator("#annotation-filter").selectOption("bookmarks");
  check(await page.locator(".annotation:visible").count() === 1, "Bookmark filter");
  await page.locator("#annotation-filter").selectOption("all");
  check(await page.locator(".annotation:visible").count() === 4, "All annotations restores four distinct items");
  await page.locator("#annotation-filter").focus();
  await page.keyboard.press("h");
  await page.keyboard.press("Tab");
  check(await page.locator("#annotation-filter").inputValue() === "highlights" && await page.locator(".annotation:visible").count() === 3, "Show dropdown supports native keyboard filtering");
  await page.locator("#annotation-filter").selectOption("all");
  check(await page.locator(".reader-toolbar button").first().getAttribute("id") === "contents-toggle" && await page.locator(".reader-toolbar button").nth(1).getAttribute("id") === "reader-library", "Contents precedes Library in visual and keyboard order with both labels retained");
  const noteRow = page.locator('[data-annotation="notice"]');
  const plainRow = page.locator('[data-annotation="sea"]');
  const initialNote = await noteRow.locator(".note").textContent();
  check(await noteRow.evaluate(row => {
    const note = row.querySelector(".note"), quote = row.querySelector(".quote");
    return note.getBoundingClientRect().bottom <= quote.getBoundingClientRect().top &&
      parseFloat(getComputedStyle(note).fontSize) > parseFloat(getComputedStyle(quote).fontSize) &&
      getComputedStyle(note).color === getComputedStyle(document.body).color;
  }), "Own note precedes the excerpt with larger primary-foreground text");
  check(await plainRow.locator(".note").count() === 0 && await plainRow.locator("[data-edit-note]").textContent() === "Add note", "Plain highlights show Add note without an empty note block");
  await noteRow.locator("[data-edit-note]").click();
  check(await noteRow.locator("textarea").evaluate(el => el === document.activeElement) && await page.locator("dialog[open]").count() === 0, "Edit note focuses an inline editor rather than a dialog");
  await noteRow.locator("textarea").fill("Unsaved draft");
  await noteRow.locator("[data-cancel-note]").click();
  check(await noteRow.locator(".note").textContent() === initialNote && await noteRow.locator("[data-edit-note]").evaluate(el => el === document.activeElement), "Cancel preserves original note and restores Edit action focus");
  await noteRow.locator("[data-edit-note]").click();
  await noteRow.locator("textarea").fill("Another unsaved draft");
  await noteRow.locator("textarea").evaluate(el => el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", isComposing: true, bubbles: true, cancelable: true })));
  check(await noteRow.locator(".note-editor").isVisible() && await page.locator("#notes-content").isVisible(), "IME Escape does not cancel editing or close Annotations");
  await page.keyboard.press("Escape");
  check(await noteRow.locator(".note").textContent() === initialNote && !await noteRow.locator(".note-editor").isVisible() && await page.locator("#notes-content").isVisible(), "Escape cancels only the note editor, not the panel");
  await noteRow.locator("[data-edit-note]").click();
  await noteRow.locator("textarea").fill("Keep this draft while navigating.");
  await page.locator("#contents-toggle").click();
  await page.locator("#notes-toggle").click();
  await page.locator("#annotation-filter").selectOption("bookmarks");
  await page.locator("#annotation-filter").selectOption("all");
  await view("library");
  await view("reader");
  check(await noteRow.locator("textarea").inputValue() === "Keep this draft while navigating." && await noteRow.locator(".note-editor").isVisible(), "Unsaved drafts survive panel, filter, and preview changes");
  await noteRow.locator("[data-cancel-note]").click();
  await plainRow.locator("[data-edit-note]").click();
  check(await plainRow.locator('[type="submit"]').isDisabled(), "Cannot add an empty note");
  await plainRow.locator("textarea").fill("   ");
  check(await plainRow.locator('[type="submit"]').isDisabled(), "Cannot add a whitespace-only note");
  const newNote = "A thought about this passage.\n<b>This remains literal text.</b>";
  await plainRow.locator("textarea").fill(newNote);
  await plainRow.locator('[type="submit"]').click();
  check(await plainRow.locator(".note").textContent() === newNote && await plainRow.locator(".note b").count() === 0, "Saving preserves multiline note content as text, never interpreted HTML");
  check(await plainRow.getAttribute("data-kind") === "notes" && await page.locator('#annotation-filter option[value="notes"]').textContent() === "Notes (3)" && await page.locator('#annotation-filter option[value="highlights"]').textContent() === "Highlights (3)" && await page.locator('#annotation-filter option[value="all"]').textContent() === "All annotations (4)", "Adding a note updates filters/counts without adding another annotation");
  await page.locator("#annotation-filter").selectOption("notes");
  check(await page.locator(".annotation:visible").count() === 3, "New note appears in Notes filter");
  for (const row of [plainRow, noteRow, page.locator('[data-annotation="home"]')]) {
    await row.locator("[data-edit-note]").click();
    await row.locator("textarea").fill("");
    check(await row.locator('[type="submit"]').isEnabled(), "Existing note can be cleared");
    await row.locator('[type="submit"]').click();
    check(await row.locator(".note").count() === 0 && await row.locator(".quote").count() === 1 && await row.getAttribute("data-kind") === "highlights", "Clearing a note retains its highlight and quotation");
    check(await page.locator("#annotation-filter").evaluate(el => el === document.activeElement && el.value === "notes"), "Removing the current filtered note restores focus to Notes filter");
  }
  check(await page.locator("#annotations-empty").isVisible() && await page.locator('#annotation-filter option[value="notes"]').textContent() === "Notes (0)", "Empty Notes filter has an explicit empty state");
  await page.locator("#reset-sample").click();
  await page.locator("#annotation-filter").selectOption("all");
  check(await noteRow.locator(".note").textContent() === initialNote && await plainRow.locator(".note").count() === 0 && await page.locator('#annotation-filter option[value="notes"]').textContent() === "Notes (2)", "Reset sample restores original notes and their counts");
  for (const width of [1440, 620, 360, 320]) {
    await page.setViewportSize({ width, height: 1100 });
    for (const appearance of ["light", "dark"]) {
      await theme(appearance);
      const filterLayout = await page.locator(".annotation-filters").evaluate(el => {
        const label = el.querySelector("label").getBoundingClientRect();
        const select = el.querySelector("select").getBoundingClientRect();
        return { height: el.getBoundingClientRect().height, centered: Math.abs(label.y + label.height / 2 - select.y - select.height / 2) < 1, fits: el.scrollWidth <= el.clientWidth };
      });
      check(filterLayout.height <= 56 && filterLayout.centered && filterLayout.fits, `Annotation filter occupies one compact row: ${width}/${appearance}`);
      await page.locator('#annotation-filter option[value="all"]').evaluate(option => option.textContent = "All annotations, highlighted passages, bookmarks, and personal notes (4)");
      check(await page.locator(".annotation-filters").evaluate(el => el.getBoundingClientRect().height <= 56 && el.scrollWidth <= el.clientWidth) && await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `Long filter labels do not create a second row or horizontal overflow: ${width}/${appearance}`);
      await page.locator("#annotation-filter").dispatchEvent("change");
      await noteRow.locator("[data-edit-note]").click();
      const bounds = await noteRow.locator("textarea").boundingBox();
      check(bounds.x >= 0 && bounds.x + bounds.width <= width && await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `Inline note editor fits ${width}/${appearance}`);
      if (width === 1440) {
        const filename = `note-editor-${appearance}.png`;
        await noteRow.screenshot({ path: `${directory}${filename}` });
        report.screenshots.push(filename);
      }
      await noteRow.locator("[data-cancel-note]").click();
      if (width === 1440) {
        const filename = `note-first-${appearance}.png`;
        await noteRow.screenshot({ path: `${directory}${filename}` });
        report.screenshots.push(filename);
      }
    }
  }
  await page.setViewportSize({ width: 1440, height: 1100 });
  await theme("light");
  await page.locator("#reader-library").click();
  check(await page.locator("#reader-library-content").isVisible() && await page.locator("#paper").isVisible(), "Library panel preserves reader");
  await page.locator("#panel-search").fill("iris");
  check(await page.locator("#panel-books .mini-book").count() === 1, "Panel search");
  await page.locator("#panel-search").fill("");
  await page.locator("#close-panel").click();
  check(await page.locator("#reader-library").evaluate(el => el === document.activeElement), "Panel focus restoration");
  await page.locator("#notes-toggle").click();
  for (const [action, title] of [["importAnnotations", "Import annotations"], ["export", "Export annotations"]]) {
    await page.locator(`#notes-content [data-explain="${action}"]`).click();
    check(await page.locator("#dialog-title").textContent() === title && await page.locator("#dialog-copy").textContent().then(text => text.includes("prototype")), `${title} is present and explicitly disconnected from real files`);
    await page.locator("#details-dialog button").click();
    check(await page.locator(`#notes-content [data-explain="${action}"]`).evaluate(el => el === document.activeElement), `${title} explanation restores action focus`);
  }
  check(await page.locator("#paper-toggle").count() === 0 && await page.locator("#reader-chapter-label").textContent() === "The headland", "Reader uses a single navigation label and no Page: Paper toolbar shortcut");
  check(await page.locator("#paper .page-number").count() === 0 && await page.locator(".reader-footer").textContent().then(text => text.includes("45 of 157")), "Reader page counts stay in progress chrome, with no standalone mock page number");
  for (const width of [1440, 900, 620, 360, 320]) {
    await page.setViewportSize({ width, height: 1100 });
    for (const appearance of ["light", "dark"]) {
      await theme(appearance);
      for (const [trigger, content, side] of [
        ["contents-toggle", "contents-content", "left"],
        ["notes-toggle", "notes-content", "right"],
        ["reader-library", "reader-library-content", "left"],
        ["reader-search", "reader-search-content", "right"],
        ["reader-details-toggle", "reader-details-content", "right"],
      ]) {
        await page.locator(`#${trigger}`).click();
        check(await page.locator(`#${content}`).isVisible() && await page.locator("#reader-panel > .panel-content:visible").count() === 1, `Only one reader panel active: ${width}/${appearance}/${content}`);
        check(await page.locator(`#${trigger}`).getAttribute("aria-pressed") === "true", `Panel trigger selected: ${trigger}`);
        if (width > 620) {
          const panelBounds = await page.locator("#reader-panel").boundingBox();
          const paperBounds = await page.locator("#paper").boundingBox();
          check(side === "left" ? panelBounds.x + panelBounds.width <= paperBounds.x + 1 : paperBounds.x + paperBounds.width <= panelBounds.x + 1, `Panel on correct ${side} side: ${width}/${content}`);
        }
        check(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `Reader panel fits viewport: ${width}/${appearance}/${content}`);
        if (trigger === "contents-toggle") {
          const pages = await page.locator(".toc-page").evaluateAll(nodes => nodes.map(node => {
            const page = node.getBoundingClientRect(), label = node.previousElementSibling.getBoundingClientRect();
            return { right: page.right, separated: label.right < page.left, text: node.textContent, accessible: node.parentElement.getAttribute("aria-label") === `${node.previousElementSibling.textContent}, page ${node.textContent}` };
          }));
          check(pages.length === 8 && pages.map(item => item.text).join(",") === "1,43,45,45,45,45,78,120" && pages.every(item => item.accessible && item.separated && Math.abs(item.right - pages[0].right) < 1), `TOC has right-aligned, separately labeled simulated page numbers: ${width}/${appearance}`);
          await page.locator('[data-toc-target="sample-gate"]').click();
          check(await page.locator("#sample-gate").evaluate(el => el === document.activeElement) && await page.locator("#reader-chapter-label").textContent() === "Beside the gate" && await page.locator("#reader-location").count() === 0, "Contents targets actual sample anchor without an ambiguous footer chapter label");
          check(await page.locator('[data-toc-target][aria-current="location"]').count() === 1, "Exactly one current Contents entry");
          await page.locator('[data-toc-target="sample-chapter"]').click();
          if (width === 1440) {
            const filename = `reader-contents-${appearance}.png`;
            await page.locator("#view-reader .frame").screenshot({ path: `${directory}${filename}` });
            report.screenshots.push(filename);
          }
        }
      }
      await page.keyboard.press("Escape");
      check(!await page.locator("#reader-panel").isVisible() && await page.locator("#reader-details-toggle").evaluate(el => el === document.activeElement), "Reader panel Escape restores matching trigger");
    }
  }
  await page.setViewportSize({ width: 1440, height: 1100 });
  await theme("light");
  await page.locator("#contents-toggle").click();
  await page.locator("#pin-panel").click();
  await page.keyboard.press("Escape");
  check(await page.locator("#contents-toggle").evaluate(el => el === document.activeElement), "Contents Escape restores its own trigger");
  await page.locator("#notes-toggle").click();
  await page.locator("#pin-panel").click();
  await pageTheme("sepia");
  await view("library");
  await page.locator('#view-library [data-app-settings]').click();
  await page.locator("#app-settings").waitFor({ state: "visible" });
  check(await page.locator("#app-page-theme").inputValue() === "sepia" && await page.locator("#paper").getAttribute("data-paper") === "sepia" && !await page.locator("#app-reading").evaluate(el => el.open), "Library reprioritizes settings without resetting shared reading preferences");
  await page.keyboard.press("Escape");
  await view("reader");
  const appPalette = await page.locator("html").getAttribute("data-palette");
  for (const width of [1440, 360, 320]) {
    await page.setViewportSize({ width, height: 740 });
    await page.locator("#book-options-toggle").click();
    await page.locator("#book-options").waitFor({ state: "visible" });
    const bounds = await page.locator("#book-options").boundingBox();
    check(bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y >= 0 && bounds.y + bounds.height <= 741, `Book-options popover fits ${width}px`);
    check(await page.locator("#book-options #app-theme, #book-options #app-page-theme, #book-options #app-language").count() === 0, "Book options exclude Ambra-wide settings");
    if (width === 1440) {
      await page.locator("#book-options").screenshot({ path: `${directory}book-options.png` });
      report.screenshots.push("book-options.png");
    }
    await page.keyboard.press("Escape");
    check(await page.locator("#book-options-toggle").evaluate(el => el === document.activeElement) && await page.locator("#notes-content").isVisible(), "Book-options Escape restores trigger without closing Notes");
  }
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.locator("#book-options-toggle").click();
  await page.locator('#view-reader [data-app-settings]').click();
  await page.locator("#app-settings").waitFor({ state: "visible" });
  check(!await page.locator("#book-options").isVisible() && await page.locator("#app-settings").isVisible(), "Settings popovers are mutually exclusive");
  await page.locator("#app-brightness").focus();
  await page.keyboard.press("Home");
  check(await page.locator("#paper").evaluate(el => getComputedStyle(el).filter) === "brightness(0.3)", "Global brightness affects the sample page");
  await page.keyboard.press("Escape");
  await page.locator("#book-options-toggle").click();
  await page.locator("#book-options").waitFor({ state: "visible" });
  for (const id of ["book-size", "book-lines", "book-letters"]) {
    await page.locator(`#${id}`).focus();
    await page.keyboard.press("End");
  }
  await page.locator("#book-width").focus();
  await page.keyboard.press("Home");
  const typography = await page.locator("#excerpt-headland .prose").evaluate(el => {
    const style = getComputedStyle(el);
    return { size: parseFloat(style.fontSize), lines: parseFloat(style.lineHeight), letters: parseFloat(style.letterSpacing), width: parseFloat(style.maxWidth) };
  });
  check(typography.size === 36 && Math.abs(typography.lines - 106.56) < .1 && Math.abs(typography.letters - 4.32) < .01 && typography.width === 864, `Book sliders apply their exact size/spacing/column-width values: ${JSON.stringify(typography)}`);
  await page.locator("#book-font").selectOption("sans");
  check(await page.locator("#excerpt-headland .prose").evaluate(el => getComputedStyle(el).fontFamily.includes("Arial")) && !await page.locator("#book-options").isVisible(), "Font selection applies and dismisses Book options");
  await page.locator("#book-options-toggle").click();
  await page.locator("#reset-book-options").click();
  check(await page.locator("#excerpt-headland .prose").evaluate(el => getComputedStyle(el).fontSize === "18px") && await page.locator("#paper").getAttribute("data-paper") === "sepia" && await page.locator("#paper").evaluate(el => getComputedStyle(el).filter) === "brightness(0.3)" && await page.locator("html").getAttribute("data-palette") === appPalette, "Reset Book options restores only book typography, preserving all global appearance settings");
  await page.locator('#view-reader [data-app-settings]').click();
  await page.locator("#app-settings").waitFor({ state: "visible" });
  await page.locator("#app-brightness").focus();
  await page.keyboard.press("End");
  await page.keyboard.press("Escape");
  await pageTheme("white");
  await page.locator('#view-reader [data-app-settings]').click();
  await page.locator("#app-settings").screenshot({ path: `${directory}ambra-reading-settings.png` });
  report.screenshots.push("ambra-reading-settings.png");
  await page.keyboard.press("Escape");
  await view("popup");
  await page.locator("#popup-search").fill("ulysses");
  check(await page.locator("#popup-books .mini-book").count() === 1, "Popup search");
  await page.locator("#popup-search").fill("");
  for (const width of [320, 360]) {
    await page.locator(`[data-width="${width}"]`).click();
    check(Math.round((await page.locator("#popup-wrap").boundingBox()).width) === width, `${width}px popup geometry`);
  }
  await page.locator("#view-popup [data-go-library]").click();
  check(await page.locator("#view-library").isVisible(), "Full-library preview navigation");
  await page.locator('#interface-theme').focus();
  await page.keyboard.press("Tab");
  check(await page.locator('[data-view="library"]').evaluate(el =>
    el === document.activeElement && el.matches(":focus-visible") && getComputedStyle(el).outlineWidth === "2px"), "Keyboard focus ring");
  check(await page.locator("#book-grid .cover.artwork img").count() === 3, "Three real covers");
  check(await page.locator("#book-grid .cover:not(.artwork)").count() === 3, "Three generated covers retained");
  const images = await page.locator("img").evaluateAll(nodes => Promise.all(nodes.map(async img => {
    await img.decode();
    return img.naturalWidth > 0 && img.naturalHeight > 0;
  })));
  check(images.every(Boolean), "All local cover and brand images load");
  check(await page.locator(".cover.artwork img").evaluateAll(nodes => nodes.every(img => getComputedStyle(img).objectFit === "contain")), "Real cover artwork is not cropped");
  check(await page.locator(".cover.artwork img").evaluateAll(nodes => nodes.every(img => {
    const style = getComputedStyle(img), cover = getComputedStyle(img.parentElement);
    return ["borderTopLeftRadius", "borderTopRightRadius", "borderBottomRightRadius", "borderBottomLeftRadius"].every(property => style[property] === cover[property]) &&
      style.borderTopLeftRadius === "3px" && style.borderTopRightRadius === "7px";
  })), "Real images inherit the same asymmetric book-cover corner rounding");
  check(await page.locator("#book-grid .cover:not(.artwork)").evaluateAll(nodes => nodes.every(el => {
    const box = el.getBoundingClientRect();
    return Math.abs(box.width / box.height - 2 / 3) < .001;
  })), "Generated library covers use 2:3 proportions");
  check(await page.locator("#select-books, #book-actions, [data-actions]").count() === 0, "No bulk selection or redundant overflow menu");
  await page.locator('#book-grid [data-open="0"]').focus();
  await page.keyboard.press("Delete");
  check(await page.locator("#cancel-remove").evaluate(el => el === document.activeElement), "Single removal defaults to Cancel");
  check(await page.locator("#remove-titles li").textContent() === "The Quiet Coast", "Single removal names book");
  await page.keyboard.press("Enter");
  await page.locator("#remove-dialog").waitFor({ state: "hidden" });
  check(await page.locator("#book-grid .book").count() === 6, "Enter on default Cancel preserves all books");
  await page.locator('[data-details="0"]').click();
  await page.locator('#book-details [data-remove="0"]').click();
  await page.locator("#confirm-remove").click();
  check(await page.locator("#book-grid .book").count() === 5, "Book details removal deletes only sample book");
  check(await page.locator(".resume-copy h3").textContent() === "Ulysses", "Continue reading moves to remaining sample book");
  check(await page.locator('#book-grid [data-open="1"]').evaluate(el => el === document.activeElement), "Confirmed removal focuses next book");
  await page.locator("#reset-sample").click();
  await page.locator("#library-search").fill("glass");
  await page.keyboard.press("Backspace");
  check(await page.locator("#library-search").inputValue() === "glas" && !await page.locator("#remove-dialog").isVisible(), "Backspace edits search without removing a book");
  await page.keyboard.press("Delete");
  check(!await page.locator("#remove-dialog").isVisible(), "Delete in search does not remove a book");
  await page.locator("#find-books").focus();
  await page.keyboard.press("Delete");
  check(!await page.locator("#remove-dialog").isVisible(), "Delete outside a book control is ignored");
  await page.locator('#book-grid [data-open="2"]').focus();
  await page.keyboard.press("Control+Delete");
  check(!await page.locator("#remove-dialog").isVisible(), "Modified Delete is not a removal shortcut");
  await page.locator('#book-grid [data-open="2"]').dispatchEvent("keydown", { key: "Delete", repeat: true, bubbles: true });
  check(!await page.locator("#remove-dialog").isVisible(), "Held Delete does not open another confirmation");
  await page.keyboard.press("Delete");
  check(await page.locator("#remove-titles li").textContent() === "The Glass Orchard", "Keyboard removal names only focused filtered book");
  check(await page.locator("#remove-warning").textContent().then(text => text.includes("This cannot be undone") && text.includes("notes") && text.includes("Original EPUB files on disk are not deleted")), "Confirmation states reading-data loss and original-file preservation");
  await page.locator("#remove-dialog").screenshot({ path: `${directory}remove-confirmation.png` });
  report.screenshots.push("remove-confirmation.png");
  await page.keyboard.press("Escape");
  await page.locator("#remove-dialog").waitFor({ state: "hidden" });
  check(await page.locator('#book-grid [data-open="2"]').evaluate(el => el === document.activeElement), "Cancel restores focused book");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Delete");
  check(await page.locator("#remove-dialog").isVisible() && await page.locator("#book-grid .book").count() === 2, "Delete inside confirmation cannot confirm removal");
  await page.locator("#confirm-remove").click();
  check(await page.locator('#book-grid [data-open="3"]').evaluate(el => el === document.activeElement), `Filtered removal focuses next matching book: ${await page.evaluate(() => document.activeElement.outerHTML.slice(0,300))}; errors=${errors.join(";")}`);
  await page.keyboard.press("Delete");
  await page.locator("#confirm-remove").click();
  check(await page.locator("#find-books").evaluate(el => el === document.activeElement), "No remaining matches returns focus to Find books");
  await page.locator("#library-search").fill("");
  check(await page.locator("#book-grid .book").count() === 4, "Each confirmation removes exactly one sample book");
  await page.locator('#book-grid [data-open="5"]').focus();
  await page.keyboard.press("Delete");
  await page.locator("#confirm-remove").click();
  check(await page.locator('#book-grid [data-open="4"]').evaluate(el => el === document.activeElement), "Removing last visible book focuses previous book");
  await page.locator("#sample-count").selectOption("2");
  await view("popup");
  await page.locator('#popup-books [data-open="0"]').focus();
  await page.keyboard.press("Delete");
  await page.locator("#confirm-remove").click();
  check(await page.locator('#popup-books [data-open="1"]').evaluate(el => el === document.activeElement), "Compact keyboard removal focuses next book");
  await page.keyboard.press("Backspace");
  await page.locator("#confirm-remove").click();
  check(await page.locator("#popup-find-books").evaluate(el => el === document.activeElement), "Empty compact library focuses Find books");
  await view("library");
  check(await page.locator("#empty-library-help").isVisible(), "Single-book removals reach empty library safely");
  await page.locator("#sample-count").selectOption("6");
  await page.locator("#reset-sample").click();
  await page.locator("#library-sort").selectOption("title");
  const sortedOrder = await page.locator("#book-grid [data-open]").evaluateAll(nodes => nodes.map(el => el.dataset.open));
  await page.locator(`#book-grid [data-open="${sortedOrder[0]}"]`).focus();
  await page.keyboard.press("Delete");
  await page.locator("#confirm-remove").click();
  check(await page.locator(`#book-grid [data-open="${sortedOrder[1]}"]`).evaluate(el => el === document.activeElement), "Removal follows displayed sort order");
  check(await page.locator("#view-library .storage-summary").textContent() === "5 books · 68.7 MB used · 100 GB available", "Storage footer follows sample deletion");
  await page.locator("#reset-sample").click();
  await page.locator("#library-sort").selectOption("recent");
  for (const width of [1440, 360, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const count of ["6", "2", "0"]) {
      await page.locator("#sample-count").selectOption(count);
      await view("library");
      const gridBefore = await page.locator("#book-grid").boundingBox();
      check(await page.locator("#find-books").isVisible(), `Find books visible: ${width}px/${count} books`);
      if (count === "0") {
        check(!await page.locator("#view-library .library-footer").isVisible(), `Empty library omits statistics: ${width}px`);
        check(await page.locator("#empty-library-help .empty-art").isVisible(), `Full empty illustration present: ${width}px`);
        check(await page.locator("#empty-library-help button, #empty-library-help a, #empty-library-help input").count() === 0, `No empty-only library controls: ${width}px`);
      }
      await page.locator("#find-books").click();
      await page.locator("#discovery-dialog[open]").waitFor();
      check(await page.locator("#discovery-dialog .sources a").count() === 4, `Four discovery sources: ${width}px/${count}`);
      const box = await page.locator("#discovery-dialog").boundingBox();
      check(box.x >= 0 && box.x + box.width <= width && box.y >= 0 && box.y + box.height <= 1000, `Discovery fits viewport: ${width}px/${count}`);
      check(Math.abs(box.y + box.height / 2 - 500) < 1 && Math.abs(box.x + box.width / 2 - width / 2) < 1, `Discovery is centered: ${width}px/${count}`);
      await page.mouse.click(2, 2);
      check(await page.locator("#discovery-dialog").evaluate(el => el.matches(":modal")), `Backdrop does not dismiss or click through: ${width}px/${count}`);
      await page.locator("#discovery-dialog .sources a").last().focus();
      await page.keyboard.press("Tab");
      check(await page.locator("#close-discovery").evaluate(el => el === document.activeElement), `Discovery traps focus: ${width}px/${count}, active=${await page.evaluate(() => document.activeElement.outerHTML.slice(0,180))}`);
      const gridAfter = await page.locator("#book-grid").boundingBox();
      check(Math.abs(gridBefore.y - gridAfter.y) < 1, `Modal does not shift collection: ${width}px/${count}`);
      await page.keyboard.press("Escape");
      await page.locator("#discovery-dialog").waitFor({ state: "hidden" });
      check(await page.locator("#find-books").evaluate(el => el === document.activeElement), `Discovery restores focus: ${width}px/${count}`);
      await view("popup");
      check(await page.locator("#popup-find-books").isVisible(), `Compact Find books visible: ${width}px/${count}`);
      if (count === "0") {
        check(!await page.locator("#view-popup .storage-summary").isVisible(), `Compact empty statistics hidden: ${width}px`);
        check(await page.locator("#view-popup [data-go-library]").isVisible(), `Compact expand action persists while empty: ${width}px`);
        check(await page.locator("#popup-empty-help button, #popup-empty-help a, #popup-empty-help input").count() === 0, `No empty-only compact controls: ${width}px`);
        const artwork = await page.locator("#popup-empty-help .empty-art").boundingBox();
        check(artwork.width === 120 && artwork.height === 75, `Compact illustration stays small: ${width}px`);
      } else {
        check(await page.locator("#view-popup .storage-summary").isVisible(), `Compact statistics return with books: ${width}px/${count}`);
      }
    }
  }
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.locator("#interface-theme").selectOption("green");
  const newPagePromise = page.context().waitForEvent("page");
  await page.locator("#popup-find-books").click();
  const discoveryPage = await newPagePromise;
  await discoveryPage.waitForLoadState();
  await discoveryPage.locator("#discovery-dialog[open]").waitFor();
  check(await discoveryPage.locator("#sample-count").inputValue() === "0", "Compact discovery new tab preserves empty library sample");
  check(await discoveryPage.locator("#interface-theme").inputValue() === "green", "Compact discovery new tab preserves color theme");
  check(await discoveryPage.locator("#view-library").isVisible(), "Compact discovery opens full library");
  await discoveryPage.close();
  await page.locator("#sample-count").selectOption("6");
  await page.locator("#interface-theme").selectOption("ambra");

  await view("reader");
  await theme("light");
  check(await page.locator("#reader-listen").count() === 0, "Read-along has no redundant toolbar entry");
  await page.locator("#reader-search").click();
  check(await page.locator("#book-search").evaluate(el => el === document.activeElement), "Search opens its results panel and focuses the query");
  await page.locator("#book-search").fill("se");
  check(await page.locator("#search-status").textContent() === "Enter at least 3 characters." && await page.locator("#book-search-results button").count() === 0, "Search minimum length is explicit");
  await page.locator("#book-search").fill("SEA");
  check(await page.locator("#book-search-results button").count() === 1 && await page.locator("#book-search-results mark").textContent() === "sea", "Search finds case-insensitive matches in sample publication text");
  await page.locator("#view-reader .frame").screenshot({ path: `${directory}reader-search.png` });
  report.screenshots.push("reader-search.png");
  await page.locator("#book-search-results button").click();
  check(await page.locator("#sample-bend").evaluate(el => el === document.activeElement) && await page.locator("#reader-search-content").isVisible(), "Pinned Search navigates to its result without closing");
  const dockedWidth = (await page.locator("#paper").boundingBox()).width;
  await page.locator("#pin-panel").click();
  check(await page.locator("#panel-scrim").isVisible() && (await page.locator("#paper").boundingBox()).width > dockedWidth, "Unpinning switches Search to a temporary overlay and releases page width");
  await page.locator("#book-search-results button").click();
  check(!await page.locator("#reader-panel").isVisible() && await page.locator("#sample-bend").evaluate(el => el === document.activeElement), "Unpinned search-result navigation closes the flyout and focuses content");
  await page.locator("#reader-search").click();
  check(await page.locator("#book-search").inputValue() === "SEA", "Search query survives reopening");
  await page.locator("#book-search").fill("<img");
  check(await page.locator("#book-search-results button, #book-search-results img").count() === 0 && await page.locator("#search-status").textContent() === "No matches. Try another search.", "Search treats query characters as literal text");
  await page.keyboard.press("Escape");
  check(await page.locator("#reader-search").evaluate(el => el === document.activeElement) && !await page.locator("#reader-panel").isVisible(), "Unpinned Search Escape restores trigger focus");
  await page.locator("#reader-search").click();
  await page.locator("#pin-panel").click();
  await page.locator("#book-search").fill("");
  await page.locator("#reader-search").click();
  await page.locator("#contents-toggle").click();
  check(await page.locator("#pin-panel").getAttribute("aria-pressed") === "true", "Reference pin state is independent from Search pin state");
  await page.locator("#pin-panel").click();
  await page.locator("#view-reader .frame").screenshot({ path: `${directory}reader-contents-flyout.png` });
  report.screenshots.push("reader-contents-flyout.png");
  await page.locator("#panel-scrim").click();
  check(!await page.locator("#reader-panel").isVisible() && await page.locator("#contents-toggle").evaluate(el => el === document.activeElement), "Outside click dismisses unpinned Contents and restores its trigger");
  await page.locator("#contents-toggle").click();
  await page.locator('[data-toc-target="sample-chapter"]').click();
  check(!await page.locator("#reader-panel").isVisible(), "Unpinned Contents closes on navigation");
  await page.locator("#contents-toggle").click();
  await page.locator("#pin-panel").click();
  await page.keyboard.press("Escape");
  check(await page.locator("#contents-content").isVisible() && !await page.locator("#close-panel").isVisible(), "Pinned Contents remains docked on Escape with the existing unpin affordance");
  await page.locator("#notes-toggle").click();
  check(await page.locator("#pin-panel").getAttribute("aria-pressed") === "true" && !await page.locator("#contents-content").isVisible(), "Switching from pinned Contents to Annotations preserves pin mode but replaces the panel");
  await page.locator("#reader-details-toggle").click();
  check(!await page.locator("#pin-panel").isVisible() && await page.locator("#close-panel").isVisible(), "Book details retain their non-pinnable behavior");
  await page.locator("#reader-library").click();
  check(!await page.locator("#pin-panel").isVisible(), "No unapproved pin behavior added to the library panel");
  await page.locator("#reset-sample").click();
  await page.locator("#notes-toggle").click();
  await page.locator("#annotation-filter").selectOption("bookmarks");
  await page.locator("#bookmark-page").click();
  check(await page.locator("#bookmark-page").getAttribute("aria-pressed") === "true" && await page.locator("#bookmark-page use").getAttribute("href") === "#i-page-bookmarked" && await page.locator("#current-page-bookmark").isVisible(), "Current-page bookmark has a filled active state and appears in Annotations");
  check(await page.locator('#annotation-filter option[value="bookmarks"]').textContent() === "Bookmarks (2)" && await page.locator('#annotation-filter option[value="all"]').textContent() === "All annotations (5)", "Bookmark action updates annotation totals without changing highlights");
  await page.locator("#current-page-bookmark [data-sample-target]").click();
  check(await page.locator("#sample-chapter").evaluate(el => el === document.activeElement), "New page bookmark navigates to its sample destination");
  await page.locator("#bookmark-page").click();
  check(await page.locator("#current-page-bookmark").count() === 0 && await page.locator('.annotation[data-kind="bookmarks"]').count() === 1 && await page.locator('.annotation[data-kind="bookmarks"]').textContent().then(text => text.includes("Page 43")), "Removing the current bookmark preserves the existing bookmark on another page");
  await page.locator("#bookmark-page").click();
  await page.locator("#reset-sample").click();
  check(await page.locator("#bookmark-page").getAttribute("aria-pressed") === "false" && await page.locator("#current-page-bookmark").count() === 0, "Reset sample resets the current-page bookmark");
  await page.locator("#annotation-filter").selectOption("all");
  await page.locator("#narration-sample").selectOption("available");
  await page.locator("#contents-toggle").click();
  await page.locator('[data-toc-target="sample-home"]').click();
  check(!await page.locator("#narration-return").isVisible(), "Return to narration does not appear before playback has been requested");
  await page.locator('[data-toc-target="sample-chapter"]').click();
  await page.locator("#notes-toggle").click();
  for (const width of [1440, 900, 620, 360, 320]) {
    await page.setViewportSize({ width, height: 1100 });
    for (const appearance of ["light", "dark"]) {
      await theme(appearance);
      await page.locator("#narration-sample").selectOption("unavailable");
      check(!await page.locator("#narration-controls").isVisible(), `No read-along UI without media overlays: ${width}/${appearance}`);
      await page.locator("#narration-sample").selectOption("available");
      check(await page.locator("#narration-controls").isVisible() && (await page.locator("#narration-play").textContent()).trim() === "Play" && await page.locator("#toggle-narration").getAttribute("aria-expanded") === "true", `Media-overlay sample automatically opens paused: ${width}/${appearance}`);
      const expanded = await page.locator("#narration-controls").boundingBox();
      const play = await page.locator("#narration-play").boundingBox();
      check(play.height >= 48 && play.width >= 104 && Math.abs(play.x + play.width / 2 - expanded.x - expanded.width / 2) < 1, `Expanded Play is large and centered: ${width}/${appearance}`);
      check(await page.locator(".reader-toolbar").evaluate(toolbar => {
        const frame = toolbar.closest(".frame").getBoundingClientRect();
        return [...toolbar.querySelectorAll("button")].every(button => {
          const rect = button.getBoundingClientRect();
          return rect.left >= frame.left && rect.right <= frame.right && rect.top >= frame.top && rect.bottom <= toolbar.getBoundingClientRect().bottom;
        });
      }) && await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `Complete toolbar stays inside its frame: ${width}/${appearance}`);
      if (width === 1440) {
        const filename = `read-along-expanded-${appearance}.png`;
        await page.locator("#narration-controls").screenshot({ path: `${directory}${filename}` });
        report.screenshots.push(filename);
      }
      await page.locator("#narration-play").click();
      check((await page.locator("#narration-play").textContent()).trim() === "Pause" && await page.locator("#announcement").textContent().then(text => text.includes("no audio")), "Explicit Play previews playback state without pretending audio is playing");
      await page.locator("#toggle-narration").click();
      const compact = await page.locator("#narration-controls").boundingBox();
      check(compact.height < expanded.height && compact.height <= 90 && await page.locator("#narration-play").isVisible() && !await page.locator("#narration-rate").isVisible() && !await page.locator("#narration-previous").isVisible(), `Compact strip retains playback without secondary controls: ${width}/${appearance}`);
      if (width === 1440) {
        const filename = `read-along-compact-${appearance}.png`;
        await page.locator("#narration-controls").screenshot({ path: `${directory}${filename}` });
        report.screenshots.push(filename);
      }
      await page.locator("#narration-play").click();
      check((await page.locator("#narration-play").textContent()).trim() === "Play" && await page.locator("#toggle-narration").getAttribute("aria-expanded") === "false", "Compact playback remains operable without expanding");
      await page.locator("#toggle-narration").click();
      check((await page.locator("#narration-play").textContent()).trim() === "Play", "Expanding controls does not autoplay");
    }
  }
  await page.setViewportSize({ width: 1440, height: 1100 });
  await theme("light");
  await page.locator("#narration-previous").click();
  check(await page.locator("#narration-previous").isDisabled(), "Narration previous respects first-passage boundary");
  await page.locator("#narration-next").click();
  await page.locator("#narration-next").click();
  await page.locator("#narration-rate").selectOption("1.5");
  await page.locator("#contents-toggle").click();
  await page.locator('[data-toc-target="sample-home"]').click();
  check(await page.locator("#narration-return").isVisible(), "Browsing away exposes Return to narration");
  await page.locator("#narration-return").click();
  check(await page.locator("#sample-notebook").evaluate(el => el === document.activeElement) && !await page.locator("#narration-return").isVisible(), "Return to narration targets the selected sample passage");
  await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector("#sample-gate"));
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await page.locator("#narration-from-page").filter({ hasText: "Jump to selection" }).waitFor();
  await page.locator("#narration-from-page").click();
  check(await page.evaluate(() => narrationTargets[narrationIndex] === "sample-gate"), "Jump to selection uses the selected sample passage");
  await page.evaluate(() => getSelection().removeAllRanges());
  await page.locator("#narration-from-page").filter({ hasText: "Restart page audio" }).waitFor();
  check(await page.locator("#narration-from-page").textContent() === "Restart page audio", "Page playback action uses the approved explicit label");
  await page.locator("#narration-next").click();
  await page.locator("#narration-next").click();
  await page.locator("#narration-next").click();
  check(await page.locator("#narration-next").isDisabled(), "Narration next respects final-passage boundary");
  await page.locator("#narration-play").focus();
  await page.keyboard.press("Escape");
  check(await page.locator("#toggle-narration").getAttribute("aria-expanded") === "false" && await page.locator("#narration-controls").isVisible() && await page.locator("#toggle-narration").evaluate(el => el === document.activeElement), "Narration Escape collapses rather than removing playback access");
  await page.locator("#narration-sample").selectOption("unavailable");
  await page.locator("#narration-sample").selectOption("available");
  await page.locator("#narration-rate").selectOption("1");
  check((await page.locator("#narration-play").textContent()).trim() === "Play" && await page.locator("audio, video").count() === 0, "Availability reset returns to paused controls without loading media");
  await page.locator('[data-toc-target="sample-chapter"]').click();
  await page.locator("#notes-toggle").click();

  // Exercise the real pointer/keyboard paths, including the bookmark lane outside the slider.
  await page.locator("#reset-sample").click();
  const slider = page.locator("#book-scrubber");
  const position = page.locator("#reader-position");
  const preview = page.locator("#scrubber-preview");
  const seekByKeyboard = async key => {
    await slider.focus();
    await page.keyboard.press(key);
  };
  await slider.scrollIntoViewIfNeeded();
  let track = await slider.boundingBox();
  const atPage = number => track.x + Math.max(.5, Math.min(track.width - .5, (number - 1) / 156 * track.width));
  await page.mouse.move(atPage(45), track.y + 16);
  await page.mouse.down();
  await page.mouse.move(atPage(100), track.y + 16);
  check(await position.textContent() === "Page 45 of 157 · 29%" && await page.locator("#excerpt-headland").isVisible(), "Dragging previews without changing the current readout or chapter excerpt");
  check(await preview.isVisible() && await page.locator("#scrubber-chapter").textContent() === "The harbour" && await page.locator("#scrubber-page").textContent() === "Page 100 of 157" && await slider.getAttribute("aria-valuetext") === "Go to: Page 100 of 157, The harbour", "Destination preview and accessible slider text describe the target, not the current page");
  await page.mouse.up();
  check((await position.textContent()).startsWith("Page 100 of 157") && await page.locator("#excerpt-harbour").isVisible() && !await preview.isVisible() && await slider.evaluate(el => el === document.activeElement), "Release commits the destination and preserves slider keyboard focus");
  check(await page.locator("#chapter-remaining").textContent() === "19 pages left in this chapter", "Remaining pages use the current chapter boundary");
  await seekByKeyboard("ArrowRight");
  check(await slider.getAttribute("aria-valuenow") === "101", "Keyboard advances exactly one page");
  await seekByKeyboard("PageDown");
  check(await slider.getAttribute("aria-valuenow") === "91", "Page Down moves ten pages backwards");
  await page.keyboard.down("ArrowRight");
  check(await slider.getAttribute("aria-valuenow") === "92" && (await position.textContent()).startsWith("Page 91 "), "Held keyboard input previews without committing");
  await page.keyboard.press("Escape");
  await page.keyboard.up("ArrowRight");
  check(await slider.getAttribute("aria-valuenow") === "91" && !await preview.isVisible(), "Escape cancels keyboard preview instead of navigating on key release");
  for (const [key, number, excerpt] of [["Home", "1", "before"], ["End", "157", "evening"], ["ArrowRight", "157", "evening"]]) {
    await seekByKeyboard(key);
    check(await slider.getAttribute("aria-valuenow") === number && await page.locator(`#excerpt-${excerpt}`).isVisible(), `${key} respects book bounds and shows the matching original excerpt`);
  }
  await page.locator("#bookmark-page").click();
  check(await page.locator('#scrubber-bookmarks [data-page="157"]').count() === 1, "Bookmark creation works away from the original page 45");
  await seekByKeyboard("Home");
  await page.locator("#bookmark-page").click();
  check(await page.locator('#scrubber-bookmarks [data-page="1"]').count() === 1, "Start-of-book bookmark is represented");
  await page.locator("#reset-sample").click();
  await page.locator("#bookmark-page").click();
  check(await page.locator("#scrubber-bookmarks .grouped").count() === 1 && await page.locator("#scrubber-bookmarks .bookmark-count").textContent() === "2", "Nearby bookmarks share one counted flag");

  for (const width of [1440, 900, 620, 360, 320]) {
    await page.setViewportSize({ width, height: 1100 });
    for (const appearance of ["light", "dark"]) {
      await theme(appearance);
      await slider.scrollIntoViewIfNeeded();
      await page.waitForFunction(() => document.querySelector("#scrubber-bookmarks").offsetHeight === 24);
      const geometry = await page.evaluate(() => {
        const rail = document.querySelector("#book-scrubber").getBoundingClientRect();
        const footer = document.querySelector(".reader-footer").getBoundingClientRect();
        const flags = [...document.querySelectorAll("#scrubber-bookmarks button")].map(node => {
          const rect = node.getBoundingClientRect();
          return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height, page: (Number(node.dataset.firstPage) + Number(node.dataset.lastPage)) / 2 };
        });
        return { width: rail.width, available: footer.width, height: footer.height, separated: flags.every(flag => flag.y >= rail.bottom), flagsAligned: flags.every(flag => Math.abs(flag.x + flag.width / 2 - rail.x - (flag.page - 1) / 156 * rail.width) < 1), collision: flags.some((flag, index) => index > 0 && flags[index - 1].right > flag.x), targets: flags.every(flag => flag.width >= 24 && flag.height >= 24) };
      });
      check(geometry.width >= geometry.available - 80, `Track uses nearly the full available width: ${width}/${appearance}`);
      check(geometry.separated && geometry.flagsAligned && !geometry.collision && geometry.targets, `Bookmark groups sit below the bar centred on their ranges, with nonoverlapping hit areas: ${width}/${appearance}`);
      check(geometry.height <= (width >= 620 ? 86 : 106), `Nearby bookmarks add no footer height: ${width}/${appearance}`);
      track = await slider.boundingBox();
      for (const number of [1, 43, 157]) {
        await page.mouse.move(atPage(number), track.y + 16);
        check(await preview.isVisible() && await page.locator("#scrubber-page").textContent() === `Page ${number} of 157`, `Hover preview reaches page ${number}: ${width}/${appearance}`);
        const popup = await preview.boundingBox();
        check(popup.x >= track.x - 1 && popup.x + popup.width <= track.x + track.width + 1 && Math.abs(track.y - popup.y - popup.height - 6) < 1, `Preview remains only 6px above the track, independent of bookmark stacking, at page ${number}: ${width}/${appearance}`);
        if (number === 43) check(await page.locator("#scrubber-bookmarked").isVisible(), "Bookmarked destinations are identified in the target preview");
      }
      await page.mouse.move(0, 0);
      if (width === 1440 || width === 320) {
        const filename = `scrubber-bookmarks-${width}-${appearance}.png`;
        await page.locator(".reader-footer").screenshot({ path: `${directory}${filename}` });
        report.screenshots.push(filename);
      }
    }
  }
  await page.setViewportSize({ width: 1440, height: 1100 });
  await theme("light");
  await page.locator("#scrubber-bookmarks .grouped").click();
  check(await page.locator("#bookmark-chooser").isVisible() && (await position.textContent()).startsWith("Page 45 ") && await page.locator("#bookmark-chooser-range").textContent() === "Pages 43–45" && !await page.locator("#all-bookmarks").isVisible(), "Group opens a bounded chooser without navigating, identifies the range, and omits unnecessary overflow action");
  await page.locator('#bookmark-choices [data-page="43"]').click();
  check((await position.textContent()).startsWith("Page 43 ") && await page.locator("#sample-chapter").evaluate(el => el === document.activeElement) && !await preview.isVisible() && !await page.locator("#bookmark-chooser").isVisible(), "Group choice navigates to its saved page without scrubbing");
  await page.locator("#scrubber-bookmarks .grouped").focus();
  await page.keyboard.press("Enter");
  await page.locator('#bookmark-choices [data-page="45"]').focus();
  await page.keyboard.press("Enter");
  check((await position.textContent()).startsWith("Page 45 ") && await page.locator("#sample-chapter").evaluate(el => el === document.activeElement), "Bookmark flag keyboard activation navigates to the same saved position");
  if (!await page.locator("#notes-content").isVisible()) await page.locator("#notes-toggle").click();
  await page.locator("#annotation-filter").selectOption("bookmarks");
  await page.locator('.annotation[data-bookmark-page="43"] button').click();
  check((await position.textContent()).startsWith("Page 43 ") && await page.locator("#sample-chapter").evaluate(el => el === document.activeElement), "Annotations and scrubber bookmarks produce the identical destination and focus");
  await page.locator("#pin-panel").click();
  await page.locator("#scrubber-bookmarks .grouped").click();
  await page.locator('#bookmark-choices [data-page="45"]').click();
  check(!await page.locator("#reader-panel").isVisible() && (await position.textContent()).startsWith("Page 45 "), "Direct bookmark navigation dismisses an unpinned panel");
  await page.locator("#notes-toggle").click();
  await page.locator("#pin-panel").click();
  await page.locator("#bookmark-page").click();
  check(await page.locator('#scrubber-bookmarks [data-page="45"]').count() === 0 && await page.locator('#scrubber-bookmarks [data-page="43"]').count() === 1, "Removing a bookmark synchronizes the flags without removing another bookmark");
  await slider.scrollIntoViewIfNeeded();
  track = await slider.boundingBox();
  await page.locator("#scrubber-bookmarks").click({ position: { x: track.width * .75, y: 16 } });
  check((await position.textContent()).startsWith("Page 45 ") && !await preview.isVisible(), "Blank bookmark-lane space never seeks the underlying track (issue 294)");
  await slider.scrollIntoViewIfNeeded();
  track = await slider.boundingBox();
  await page.mouse.move(atPage(45), track.y + 16);
  await page.mouse.down();
  await page.mouse.move(atPage(80), track.y + 16);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  check((await position.textContent()).startsWith("Page 45 ") && !await preview.isVisible(), "Escape cancels pointer scrubbing without a late release committing it");
  await page.locator("[data-app-settings]:visible").click();
  await page.locator("#app-landmarks").selectOption("off");
  check(!await page.locator("#scrubber-bands").isVisible() && await page.locator("#scrubber-bookmarks button").count() === 1 && await page.locator("[data-app-settings]:visible").evaluate(el => el === document.activeElement), "Hiding chapter landmarks preserves independent clickable bookmarks and restores settings focus");
  await page.locator("[data-app-settings]:visible").click();
  await page.locator("#app-landmarks").selectOption("upcoming");
  check(await page.locator(".scrubber-band").count() === 4 && await page.locator("#scrubber-bands").isVisible(), "Upcoming chapter bands can be restored");
  await slider.scrollIntoViewIfNeeded();
  track = await slider.boundingBox();
  await page.mouse.move(atPage(100), track.y + 16);
  await page.mouse.down();
  await page.locator("#view-reader .frame").screenshot({ path: `${directory}scrubber-destination.png` });
  check(await preview.isVisible(), "Destination screenshot captures the active near-thumb preview");
  report.screenshots.push("scrubber-destination.png");
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await page.mouse.move(0, 0);
  await page.locator("#reset-sample").click();
  await page.locator("#annotation-filter").selectOption("all");
  await page.locator("#narration-sample").selectOption("unavailable");
  await page.locator("#narration-sample").selectOption("available");
  check((await page.locator(".reader-footer").boundingBox()).height <= 86, "Resting desktop scrubber with one bookmark is at most 86px tall");

  await page.locator("#bookmark-sample").selectOption("close");
  await page.locator("#scrubber-bookmarks .grouped").click();
  await page.keyboard.press("Escape");
  check(!await page.locator("#bookmark-chooser").isVisible() && await page.locator("#scrubber-bookmarks .grouped").evaluate(el => el === document.activeElement) && await page.locator("#scrubber-bookmarks .grouped").getAttribute("aria-expanded") === "false", "Chooser Escape restores its group trigger and expanded state");
  await page.locator("#scrubber-bookmarks .grouped").click();
  await page.locator("#reader-position").click();
  check(!await page.locator("#bookmark-chooser").isVisible(), "Outside click dismisses bookmark chooser without navigating");
  await page.locator("#bookmark-sample").selectOption("single");
  await page.evaluate(() => { addSampleBookmark(47); syncPageBookmark(); });
  check(await page.locator("#scrubber-bookmarks button").count() === 2 && await page.locator("#scrubber-bookmarks .grouped").count() === 0, "Separated screen positions retain individual direct-navigation flags");
  await page.locator('#scrubber-bookmarks [data-page="43"]').focus();
  await page.setViewportSize({ width: 320, height: 1100 });
  await page.locator("#scrubber-bookmarks .grouped").waitFor();
  check(await page.locator("#scrubber-bookmarks .grouped").evaluate(el => el === document.activeElement), "Narrowing groups flags and preserves keyboard focus");
  await page.keyboard.press("Enter");
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.locator('#scrubber-bookmarks [data-page="43"]').waitFor();
  check(!await page.locator("#bookmark-chooser").isVisible() && await page.locator('#scrubber-bookmarks [data-page="43"]').evaluate(el => el === document.activeElement), "Widening separates flags and safely closes a now-obsolete chooser");
  await page.locator("#bookmark-sample").selectOption("dense");
  for (const width of [1440, 360, 320]) {
    await page.setViewportSize({ width, height: 1100 });
    for (const appearance of ["light", "dark"]) {
      await theme(appearance);
      await page.locator("#scrubber-bookmarks .grouped").click();
      check(await page.locator("#bookmark-choices button").count() === 5 && await page.locator("#all-bookmarks").isVisible() && await page.locator("#bookmark-chooser-title").textContent() === "20 bookmarks", `Dense groups cap the chooser at five entries: ${width}/${appearance}`);
      const bounds = await page.locator("#bookmark-chooser").boundingBox();
      check(bounds.x >= 8 && bounds.x + bounds.width <= width - 8 + 1 && bounds.y >= 8 && bounds.y + bounds.height <= 1092 && bounds.height <= 360, `Dense chooser fits the viewport: ${width}/${appearance}`);
      const overflowAction = await page.locator("#all-bookmarks").boundingBox();
      check(overflowAction.y >= bounds.y && overflowAction.y + overflowAction.height <= bounds.y + bounds.height - 8, `Show all bookmarks remains visible without scrolling the popup: ${width}/${appearance}`);
      check(await page.locator("#scrubber-bookmarks").evaluate(el => el.offsetHeight === 24) && (await page.locator(".reader-footer").boundingBox()).height <= (width >= 620 ? 86 : 106), "Dense bookmarks never increase footer height");
      const filename = `bookmark-group-${width}-${appearance}.png`;
      await page.locator("#bookmark-chooser").screenshot({ path: `${directory}${filename}` });
      report.screenshots.push(filename);
      await page.keyboard.press("Escape");
    }
  }
  await page.locator("#scrubber-bookmarks .grouped").click();
  await page.locator("#all-bookmarks").click();
  check(await page.locator("#notes-content").isVisible() && await page.locator("#annotation-filter").inputValue() === "bookmarks" && await page.locator("#annotation-filter").evaluate(el => el === document.activeElement) && await page.locator('.annotation[data-kind="bookmarks"]:visible').count() === 20 && !await page.locator("#bookmark-chooser").isVisible(), "Show all opens Annotations filtered to all bookmarks with useful focus");
  await page.locator('.annotation[data-bookmark-page="62"] button').click();
  check((await position.textContent()).startsWith("Page 62 "), "A bookmark beyond the five-item chooser remains navigable through Annotations");
  await page.evaluate(() => {
    bookmarkRows().forEach(row => row.remove());
    for (let number = 1; number <= 120; number++) addSampleBookmark(number);
    syncPageBookmark();
  });
  check(await page.locator("#scrubber-bookmarks .bookmark-count").textContent() === "99+" && (await page.locator("#scrubber-bookmarks .grouped").getAttribute("aria-label")).startsWith("120 bookmarks"), "Extreme density caps the visible badge but keeps the exact accessible count");
  await page.locator("#scrubber-bookmarks .grouped").click();
  check(await page.locator("#bookmark-choices button").count() === 5 && await page.locator("#all-bookmarks").isVisible() && await page.locator("#scrubber-bookmarks").evaluate(el => el.offsetHeight === 24), "Extreme density keeps both row and chooser bounded");
  await page.keyboard.press("Escape");
  await page.locator("#reset-sample").click();
  await page.locator("#annotation-filter").selectOption("all");
  await page.setViewportSize({ width: 1440, height: 1100 });
  await theme("light");

  const touchContext = await browser.newContext({ viewport: { width: 390, height: 1000 }, hasTouch: true, isMobile: true });
  const touchPage = await touchContext.newPage();
  touchPage.on("pageerror", error => errors.push(error.message));
  await touchPage.goto(new URL("../index.html", import.meta.url).href);
  await touchPage.locator('[data-view="reader"]').tap();
  const touchSlider = touchPage.locator("#book-scrubber");
  await touchSlider.scrollIntoViewIfNeeded();
  const touchTrack = await touchSlider.boundingBox();
  const touchClient = await touchContext.newCDPSession(touchPage);
  const touchPoint = fraction => ({ x: touchTrack.x + fraction * touchTrack.width, y: touchTrack.y + 12 });
  await touchClient.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [touchPoint(.28)] });
  await touchClient.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [touchPoint(.7)] });
  check((await touchPage.locator("#reader-position").textContent()).startsWith("Page 45 ") && await touchPage.locator("#scrubber-preview").isVisible(), "Touch dragging previews without prematurely navigating");
  await touchClient.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
  check((await touchPage.locator("#reader-position").textContent()).startsWith("Page 45 ") && !await touchPage.locator("#scrubber-preview").isVisible(), "Touch cancellation restores the current position");
  await touchClient.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [touchPoint(.28)] });
  await touchClient.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [touchPoint(.7)] });
  await touchClient.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  check((await touchPage.locator("#reader-position").textContent()).startsWith("Page 110 ") && await touchPage.locator("#excerpt-harbour").isVisible(), "Touch release navigates to the destination");
  await touchPage.locator('#scrubber-bookmarks [data-page="43"]').tap();
  check((await touchPage.locator("#reader-position").textContent()).startsWith("Page 43 ") && !await touchPage.locator("#scrubber-preview").isVisible(), "Touch bookmark activation navigates directly without activating the slider");
  await touchPage.locator("#bookmark-sample").selectOption("close");
  await touchPage.locator("#scrubber-bookmarks .grouped").tap();
  await touchPage.locator('#bookmark-choices [data-page="45"]').tap();
  check((await touchPage.locator("#reader-position").textContent()).startsWith("Page 45 ") && !await touchPage.locator("#bookmark-chooser").isVisible(), "Touch grouping and choosing a destination works without starting a scrub");
  await touchContext.close();

  await view("popup");
  const sortOptions = ["recent", "oldest", "title", "author"];
  for (const order of sortOptions) {
    await page.locator("#view-popup [data-sort-options]").click();
    await page.locator("#compact-sort").waitFor({ state: "visible" });
    check(await page.locator("#compact-sort input:checked").evaluate(el => el === document.activeElement), "Compact sort opens focused on the current order");
    await page.locator(`#compact-sort input[value="${order}"]`).check();
    // Checking the already-selected radio leaves the dialog open.
    if (await page.locator("#compact-sort").isVisible()) await page.locator('[aria-label="Close sort options"]').click();
    check(await page.locator("#library-sort").inputValue() === order && await page.locator("#view-popup [data-sort-options]").evaluate(el => el === document.activeElement), `Compact ${order} choice synchronizes the shared order and restores trigger focus`);
    const expected = await page.locator("#book-grid [data-open]").evaluateAll(nodes => nodes.map(node => node.dataset.open));
    const actual = await page.locator("#popup-books [data-open]").evaluateAll(nodes => nodes.map(node => node.dataset.open));
    check(actual.join(",") === expected.join(","), `Compact ${order} ordering matches full-library ordering`);
  }
  await page.locator("#popup-search").fill("a");
  const filteredExpected = await page.evaluate(() => sortedBooks("a").map(book => String(book.index)));
  check((await page.locator("#popup-books [data-open]").evaluateAll(nodes => nodes.map(node => node.dataset.open))).join(",") === filteredExpected.join(","), "Compact search preserves the selected sort");
  await page.locator("#popup-search").fill("");
  for (const width of [360, 320]) {
    await page.locator(`[data-width="${width}"]`).click();
    await page.locator("#view-popup [data-sort-options]").click();
    await page.locator("#compact-sort").waitFor({ state: "visible" });
    const controls = await page.locator("#popup-wrap .compact-library-tools").boundingBox();
    const search = await page.locator("#popup-search").boundingBox();
    const sort = await page.locator("#view-popup [data-sort-options]").boundingBox();
    check(search.width >= 100 && sort.x >= search.x + search.width && sort.x + sort.width <= controls.x + controls.width + 1, `Compact search and sort fit together at ${width}px`);
    const filename = `compact-sort-${width}.png`;
    await page.screenshot({ path: `${directory}${filename}` });
    report.screenshots.push(filename);
    await page.locator('[aria-label="Close sort options"]').click();
  }
  await page.locator('[data-width="360"]').click();
  await view("reader");
  await page.locator("#reader-library").click();
  await page.locator("#reader-library-content [data-sort-options]").click();
  await page.locator("#compact-sort").waitFor({ state: "visible" });
  await page.locator('#compact-sort input[value="recent"]').check();
  check(await page.locator("#library-sort").inputValue() === "recent" && (await page.locator("#panel-books [data-open]").evaluateAll(nodes => nodes.map(node => node.dataset.open))).join(",") === (await page.locator("#popup-books [data-open]").evaluateAll(nodes => nodes.map(node => node.dataset.open))).join(","), "In-reader library exposes the same working shared sort");
  await page.locator("#notes-toggle").click();

  for (const palette of palettes) {
    await page.locator("#interface-theme").selectOption(palette);
  for (const color of ["light", "dark"]) {
    await theme(color);
    const pairs = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      const value = name => style.getPropertyValue(`--${name}`).trim();
      const luminance = hex => {
        const rgb = hex.replace("#", "").match(/../g).map(c => parseInt(c, 16) / 255)
          .map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
        return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
      };
      const ratio = (a, b) => {
        const x = luminance(value(a)), y = luminance(value(b));
        return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
      };
      return [
        ...[["ink", "surface"], ["muted", "surface"], ["muted", "canvas"], ["muted", "inset"],
          ["accent", "surface"], ["accent", "selected"], ["on-accent", "accent-fill"]].map(([a, b]) => ({ pair: `${a}/${b}`, ratio: ratio(a, b), minimum: 4.5 })),
        ...[["control-line", "surface"], ["focus", "surface"], ["focus", "selected"], ["focus", "canvas"], ["focus", "inset"], ["accent", "surface"]]
          .map(([a, b]) => ({ pair: `${a}/${b}`, ratio: ratio(a, b), minimum: 3 })),
      ];
    });
    for (const pair of pairs) assert.ok(pair.ratio >= pair.minimum, `${palette}/${color}: ${pair.pair} = ${pair.ratio}`);
    report.contrast.push({ palette, appearance: color, pairs });
    if (palette !== "ambra") continue;
    for (const name of ["library", "reader", "popup"]) {
      await view(name);
      await page.mouse.move(0, 0);
      const filename = `${name}-${color}.png`;
      const selector = name === "popup" ? "#popup-wrap .frame" : `#view-${name} .frame`;
      await page.locator(selector).screenshot({ path: `${directory}${filename}` });
      report.screenshots.push(filename);
    }
    }
  }
  await page.locator("#interface-theme").selectOption("ambra");
  await theme("light");
  await view("library");
  for (const width of [1440, 800, 360, 320]) {
    await page.setViewportSize({ width, height: 1100 });
    await page.locator('[data-details="1"]').click();
    check(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `Book details fits ${width}px`);
    if (width === 1440) {
      await page.locator("#view-library .frame").screenshot({ path: `${directory}library-book-details.png` });
      report.screenshots.push("library-book-details.png");
    }
    await page.locator("#close-book-details").click();
  }
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.locator("#find-books").click();
  await page.locator("#discovery-dialog").screenshot({ path: `${directory}find-books.png` });
  report.screenshots.push("find-books.png");
  await page.keyboard.press("Escape");
  await page.locator("#sample-count").selectOption("0");
  const findAction = await page.locator("#find-books").elementHandle();
  const compactFindAction = await page.locator("#popup-find-books").elementHandle();
  for (const width of [1440, 900, 620, 360, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const palette of palettes) {
      await page.locator("#interface-theme").selectOption(palette);
      for (const appearance of ["light", "dark"]) {
        await theme(appearance);
        for (const name of ["library", "popup"]) {
          await view(name);
          check(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `Empty layout fits ${width}/${palette}/${appearance}/${name}`);
        }
      }
    }
  }
  await page.locator("#sample-count").selectOption("2");
  check(await findAction.evaluate(el => el.isConnected) && await compactFindAction.evaluate(el => el.isConnected), "Same discovery controls survive empty/populated transition");
  await view("library");
  check(await page.locator("#view-library .storage-summary").isVisible() && !await page.locator("#empty-library-help").isVisible(), "Populated library restores statistics and removes illustration");
  await page.locator("#sample-count").selectOption("0");
  await page.locator("#interface-theme").selectOption("ambra");
  await theme("light");
  await page.setViewportSize({ width: 1440, height: 1100 });
  await view("library");
  await page.locator("#view-library .frame").screenshot({ path: `${directory}library-empty.png` });
  report.screenshots.push("library-empty.png");
  await view("popup");
  await page.locator("#popup-wrap .frame").screenshot({ path: `${directory}popup-empty.png` });
  report.screenshots.push("popup-empty.png");
  await theme("dark");
  await page.locator("#popup-wrap .frame").screenshot({ path: `${directory}popup-empty-dark.png` });
  report.screenshots.push("popup-empty-dark.png");
  await view("library");
  await page.locator("#view-library .frame").screenshot({ path: `${directory}library-empty-dark.png` });
  report.screenshots.push("library-empty-dark.png");
  assert.deepEqual(errors, [], "No browser runtime errors");
  await fs.writeFile(`${directory}verification.json`, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({
    responsiveCases: report.responsive.length,
    interactionChecks: report.interactions.length,
    contrastPairs: report.contrast.reduce((sum, item) => sum + item.pairs.length, 0),
    screenshots: report.screenshots,
    browserErrors: errors,
  }, null, 2));
} finally {
  await browser.close();
}
