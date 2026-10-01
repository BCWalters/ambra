import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadVerifiedArtifact } from "../../.github/scripts/upload-draft.mjs";

const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const assets = path.join(root, "store-assets");
const generated = path.join(assets, ".generated");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

const annotationGroups = [
  { chapter: "Down the Rabbit-Hole", bookmark: true, notes: [
    ["what is the use of a book", "Yellow", "Alice begins by asking what makes a book worth reading: pictures, conversation, and an invitation to imagine."],
    ["burning with curiosity", "Green", "Curiosity turns a quiet afternoon into a journey. Watch how often it overcomes Alice's hesitation."],
    ["rabbit-hole under the hedge", "Blue", "The hedge marks the threshold between the familiar garden and a world with unfamiliar rules."],
  ] },
  { chapter: "The Pool of Tears", notes: [
    ["Curiouser and curiouser", "Pink", "Even Alice's language changes as her body changes. Ordinary grammar no longer seems quite sufficient."],
    ["Who in the world am I", "Yellow", "The question of identity returns throughout the story, well before the Caterpillar asks it aloud."],
  ] },
  { chapter: "A Caucus-Race and a Long Tale", bookmark: true, notes: [
    ["everybody has won", "Green", "The race makes a playful puzzle out of rules and fairness: a competition with no clear finish or loser."],
  ] },
  { chapter: "The Rabbit Sends in a Little Bill", notes: [
    ["It was much pleasanter at home", "Blue", "Alice misses the security of home, yet the wish to understand Wonderland keeps her moving forward."],
  ] },
  { chapter: "Advice from a Caterpillar", bookmark: true, notes: [
    ["looked at each other for some time in silence", "Yellow", "A patient silence opens the encounter. Neither character accepts the other's assumptions without question."],
    ["Who are you?", "Green", "A simple question becomes the chapter's central puzzle: how can Alice describe herself while everything keeps changing?"],
    ["at least I know who I was", "Blue", "Alice uses memory as an anchor for identity, contrasting the person she remembers with the changes she is experiencing."],
  ] },
];

async function quoteOnPage(reader, quote, select) {
  return reader.evaluate(({ quote, select }) => {
    for (const frame of document.querySelectorAll("iframe")) {
      const frameBox = frame.getBoundingClientRect();
      if (frameBox.width <= 0 || frameBox.height <= 0 || frameBox.left < 0 || frameBox.right > innerWidth ||
          getComputedStyle(frame).visibility !== "visible") continue;
      const doc = frame.contentDocument;
      if (!doc?.body) continue;
      for (const paragraph of doc.querySelectorAll("p")) {
        const walker = doc.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
        const positions = [];
        let text = "";
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          for (let offset = 0; offset < node.textContent.length; offset++) {
            const character = node.textContent[offset];
            const space = /\s/.test(character);
            if (space && (!text || text.endsWith(" "))) continue;
            text += space ? " " : character;
            positions.push({ node, offset });
          }
        }
        const start = text.toLowerCase().indexOf(quote.toLowerCase());
        if (start < 0) continue;
        const first = positions[start];
        const last = positions[start + quote.length - 1];
        const range = doc.createRange();
        range.setStart(first.node, first.offset);
        range.setEnd(last.node, last.offset + 1);
        const rects = [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0);
        if (!rects.length || rects.some((rect) =>
          rect.top + frameBox.top < 56 || rect.bottom + frameBox.top > innerHeight - 56 ||
          rect.left < 0 || rect.right > frameBox.width)) continue;
        if (select) {
          frame.focus();
          const selection = doc.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
          doc.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
        }
        return true;
      }
    }
    return false;
  }, { quote, select });
}

async function candidateFiles(directory) {
  const files = [];
  async function walk(relative = "") {
    for (const entry of (
      await fs.readdir(path.join(directory, relative), { withFileTypes: true })
    ).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(relative, entry.name);
      if (entry.isSymbolicLink()) throw new Error("Candidate cannot contain symlinks.");
      if (entry.isDirectory()) await walk(file);
      else files.push(file);
    }
  }
  await walk();
  return files;
}

