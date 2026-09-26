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
  const { metadata } = await loadVerifiedArtifact(sourceCommit);
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
  const bookPaths = books.map((book) => {
    if (!/^[a-z-]+\.epub$/.test(book.file)) throw new Error("Unexpected demonstration book path.");
    return path.join(generated, book.file);
  });
  const require = createRequire(path.join(root, "apps/e2e/package.json"));
  const { chromium, expect } = require("@playwright/test");
  const profile = path.join(generated, `profile-${process.pid}`);
  const capture = path.join(generated, `capture-${process.pid}`);
  await fs.mkdir(profile);
  await fs.mkdir(capture);
  const screenshots = [];
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
    await expect(library.getByRole("button", { name: /^Open / })).toHaveCount(3, {
      timeout: 20_000,
    });
    await library.getByRole("button", { name: "Sort library" }).click();
    await library.getByRole("menuitemradio", { name: "Title (A–Z)" }).click();
    const dismissImport = library.getByRole("button", { name: "Dismiss", exact: true });
    if (await dismissImport.isVisible()) await dismissImport.click();
    await library.getByRole("button", { name: /^Open The Quiet Observatory/ }).hover();
    await library
      .getByRole("button", { name: "The Quiet Observatory details", exact: true })
      .click();
    const libraryDetails = library.getByRole("dialog", { name: "Book details", exact: true });
    await expect(libraryDetails).toBeVisible();
    await library.mouse.move(640, 20);
    await screenshot(library, "screenshot-library-1280x800.png");
    await libraryDetails.getByRole("button", { name: "Close", exact: true }).click();
    await expect(libraryDetails).toBeHidden();

    const opened = context.waitForEvent("page");
    await library.getByRole("button", { name: /^Open The Quiet Observatory/ }).click();
    const reader = await opened;
    await reader.waitForLoadState("domcontentloaded");
    const welcome = reader.getByRole("dialog", { name: "Make yourself at home", exact: true });
    await expect(welcome).toBeVisible({ timeout: 20_000 });
    await welcome.getByRole("button", { name: "Start reading", exact: true }).click();
    await expect(welcome).toBeHidden();
    const position = reader.getByRole("slider", { name: "Position in book" });
    await expect(position).toHaveAttribute("aria-valuetext", /^Page \d+ of \d+/, {
      timeout: 20_000,
    });
    await reader.mouse.move(640, 20);
    await screenshot(reader, "screenshot-reader-1280x800.png");

    // Select only original demo text, then use the genuine annotation controls.
    await reader.evaluate(() => {
      const frames = [...document.querySelectorAll("iframe")];
      const doc = frames
        .map((frame) => frame.contentDocument)
        .find((doc) => doc?.getElementById("passage-1"));
      const text = doc?.getElementById("passage-1")?.firstChild;
      if (!text) throw new Error("Original sample paragraph is not visible.");
      const range = doc.createRange();
      range.setStart(text, 0);
      range.setEnd(text, Math.min(91, text.textContent.length));
      const selection = doc.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      doc.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    });
    await reader.getByRole("button", { name: "Yellow", exact: true }).click();
    await reader.mouse.move(640, 20);
    await reader.getByRole("button", { name: "Bookmark this page", exact: true }).click();
    await reader.getByRole("button", { name: "Bookmarks and highlights", exact: true }).click();
    await reader.getByRole("tab", { name: /Highlights/ }).click();
    await reader.getByRole("button", { name: /^Add note:/ }).click();
    const note =
      "A small act of care, repeated each spring. Notice how the green door brings the village together.";
    await reader.getByRole("textbox", { name: "Add a note…", exact: true }).fill(note);
    await reader.getByRole("button", { name: "Save", exact: true }).click();
    await expect(reader.getByText(note, { exact: true })).toBeVisible();
    await expect(reader.getByRole("button", { name: /^Edit note:/ })).toBeVisible();
    await expect(reader.getByRole("button", { name: /^Export/ })).toBeVisible();
    await reader.mouse.move(640, 20);
    await screenshot(reader, "screenshot-annotations-1280x800.png");
    await reader.keyboard.press("Escape");

    await reader.mouse.move(640, 20);
    await reader.getByRole("button", { name: "Book details", exact: true }).click();
    await reader.getByRole("button", { name: "EPUB Inspector", exact: true }).click();
    const inspector = reader.getByRole("dialog", { name: "EPUB Inspector", exact: true });
    await expect(inspector).toBeVisible();
    await inspector.locator('button[data-file-path="EPUB/chapter.xhtml"]').click();
    await screenshot(reader, "screenshot-inspector-1280x800.png");
    await inspector.getByRole("button", { name: "Close EPUB Inspector", exact: true }).click();
    await reader.keyboard.press("Escape");

    await reader.mouse.move(640, 20);
    await reader.getByRole("button", { name: "Settings", exact: true }).click();
    await reader.getByRole("menuitem", { name: "Help & About", exact: true }).click();
    await reader.getByRole("button", { name: "Show keyboard shortcuts", exact: true }).click();
    await expect(
      reader.getByRole("dialog", { name: "Keyboard shortcuts", exact: true }),
    ).toBeVisible();
    await screenshot(reader, "screenshot-shortcuts-1280x800.png");
    captured = true;
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
          "Original MIT-licensed Ambra synthetic demonstration books; no personal library or remote books.",
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
    `Captured ${screenshots.length} original-book screenshots (${releaseCapture ? "release" : "preview"}) in ${path.relative(root, output)}. No package/upload/publication performed.`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
