import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { quoteOnPage, treeDigest } from "../store-assets/scripts/generate-images.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const images = path.join(root, "docs/user-guide/images");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function main() {
  const {
    AMBRA_DOCS_EXTENSION_PATH: candidate,
    AMBRA_DOCS_SOURCE_SHA: sourceCommit,
    AMBRA_DOCS_BOOKS_PATH: booksPath,
    AMBRA_DOCS_WORKSPACE: workspace,
    AMBRA_DOCS_ARCHIVE_PATH: archive,
  } = process.env;
  if (process.env.AMBRA_DOCS_ALLOW_BROWSER !== "1" || !candidate || !booksPath || !workspace ||
      !/^[a-f0-9]{40}$/.test(sourceCommit ?? "")) {
    throw new Error("Docs capture requires browser authorization, an isolated candidate, source SHA, prepared books, and a session workspace.");
  }
  execFileSync("git", ["cat-file", "-e", `${sourceCommit}^{commit}`], { cwd: root });
  const extension = await fs.realpath(candidate);
  if (extension.includes("/apps/extension/dist")) throw new Error("Never capture protected apps/extension/dist.");
  const manifest = JSON.parse(await fs.readFile(path.join(extension, "manifest.json"), "utf8"));
  if (manifest.manifest_version !== 3 || JSON.stringify(manifest).includes("localhost")) {
    throw new Error("Use a self-contained production MV3 candidate.");
  }
  const candidateTreeSha256 = await treeDigest(extension);
  let releasePackage = null;
  if (archive) {
    const files = execFileSync("unzip", ["-Z1", archive], { encoding: "utf8" }).trim().split(/\r?\n/);
    for (const file of files) {
      if (file.startsWith("/") || file.split("/").includes("..") || file.endsWith("/")) {
        throw new Error("Unexpected release ZIP entry.");
      }
      const bytes = execFileSync("unzip", ["-p", archive, file], { maxBuffer: 32 * 1024 * 1024 });
      if (!bytes.equals(await fs.readFile(path.join(extension, file)))) {
        throw new Error(`Release ZIP differs from the captured candidate: ${file}`);
      }
    }
    async function countFiles(directory) {
      let count = 0;
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        count += entry.isDirectory() ? await countFiles(path.join(directory, entry.name)) : 1;
      }
      return count;
    }
    if (files.length !== await countFiles(extension)) throw new Error("Candidate has files outside the release ZIP.");
    releasePackage = { archive: path.basename(archive), sha256: sha256(await fs.readFile(archive)) };
  }
  const books = JSON.parse(await fs.readFile(path.join(booksPath, "books.json"), "utf8"));
  const alice = books.find((book) => book.file === "alice-in-wonderland.epub");
  if (!alice?.readerChapter) throw new Error("Use the existing checksum-pinned classic fixture preparation.");
  const alicePath = path.join(booksPath, alice.file);
  if (sha256(await fs.readFile(alicePath)) !== alice.sha256) throw new Error("Alice fixture checksum changed.");
  const narrated = path.join(root, "apps/e2e/fixtures/media-overlay/narrated.epub");
  const require = createRequire(process.env.AMBRA_DOCS_PLAYWRIGHT_PACKAGE ?? path.join(root, "apps/e2e/package.json"));
  const { chromium, expect } = require("@playwright/test");
  const temporary = await fs.mkdtemp(path.join(await fs.realpath(workspace), "docs-capture-"));
  const observations = {};
  const files = {};
  let context;
  async function screenshot(page, name, observation) {
    await page.mouse.move(6, 2);
    await page.evaluate(() => document.fonts.ready);
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    await page.screenshot({ path: path.join(temporary, name), animations: "disabled" });
    const bytes = await fs.readFile(path.join(temporary, name));
    if (bytes.readUInt32BE(16) !== 1280 || bytes.readUInt32BE(20) !== 800) throw new Error("Incorrect screenshot dimensions.");
    files[name] = sha256(bytes);
    observations[name] = observation;
  }
  try {
    context = await chromium.launchPersistentContext(path.join(temporary, "profile"), {
      channel: "chromium", headless: true, viewport: { width: 1280, height: 800 },
      colorScheme: "light", reducedMotion: "reduce", locale: "en-US",
      ignoreDefaultArgs: ["--hide-scrollbars"],
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "--disable-background-networking"],
    });
    await context.setOffline(true);
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker", { timeout: 15_000 });
    const library = await context.newPage();
    await library.goto(`chrome-extension://${new URL(worker.url()).host}/src/library/index.html?view=tab`);
    const input = library.locator('input[type="file"]').first();
    await expect(input).toBeEnabled();
    await input.setInputFiles([alicePath, narrated]);
    await expect(library.getByRole("button", { name: /^Open / })).toHaveCount(2, { timeout: 120_000 });
    const dismiss = library.getByRole("button", { name: "Dismiss", exact: true });
    if (await dismiss.isVisible()) await dismiss.click();
    await library.getByRole("button", { name: "Find books", exact: true }).click();
    const discovery = library.getByRole("dialog", { name: "Find books", exact: true });
    await expect(discovery).toBeVisible();
    await expect(discovery.getByRole("link", { name: "ReadBeyond", exact: true })).toBeVisible();
    await screenshot(library, "find-books.png", { dialog: "Find books", populatedLibrary: true });
    await discovery.getByRole("button", { name: "Close", exact: true }).click();
    async function openBook(name, first = false) {
      const [page] = await Promise.all([
        context.waitForEvent("page"),
        library.getByRole("button", { name, exact: true }).click(),
      ]);
      await page.waitForLoadState("domcontentloaded");
      await expect(page.locator("iframe").first()).toBeVisible();
      const welcome = page.getByRole("dialog", { name: "Make yourself at home", exact: true });
      if (first) await expect(welcome).toBeVisible({ timeout: 20_000 });
      if (await welcome.isVisible()) {
        await welcome.getByRole("button", { name: "Start reading", exact: true }).click();
      }
      return page;
    }
    const reader = await openBook("Open Alice's Adventures in Wonderland", true);
    const position = reader.getByRole("slider", { name: "Position in book", includeHidden: true });
    async function mapped(page = reader) {
      const currentPosition = page.getByRole("slider", { name: "Position in book", includeHidden: true });
      let last = "";
      let since = Date.now();
      await expect.poll(async () => {
        const value = await currentPosition.getAttribute("aria-valuetext");
        if (!/^Page \d+ of \d+/.test(value ?? "") || value !== last) since = Date.now();
        last = value;
        return Date.now() - since >= 1_000;
      }, { timeout: 120_000, intervals: [100] }).toBe(true);
      await expect(page.getByRole("progressbar")).toHaveCount(0);
    }
    await reader.mouse.move(6, 2);
    await reader.getByRole("button", { name: "Contents", exact: true }).click();
    await reader.getByRole("navigation", { name: "Table of contents" })
      .getByRole("button", { name: /Advice from a Caterpillar/ }).click();
    await mapped();
    await reader.getByRole("button", { name: "Bookmark this page", exact: true }).click();
    const quote = "Who are you?";
    for (let turn = 0; !(await quoteOnPage(reader, quote, true)); turn++) {
      if (turn >= 20) throw new Error("The screenshot's quoted passage is not visible.");
      const previous = await position.getAttribute("aria-valuetext");
      await reader.keyboard.press("ArrowRight");
      await expect(position).not.toHaveAttribute("aria-valuetext", previous);
    }
    await reader.getByRole("toolbar", { name: "Highlight this selection" })
      .getByRole("button", { name: "Add note", exact: true }).click();
    const popup = reader.getByRole("dialog", { name: "Highlight options" });
    await expect(popup).toBeVisible();
    await popup.getByRole("radio", { name: "Yellow", exact: true }).click();
    await popup.getByRole("textbox", { name: "Add a note…", exact: true })
      .fill("A simple question becomes a puzzle: how can Alice describe herself while everything keeps changing?");
    await popup.getByRole("button", { name: "Save", exact: true }).click();
    await expect(popup).toBeHidden();
    await mapped();
    await screenshot(reader, "reading-alice.png", { position: await position.getAttribute("aria-valuetext"), savedHighlight: quote });
    await reader.getByRole("button", { name: "Annotations", exact: true }).click();
    const annotations = reader.getByRole("navigation", { name: "Annotations", exact: true });
    await annotations.getByRole("combobox", { name: "Show", exact: true }).selectOption("notes");
    await expect(annotations.getByRole("button", { name: /^Edit note:/ })).toHaveCount(1);
    await expect(annotations).toContainText("A simple question becomes a puzzle");
    await screenshot(reader, "annotations.png", { panel: "Annotations", filter: "Notes", savedNotes: 1 });
    await reader.getByRole("button", { name: "Hide annotations", exact: true }).click();
    await reader.getByRole("button", { name: "Book details", exact: true }).click();
    await reader.getByRole("button", { name: "EPUB Inspector", exact: true }).click();
    const inspector = reader.getByRole("dialog", { name: "EPUB Inspector", exact: true });
    await expect(inspector).toBeVisible();
    await inspector.locator('button[data-file-path$="alice15a.gif"]').click();
    await expect(inspector.locator("img").last()).toBeVisible();
    await screenshot(reader, "inspector-overview.png", { view: "popover", image: "alice15a.gif" });
    await inspector.getByRole("button", { name: "Dock right", exact: true }).click();
    await expect(inspector).toHaveAttribute("data-inspector-view", "dock-right");
    await inspector.locator(`button[data-file-path="${alice.readerChapter}"]`).click();
    await expect(inspector.locator("pre.ambra-hljs")).toContainText("Advice from a Caterpillar");
    await inspector.getByRole("button", { name: "Locate current passage", exact: true }).click();
    await expect.poll(() => reader.evaluate(() =>
      [...(CSS.highlights.get("ambra-inspector-source") ?? [])].some((range) => {
        const box = range.getBoundingClientRect();
        return box.width > 0 && box.top >= 0 && box.bottom <= innerHeight;
      }))).toBe(true);
    await mapped();
    await screenshot(reader, "inspector-source.png", { dock: "right", file: alice.readerChapter, locatedCurrentPassage: true });
    const narration = await openBook("Open Synthetic narration narrated");
    const controls = narration.getByRole("region", { name: "Narration controls", exact: true });
    await expect(controls).toBeVisible();
    await expect(narration.getByRole("button", { name: "Listen", exact: true })).toHaveCount(0);
    await expect(controls.getByRole("button", { name: "Play narration", exact: true })).toBeVisible();
    if (!await narration.locator("audio[data-ambra-narration-audio]").evaluate((audio) => audio.paused)) {
      throw new Error("Narration unexpectedly started automatically.");
    }
    async function visibleControls(names) {
      for (const name of names) {
        const button = controls.getByRole("button", { name, exact: true });
        await expect(button).toBeVisible();
        const box = await button.boundingBox();
        if (!box || box.x < 0 || box.y < 0 || box.x + box.width > 1280 || box.y + box.height > 800) {
          throw new Error(`Narration control is outside the screenshot: ${name}`);
        }
      }
    }
    await visibleControls([
      "Previous narrated passage", "Play narration", "Next narrated passage",
      "Narration speed: 1×", "Listen from this page", "Collapse read-along controls",
    ]);
    await mapped(narration);
    await screenshot(narration, "read-along.png", { paused: true, toolbarListenButton: false, expanded: true });
    await controls.getByRole("button", { name: "Collapse read-along controls", exact: true }).click();
    await expect(controls.getByRole("button", { name: "Expand read-along controls", exact: true })).toBeVisible();
    await expect(controls.getByRole("button", { name: "Play narration", exact: true })).toBeVisible();
    await mapped(narration);
    await visibleControls(["Play narration", "Expand read-along controls"]);
    await screenshot(narration, "read-along-collapsed.png", { paused: true, expanded: false, playAvailable: true });
    if (candidateTreeSha256 !== await treeDigest(extension)) throw new Error("Candidate changed during capture.");
    if (archive && releasePackage.sha256 !== sha256(await fs.readFile(archive))) {
      throw new Error("Release ZIP changed during capture.");
    }
    const provenance = {
      sourceCommit, capturePurpose: releasePackage ? "packaged-runtime" : "premerge-preview",
      sourceAttestation: releasePackage
        ? "Caller supplied the runtime source commit; every candidate file matched the supplied release ZIP."
        : "Caller supplied the verified pre-merge runtime and source commit; tree hash records captured bytes, not an independent build attestation.",
      releaseStatus: "Capture is not evidence of Chrome Web Store publication.",
      version: manifest.version, candidateTreeSha256, releasePackage,
      capturedAt: new Date().toISOString(), browser: "Playwright Chromium",
      viewport: { width: 1280, height: 800 }, offline: true,
      publications: [alice, { file: "media-overlay/narrated.epub", sha256: sha256(await fs.readFile(narrated)), rights: "Original synthetic Ambra fixture (MIT)." }],
      attribution: "../screenshots.md", observations, files,
    };
    for (const name of Object.keys(files)) await fs.copyFile(path.join(temporary, name), path.join(images, name));
    await fs.writeFile(path.join(images, "provenance.json"), `${JSON.stringify(provenance, null, 2)}\n`);
    console.log(`Captured ${Object.keys(files).length} documentation screenshots (${provenance.capturePurpose}).`);
  } catch (error) {
    const page = context?.pages().at(-1);
    if (page) {
      console.error(await page.locator("body").innerText());
      await page.screenshot({ path: path.join(workspace, "docs-capture-failure.png") });
    }
    throw error;
  } finally {
    await context?.close();
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