async function treeDigest(directory) {
  const hash = createHash("sha256");
  for (const file of await candidateFiles(directory)) {
    hash.update(file).update(await fs.readFile(path.join(directory, file)));
  }
  return hash.digest("hex");
}

export async function captureOutputDirectory(releaseCapture, rootDirectory = root) {
  const relative = releaseCapture
    ? "dist/beta-release/artifacts/store-assets"
    : "store-assets/.generated/previews";
  let current = rootDirectory;
  for (const segment of relative.split("/")) {
    current = path.join(current, segment);
    try {
      const stat = await fs.lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new Error("Capture output must use real project-local directories, not symlinks.");
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await fs.mkdir(current);
    }
  }
  return current;
}

export async function promoteCapture(capture, releaseCapture, rootDirectory = root) {
  const names = await fs.readdir(capture);
  const allowed =
    /^(?:screenshot-(?:library|reader|annotations|inspector|shortcuts)-1280x800\.png|icon-store-128\.png|promo-tile-440x280\.png|asset-provenance\.json)$/;
  for (const name of names) {
    if (!allowed.test(name) || !(await fs.lstat(path.join(capture, name))).isFile()) {
      throw new Error(
        "Only store images and asset-provenance.json may be promoted; package metadata is protected.",
      );
    }
  }
  const output = await captureOutputDirectory(releaseCapture, rootDirectory);
  for (const name of names) {
    try {
      const stat = await fs.lstat(path.join(output, name));
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error("Refusing a redirected capture output file.");
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  for (const name of names) {
    await fs.rename(path.join(capture, name), path.join(output, name));
  }
  return output;
}

async function verifyPackagedCandidate(extension, sourceCommit) {
  const { metadata } = await loadVerifiedArtifact(sourceCommit, "PUBLIC");
  const archive = path.join(root, "dist/beta-release/artifacts", metadata.archive);
  const names = execFileSync("unzip", ["-Z1", archive], { encoding: "utf8" }).trim().split(/\r?\n/);
  const files = await candidateFiles(extension);
  if (JSON.stringify(names.toSorted()) !== JSON.stringify(files.toSorted())) {
    throw new Error("Capture candidate files differ from the verified release ZIP.");
  }
  for (const name of names) {
    const packaged = execFileSync("unzip", ["-p", archive, name], { maxBuffer: 16 * 1024 * 1024 });
    if (!packaged.equals(await fs.readFile(path.join(extension, name)))) {
      throw new Error("Capture candidate bytes differ from the verified release ZIP.");
    }
  }
  return { archive: metadata.archive, sha256: metadata.sha256 };
}

async function main() {
  if (process.env.AMBRA_STORE_ALLOW_BROWSER !== "1") {
    throw new Error(
      "Browser capture is gated. Obtain the browser slot, then set AMBRA_STORE_ALLOW_BROWSER=1.",
    );
  }
  if (!process.env.AMBRA_STORE_EXTENSION_PATH) {
    throw new Error(
      "Set AMBRA_STORE_EXTENSION_PATH to the already-built isolated production candidate.",
    );
  }
  const extension = await fs.realpath(path.resolve(process.env.AMBRA_STORE_EXTENSION_PATH));
  const live = path.join(root, "apps/extension/dist");
  if (
    !extension.startsWith(`${root}${path.sep}`) ||
    extension === live ||
    extension.startsWith(`${live}${path.sep}`)
  ) {
    throw new Error("Use a project-local isolated candidate, never apps/extension/dist.");
  }
  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  const sourceBranch = execFileSync("git", ["branch", "--show-current"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  const sourceDirty =
    execFileSync(
      "git",
      [
        "status",
        "--porcelain",
        "--",
        "apps/extension",
        "packages",
        "package.json",
        "pnpm-lock.yaml",
        "pnpm-workspace.yaml",
        "tsconfig.base.json",
      ],
      { cwd: root, encoding: "utf8" },
    ).trim().length > 0;
  const releaseCapture = process.env.AMBRA_STORE_RELEASE_CAPTURE === "1";
  const worktreeDirty =
    execFileSync("git", ["status", "--porcelain"], {
      cwd: root,
      encoding: "utf8",
    }).trim().length > 0;
  if (
    releaseCapture &&
    (sourceDirty ||
      worktreeDirty ||
      sourceBranch !== "main" ||
      process.env.AMBRA_STORE_SOURCE_SHA !== sourceCommit)
  ) {
    throw new Error(
      "Release captures require main, a clean worktree, and AMBRA_STORE_SOURCE_SHA matching HEAD.",
    );
  }
  const manifest = JSON.parse(await fs.readFile(path.join(extension, "manifest.json"), "utf8"));
  if (manifest.manifest_version !== 3 || JSON.stringify(manifest).includes("localhost")) {
    throw new Error("Candidate must be a self-contained MV3 production build.");
  }
  const before = await treeDigest(extension);
  const releasePackage = releaseCapture
    ? await verifyPackagedCandidate(extension, sourceCommit)
    : null;
  await captureOutputDirectory(releaseCapture);
  const books = JSON.parse(await fs.readFile(path.join(generated, "books.json"), "utf8"));
  const alice = books.find((book) => book.file === "alice-in-wonderland.epub");
  if (books.length < 15 || books.filter((book) => book.language === "fr").length < 3 || !alice?.readerChapter) {
    throw new Error("Prepare the pinned classic reading copies with prepare-assets.py --classics.");
  }
  const bookPaths = await Promise.all(books.map(async (book) => {
    if (!/^[a-z-]+\.epub$/.test(book.file)) throw new Error("Unexpected demonstration book path.");
    const file = path.join(generated, book.file);
    if (digest(await fs.readFile(file)) !== book.sha256) throw new Error(`Prepared book changed: ${book.file}`);
    return file;
  }));
  const require = createRequire(path.join(root, "apps/e2e/package.json"));
  const { chromium, expect } = require("@playwright/test");
  const profile = path.join(generated, `profile-${process.pid}`);
  const capture = path.join(generated, `capture-${process.pid}`);
  await fs.mkdir(profile);
  await fs.mkdir(capture);
  const screenshots = [];
  const observations = {};
  let context;
  let captured = false;
  async function screenshot(page, name) {
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(capture, name), animations: "disabled" });
    screenshots.push(name);
  }
  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: "chromium",
      headless: true,
      viewport: { width: 1280, height: 800 },
      colorScheme: "light",
      reducedMotion: "reduce",
      locale: "en-US",
      ignoreDefaultArgs: ["--hide-scrollbars"],
      args: [
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
        "--disable-background-networking",
      ],
    });
    await context.setOffline(true);
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 15_000 });
    const id = new URL(worker.url()).host;
    const library = await context.newPage();
    await library.goto(`chrome-extension://${id}/src/library/index.html?view=tab`);
    const input = library.locator('input[type="file"]').first();
    await expect(input).toBeEnabled();
    await input.setInputFiles(bookPaths);
    await expect(library.getByRole("button", { name: /^Open / })).toHaveCount(books.length, {
      timeout: 120_000,
    });
    await library.getByRole("button", { name: "Sort library" }).click();
    await library.getByRole("menuitemradio", { name: "Title (A–Z)" }).click();
    const dismissImport = library.getByRole("button", { name: "Dismiss", exact: true });
    if (await dismissImport.isVisible()) await dismissImport.click();
    const opened = context.waitForEvent("page");
    await library.getByRole("button", { name: /^Open Alice's Adventures in Wonderland/ }).click();
    const reader = await opened;
    await reader.waitForLoadState("domcontentloaded");
    const welcome = reader.getByRole("dialog", { name: "Make yourself at home", exact: true });
    await expect(welcome).toBeVisible({ timeout: 20_000 });
    await welcome.getByRole("button", { name: "Start reading", exact: true }).click();
    await expect(welcome).toBeHidden();
    const position = reader.getByRole("slider", { name: "Position in book", includeHidden: true });
    async function mapped() {
      let last = "";
      let since = Date.now();
      await expect.poll(async () => {
        const value = await position.getAttribute("aria-valuetext");
        if (!/^Page \d+ of \d+/.test(value ?? "") || value !== last) since = Date.now();
        last = value;
        return Date.now() - since >= 1_000;
      }, { timeout: 120_000, intervals: [100] }).toBe(true);
      await expect(reader.getByRole("progressbar")).toHaveCount(0);
    }
    async function openChapter(chapter) {
      await reader.mouse.move(6, 2);
      await reader.getByRole("button", { name: "Show contents", exact: true }).click();
      const contents = reader.getByRole("navigation", { name: "Table of contents" });
      await contents.getByRole("button", { name: new RegExp(chapter) }).click();
      await expect(contents).toBeHidden();
      await mapped();
      await expect.poll(() => reader.evaluate((chapter) =>
        [...document.querySelectorAll("iframe")].some((frame) => {
          const box = frame.getBoundingClientRect();
          if (box.width <= 0 || box.left < 0 || box.right > innerWidth ||
              getComputedStyle(frame).visibility !== "visible") return false;
          return [...(frame.contentDocument?.querySelectorAll("h2") ?? [])].some((heading) =>
            heading.textContent.replace(/\s+/g, " ").includes(chapter));
        }), chapter), { timeout: 20_000 }).toBe(true);
    }
    const popup = reader.getByRole("dialog", { name: "Highlight options" });
    for (const group of annotationGroups) {
      console.log(`Annotating ${group.chapter}`);
      await openChapter(group.chapter);
      if (group.bookmark) await reader.getByRole("button", { name: "Bookmark this page", exact: true }).click();
      for (const [quote, color, note] of group.notes) {
        console.log(`  Adding note: ${quote}`);
        let visible = false;
        for (let turn = 0; turn < 20; turn++) {
          if (await quoteOnPage(reader, quote, true)) { visible = true; break; }
          const previous = await position.getAttribute("aria-valuetext");
          await reader.keyboard.press("ArrowRight");
          await expect(position).not.toHaveAttribute("aria-valuetext", previous);
        }
        if (!visible) throw new Error(`Capture quote was not visible: ${quote}`);
        await reader.getByRole("toolbar", { name: "Highlight this selection" })
          .getByRole("button", { name: "Add note", exact: true }).click();
        await expect(popup).toBeVisible();
        await popup.getByRole("radio", { name: color, exact: true }).click();
        await popup.getByRole("textbox", { name: "Add a note…", exact: true }).fill(note);
        await popup.getByRole("button", { name: "Save", exact: true }).click();
        await expect(popup).toBeHidden();
      }
    }
    await openChapter("Advice from a Caterpillar");
    async function readerObservation(name, requireImage = false) {
      await mapped();
      const percent = Number(await position.getAttribute("aria-valuenow"));
      if (percent < 15 || percent > 85) throw new Error(`Unrepresentative progress in ${name}: ${percent}`);
      const notes = reader.getByRole("button", { name: "This highlight has a note", exact: true });
      const visibleNotes = await notes.evaluateAll((nodes) => nodes.filter((node) => {
        const box = node.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && box.top >= 0 && box.bottom <= innerHeight &&
          box.left >= 0 && box.right <= innerWidth;
      }).length);
      if (visibleNotes < 3) throw new Error(`Expected three visible annotations in ${name}, got ${visibleNotes}`);
      const imageVisible = () => reader.evaluate(() =>
        [...document.querySelectorAll("iframe")].some((frame) => {
          const box = frame.getBoundingClientRect();
          const image = frame.contentDocument?.querySelector("#ambra-tenniel-caterpillar img");
          if (!image?.complete || image.naturalWidth <= 0 || box.width <= 0 ||
              getComputedStyle(frame).visibility !== "visible") return false;
          const bounds = image.getBoundingClientRect();
          return bounds.width > 0 && bounds.height > 0 && bounds.top + box.top >= 56 &&
            bounds.bottom + box.top < innerHeight - 56 && bounds.left + box.left >= 0 &&
            bounds.right + box.left <= innerWidth;
        }));
      if (requireImage) await expect.poll(imageVisible).toBe(true);
      const illustrated = await imageVisible();
      observations[name] = { position: await position.getAttribute("aria-valuetext"), percent, visibleNotes, illustrated };
      await reader.mouse.move(6, 2);
      await expect(reader.getByRole("tooltip")).toHaveCount(0);
    }
    await readerObservation("reader", true);
    await screenshot(reader, "screenshot-reader-1280x800.png");

    await reader.getByRole("button", { name: "Bookmarks and highlights", exact: true }).click();
    const notesPanel = reader.getByRole("navigation", { name: "Bookmarks and highlights" });
    await notesPanel.getByRole("tab", { name: /Highlights/ }).click();
    await notesPanel.getByRole("button", { name: "Pin bookmarks and highlights panel", exact: true }).click();
    await expect(notesPanel.getByRole("button", { name: /^Edit note:/ })).toHaveCount(10);
    await expect.poll(() => notesPanel.evaluate((node) => [node, ...node.querySelectorAll("*")].some((element) =>
      element.scrollHeight > element.clientHeight + 20 && ["auto", "scroll"].includes(getComputedStyle(element).overflowY))))
      .toBe(true);
    await readerObservation("annotations");
    await reader.getByRole("button", { name: "This highlight has a note", exact: true }).first().click();
    const note = await popup.getByRole("textbox", { name: "Add a note…", exact: true }).inputValue();
    if (!annotationGroups.flatMap((group) => group.notes).some((entry) => entry[2] === note)) {
      throw new Error("Annotation popup does not show a saved, meaningful capture note.");
    }
    observations.annotations = { ...observations.annotations, savedNote: note, panelOverflow: true, annotationCount: 10 };
    await reader.mouse.move(6, 2);
    await screenshot(reader, "screenshot-annotations-1280x800.png");
    await reader.keyboard.press("Escape");
    await reader.getByRole("button", { name: "Hide bookmarks and highlights", exact: true }).click();
    await expect(notesPanel).toBeHidden();

    await mapped();
    await reader.mouse.move(6, 2);
    await reader.getByRole("button", { name: "Book details", exact: true }).click();
    await reader.getByRole("button", { name: "EPUB Inspector", exact: true }).click();
    const inspector = reader.getByRole("dialog", { name: "EPUB Inspector", exact: true });
    await expect(inspector).toBeVisible();
    await inspector.getByRole("button", { name: "Dock right", exact: true }).click();
    await expect(inspector).toHaveAttribute("data-inspector-view", "dock-right");
    await inspector.locator(`button[data-file-path="${alice.readerChapter}"]`).click();
    await expect(inspector.locator("pre.ambra-hljs")).toContainText("Advice from a Caterpillar");
    await inspector.getByRole("button", { name: "Locate current passage", exact: true }).click();
    await expect.poll(() => reader.evaluate(() =>
      [...(CSS.highlights.get("ambra-inspector-source") ?? [])].some((range) => {
        const bounds = range.getBoundingClientRect();
        return bounds.width > 0 && bounds.top >= 0 && bounds.bottom <= innerHeight;
      }))).toBe(true);
    await mapped();
    observations.inspector = {
      position: await position.getAttribute("aria-valuetext"), dock: "right",
      file: alice.readerChapter, locatedCurrentPassage: true,
    };
    await reader.mouse.move(6, 2);
    await expect(reader.getByRole("tooltip")).toHaveCount(0);
    await screenshot(reader, "screenshot-inspector-1280x800.png");
    await inspector.getByRole("button", { name: "Close EPUB Inspector", exact: true }).click();
    await reader.keyboard.press("Escape");

    await mapped();
    await reader.mouse.move(6, 2);
    await reader.getByRole("button", { name: "Settings", exact: true }).click();
    await reader.getByRole("menuitem", { name: "Help & About", exact: true }).click();
    await reader.getByRole("button", { name: "Show keyboard shortcuts", exact: true }).click();
    await expect(
      reader.getByRole("dialog", { name: "Keyboard shortcuts", exact: true }),
    ).toBeVisible();
    await mapped();
    observations.shortcuts = { position: await position.getAttribute("aria-valuetext") };
    await screenshot(reader, "screenshot-shortcuts-1280x800.png");

    await library.reload();
    const covers = library.getByRole("button", { name: /^Open / });
    await expect(covers).toHaveCount(books.length);
    await expect.poll(() => covers.evaluateAll((nodes) => {
      return nodes.filter((node) => !getComputedStyle(node).backgroundImage.startsWith('url("'))
        .map((node) => node.getAttribute("aria-label"));
    }), { timeout: 20_000 }).toEqual([]);
    await covers.evaluateAll((nodes) => Promise.all(nodes.map(async (node) => {
      const background = getComputedStyle(node).backgroundImage;
      if (!background.startsWith('url("')) throw new Error("A prepared classic cover is missing.");
      const image = new Image();
      image.src = background.slice(5, -2);
      await image.decode();
    })));
    observations.library = { books: books.length, frenchEditions: books.filter((book) => book.language === "fr").length };
    await library.mouse.move(6, 2);
    await screenshot(library, "screenshot-library-1280x800.png");
    captured = true;
  } catch (error) {
    const page = context?.pages().at(-1);
    if (page) {
      await page.screenshot({ path: path.join(generated, "capture-failure.png") })
        .catch((diagnosticError) => console.error("Could not save capture diagnostics:", diagnosticError));
    }
    throw error;
  } finally {
    await context?.close();
    await fs.rm(profile, { recursive: true, force: true });
    if (!captured) await fs.rm(capture, { recursive: true, force: true });
  }
  if ((await treeDigest(extension)) !== before)
    throw new Error("Candidate changed during capture; do not use these images.");
  if (
    releaseCapture &&
    JSON.stringify(await verifyPackagedCandidate(extension, sourceCommit)) !==
      JSON.stringify(releasePackage)
  ) {
    throw new Error("Release package changed during capture; do not use these images.");
  }
  const hashes = {};
  for (const name of screenshots) {
    const bytes = await fs.readFile(path.join(capture, name));
    if (bytes.readUInt32BE(16) !== 1280 || bytes.readUInt32BE(20) !== 800) {
      throw new Error("Unexpected screenshot dimensions.");
    }
    hashes[name] = digest(bytes);
  }
  for (const name of ["icon-store-128.png", "promo-tile-440x280.png"]) {
    const bytes = await fs.readFile(path.join(assets, name));
    hashes[name] = digest(bytes);
    await fs.writeFile(path.join(capture, name), bytes);
  }
  await fs.writeFile(
    path.join(capture, "asset-provenance.json"),
    `${JSON.stringify(
      {
        sourceCommit,
        sourceBranch,
        sourceDirty,
        worktreeDirty,
        capturePurpose: releaseCapture ? "release" : "preview",
        releaseReadiness: releaseCapture
          ? "Clean-main capture; final owner review still required."
          : "Pre-release preview only; rebuild and recapture clean main before submission.",
        candidatePath: path.relative(root, extension),
        candidateTreeSha256: before,
        releasePackage,
        version: manifest.version,
        capturedAt: new Date().toISOString(),
        browser: "Playwright Chromium",
        viewport: { width: 1280, height: 800 },
        publicationContent:
          "Checksum-pinned Project Gutenberg classics (public domain in the USA), original Ambra covers, and a credited custom combination of Carroll text and Tenniel art. No personal library; capture runs offline.",
        publications: books,
        observations,
        uploadOrder: ["reader", "library", "inspector", "annotations", "shortcuts"],
        sourceAttestation: releaseCapture
          ? "Captured candidate matched every file in the clean-commit, checksum-verified release ZIP."
          : "Preview tree hash records captured bytes; not an independent build attestation.",
        files: hashes,
      },
      null,
      2,
    )}\n`,
  );
  const output = await promoteCapture(capture, releaseCapture);
  await fs.rm(capture, { recursive: true, force: true });
  console.log(
    `Captured ${screenshots.length} classic-book screenshots (${releaseCapture ? "release" : "preview"}) in ${path.relative(root, output)}. No package/upload/publication performed.`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
