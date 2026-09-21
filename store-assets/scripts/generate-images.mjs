import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = process.cwd();
const storeAssetsDir = path.join(root, 'store-assets');
const extensionPath = path.join(root, 'apps', 'e2e', '.extension-build');
const profileDir = path.join(storeAssetsDir, '.playwright-profile');
const realBooks = [
  path.join(root, 'apps', 'e2e', 'real-books', 'alice-in-wonderland.epub'),
  path.join(root, 'apps', 'e2e', 'real-books', 'childrens-literature.epub'),
  path.join(root, 'apps', 'e2e', 'real-books', 'accessible-epub-3.epub'),
  path.join(root, 'apps', 'e2e', 'real-books', 'internal-links.epub'),
  path.join(root, 'apps', 'e2e', 'real-books', 'israel-sailing.epub'),
];
const iconPath = path.join(root, 'apps', 'extension', 'public', 'icons', 'icon128.png');
const require = createRequire(path.join(root, 'apps', 'e2e', 'package.json'));
const { chromium } = require('@playwright/test');

function ensureExists(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required file: ${filePath}`);
  }
}

async function waitForPageLabel(page) {
  await page.waitForFunction(() => /Page \d+ of \d+/.test(document.body.innerText), { timeout: 20000 });
}

async function buildLibraryAndReaderScreenshots() {
  fs.rmSync(profileDir, { recursive: true, force: true });
  fs.mkdirSync(profileDir, { recursive: true });

  const context = await chromium.launchPersistentContext(profileDir, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 800 },
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  try {
    let [serviceWorker] = context.serviceWorkers();
    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent('serviceworker', { timeout: 15000 });
    }
    const extensionId = serviceWorker.url().split('/')[2];

    const libraryPage = await context.newPage();
    await libraryPage.goto(`chrome-extension://${extensionId}/src/library/index.html?view=tab`);
    await libraryPage.locator('input[type="file"]').waitFor({ state: 'attached', timeout: 15000 });
    await libraryPage.locator('input[type="file"]').setInputFiles(realBooks);
    await libraryPage.getByRole('button', { name: /^Open Alice/i }).waitFor({ timeout: 20000 });
    await libraryPage.locator('button[aria-label^="Open "]').nth(4).waitFor({ timeout: 20000 });
    await libraryPage.getByRole('button', { name: 'Sort library' }).click();
    await libraryPage.getByRole('menuitemradio', { name: 'Title (A–Z)' }).click();
    await libraryPage.waitForTimeout(500);
    await libraryPage.screenshot({ path: path.join(storeAssetsDir, 'screenshot-library-1280x800.png'), animations: 'disabled' });

    const [readerPage] = await Promise.all([
      context.waitForEvent('page'),
      libraryPage.getByRole('button', { name: /^Open Alice/i }).click({ force: true }),
    ]);
    await readerPage.setViewportSize({ width: 1280, height: 800 });
    await readerPage.waitForLoadState('domcontentloaded');
    await waitForPageLabel(readerPage);
    await readerPage.waitForTimeout(1000);
    for (let i = 0; i < 2; i += 1) {
      await readerPage.mouse.click(1180, 400);
      await readerPage.waitForTimeout(700);
    }
    await readerPage.waitForTimeout(800);
    await readerPage.screenshot({ path: path.join(storeAssetsDir, 'screenshot-reader-1280x800.png'), animations: 'disabled' });
  } finally {
    await context.close();
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
}

async function buildPromoTile() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 440, height: 280 } });
    const iconBase64 = fs.readFileSync(iconPath).toString('base64');
    await page.setContent(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <style>
      body {
        margin: 0;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        background: radial-gradient(circle at top left, #fff4de 0%, #f4e7d7 36%, #eadbca 100%);
      }
      .tile {
        width: 440px;
        height: 280px;
        box-sizing: border-box;
        padding: 28px 30px;
        display: grid;
        grid-template-columns: 124px 1fr;
        gap: 22px;
        align-items: center;
      }
      .icon-wrap {
        width: 124px;
        height: 124px;
        border-radius: 28px;
        background: rgba(255, 255, 255, 0.72);
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 16px 30px rgba(69, 35, 8, 0.12);
      }
      .icon-wrap img {
        width: 96px;
        height: 96px;
      }
      h1 {
        margin: 0 0 8px;
        font-size: 38px;
        line-height: 1;
        color: #2e1b10;
        letter-spacing: -0.04em;
      }
      p {
        margin: 0;
        color: #6a4d37;
      }
      .tagline {
        font-size: 17px;
        line-height: 1.3;
        max-width: 230px;
        margin-bottom: 16px;
      }
      .sub {
        font-size: 13px;
        font-weight: 600;
        letter-spacing: 0.02em;
        color: #a46a21;
      }
    </style>
  </head>
  <body>
    <div class="tile">
      <div class="icon-wrap">
        <img src="data:image/png;base64,${iconBase64}" alt="Ambra icon" />
      </div>
      <div>
        <h1>Ambra</h1>
        <p class="tagline">A polished, accessible EPUB3 reader for Chrome.</p>
        <p class="sub">Local library • Offline reading • Built for real books</p>
      </div>
    </div>
  </body>
</html>`);
    await page.screenshot({ path: path.join(storeAssetsDir, 'promo-tile-440x280.png') });
  } finally {
    await browser.close();
  }
}

ensureExists(extensionPath);
for (const bookPath of realBooks) {
  ensureExists(bookPath);
}
ensureExists(iconPath);
await buildLibraryAndReaderScreenshots();
await buildPromoTile();
console.log('Store images generated in store-assets/.');
