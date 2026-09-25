import { expect, test as base, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { EXTENSION_PATH } from "../harness.js";

const test = base.extend<{ library: Page }>({
  library: async ({ playwright }, use, testInfo) => {
    const context = await playwright.chromium.launchPersistentContext(testInfo.outputPath("profile"), {
      headless: process.env.AMBRA_E2E_HEADLESS === "1",
      ...(process.env.AMBRA_E2E_HEADLESS === "1" ? { channel: "chromium" } : {}),
      args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
    });
    try {
      let [worker] = context.serviceWorkers();
      worker ??= await context.waitForEvent("serviceworker");
      const page = await context.newPage();
      await page.goto(`chrome-extension://${worker.url().split("/")[2]}/src/library/index.html?view=tab`);
      await expect(page.getByText("What will you read first?", { exact: true })).toBeVisible();
      await page.evaluate(() => {
        for (const element of document.querySelectorAll("*")) {
          const key = Object.keys(element).find((name) => name.startsWith("__reactFiber$"));
          if (!key) continue;
          for (let fiber = Reflect.get(element, key); fiber; fiber = fiber.return) {
            for (let hook = fiber.memoizedState; hook; hook = hook.next) {
              if (typeof hook.memoizedState?.getLibraryCoverBlobs === "function") {
                Reflect.set(window, "__libraryDatabase", hook.memoizedState);
                return;
              }
            }
          }
        }
        throw new Error("Mounted library database not found");
      });
      await use(page);
    } finally { await context.close(); }
  },
});

async function seedCover(page: Page, type: "jpeg" | "svg" | "broken" = "jpeg", archive?: Uint8Array) {
  return page.evaluate(async ({ type, archive }) => {
    let blob: Blob;
    if (type === "jpeg") {
      const canvas = document.createElement("canvas");
      canvas.width = 1200;
      canvas.height = 1800;
      const context = canvas.getContext("2d")!;
      context.fillStyle = "#008899";
      context.fillRect(0, 0, canvas.width, canvas.height);
      blob = await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob!), "image/jpeg"));
      canvas.width = canvas.height = 0;
    } else {
      blob = type === "svg"
        ? new Blob(['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1800"><rect width="1200" height="1800" fill="teal"/></svg>'], { type: "image/svg+xml" })
        : new Blob(["corrupt"], { type: "image/jpeg" });
    }
    const db = Reflect.get(window, "__libraryDatabase");
    return await db.addBook(new Blob([archive ? new Uint8Array(archive) : type]), { title: "Cover test", creator: "Test", identifier: type }, blob) as string;
  }, { type, archive: archive ? [...archive] : undefined });
}

test("legacy covers get persistent bounded card images while details retain originals", async ({ library }) => {
  const id = await seedCover(library);
  const result = await library.evaluate(async (id) => {
    const db = Reflect.get(window, "__libraryDatabase");
    const first = await db.getLibraryCoverBlobs(id);
    const originalBytes = [...new Uint8Array(await first.original.arrayBuffer())];
    const originalDecode = HTMLImageElement.prototype.decode;
    let decodes = 0;
    HTMLImageElement.prototype.decode = function () { decodes++; return originalDecode.call(this); };
    const second = await db.getLibraryCoverBlobs(id);
    HTMLImageElement.prototype.decode = originalDecode;
    return { decodes, originalBytes, retainedBytes: [...new Uint8Array(await (await db.getCoverBlob(id)).arrayBuffer())],
      cardType: second.card.type, cardBytes: second.card.size, originalSize: first.original.size };
  }, id);
  expect(result.decodes).toBe(0);
  expect(result.retainedBytes).toEqual(result.originalBytes);
  expect(result.cardType).toBe("image/jpeg");
  expect(result.cardBytes).toBeLessThan(result.originalSize);
  await library.addInitScript(() => {
    const decode = HTMLImageElement.prototype.decode;
    Reflect.set(window, "__coverDecodes", 0);
    HTMLImageElement.prototype.decode = function () {
      Reflect.set(window, "__coverDecodes", Reflect.get(window, "__coverDecodes") + 1);
      return decode.call(this);
    };
  });
  await library.reload();
  const card = library.getByRole("button", { name: /^Open Cover test/ });
  await expect(card).toBeVisible();
  expect(await library.evaluate(() => Reflect.get(window, "__coverDecodes"))).toBe(0);
  expect(await card.evaluate(async (element) => {
    const image = new Image();
    image.src = getComputedStyle(element).backgroundImage.slice(5, -2);
    await image.decode();
    return [image.naturalWidth, image.naturalHeight];
  })).toEqual([400, 600]);
  await card.hover();
  await library.getByRole("button", { name: /Cover test.*details$/ }).click();
  const original = library.getByRole("dialog", { name: "Book details", exact: true }).locator("img");
  await expect(original).toBeVisible();
  expect(await original.evaluate(async (image: HTMLImageElement) => {
    await image.decode();
    return [image.naturalWidth, image.naturalHeight];
  })).toEqual([1200, 1800]);
});

test("viewBox-only SVG cards render correctly, preserve originals, and corrupt JPEGs show titles", async ({ library }) => {
  const svgId = await seedCover(library, "svg");
  expect(await library.evaluate(async (id) => {
    const db = Reflect.get(window, "__libraryDatabase");
    const cover = await db.getLibraryCoverBlobs(id);
    const image = new Image();
    const url = URL.createObjectURL(cover.card);
    try {
      image.src = url;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      return { type: cover.card.type, originalType: (await db.getCoverBlob(id)).type,
        dimensions: [image.naturalWidth, image.naturalHeight],
        pixel: [...context.getImageData(100, 100, 1, 1).data] };
    } finally { URL.revokeObjectURL(url); }
  }, svgId)).toEqual({ type: "image/png", originalType: "image/svg+xml", dimensions: [400, 600], pixel: [0, 128, 128, 255] });
  await library.evaluate(async (id) => Reflect.get(window, "__libraryDatabase").deleteBook(id), svgId);
  const brokenId = await seedCover(library, "broken");
  const warnings: string[] = [];
  library.on("console", (message) => { if (message.type() === "warning") warnings.push(message.text()); });
  await library.reload();
  const card = library.getByRole("button", { name: /^Open Cover test/ });
  await expect(card).toHaveText("Cover test");
  expect(warnings.filter((message) => message.includes("book title"))).toHaveLength(1);
  await library.reload();
  await expect(card).toHaveText("Cover test");
  expect(warnings.filter((message) => message.includes("book title"))).toHaveLength(2);
  expect(brokenId).toBeTruthy();
});

test("deleting during a legacy decode never resurrects the book or its cover", async ({ library }) => {
  const id = await seedCover(library);
  const result = await library.evaluate(async (id) => {
    const db = Reflect.get(window, "__libraryDatabase");
    const decode = HTMLImageElement.prototype.decode;
    let release!: () => void;
    let started!: () => void;
    const start = new Promise<void>((resolve) => { started = resolve; });
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    HTMLImageElement.prototype.decode = async function () {
      await decode.call(this);
      started();
      await blocked;
    };
    try {
      const reading = db.getLibraryCoverBlobs(id);
      await start;
      await db.deleteBook(id);
      release();
      return { cover: await reading, metadata: await db.getBookMetadata(id), original: await db.getCoverBlob(id) };
    } finally { HTMLImageElement.prototype.decode = decode; release(); }
  }, id);
  expect(result).toEqual({ cover: undefined, metadata: undefined, original: undefined });
});

test("SVG thumbnails retain embedded JPEG artwork, vector shapes, and transparency", async ({ library }) => {
  const result = await library.evaluate(async () => {
    const artwork = document.createElement("canvas");
    artwork.width = artwork.height = 20;
    const paint = artwork.getContext("2d")!;
    paint.fillStyle = "#ff0000";
    paint.fillRect(0, 0, 20, 20);
    const source = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 600 900">
      <image x="100" y="100" width="400" height="400" xlink:href="${artwork.toDataURL("image/jpeg")}"/>
      <rect x="0" y="700" width="600" height="200" fill="teal"/>
    </svg>`;
    const db = Reflect.get(window, "__libraryDatabase");
    const id = await db.addBook(new Blob(["embedded SVG"]), { title: "Artwork", identifier: "artwork" },
      new Blob([source], { type: "image/svg+xml" }));
    const cover = await db.getLibraryCoverBlobs(id);
    const url = URL.createObjectURL(cover.card);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      const pixel = (x: number, y: number) => [...context.getImageData(x, y, 1, 1).data];
      return { dimensions: [image.naturalWidth, image.naturalHeight], artwork: pixel(100, 100),
        vector: pixel(200, 550), transparent: pixel(10, 10), originalUnchanged: await (await db.getCoverBlob(id)).text() === source };
    } finally { URL.revokeObjectURL(url); }
  });
  expect(result.dimensions).toEqual([400, 600]);
  expect(result.originalUnchanged).toBe(true);
  expect(result.artwork[0]).toBeGreaterThan(250);
  expect(result.artwork.slice(1, 3)).toEqual([0, 0]);
  expect(result.vector).toEqual([0, 128, 128, 255]);
  expect(result.transparent).toEqual([0, 0, 0, 0]);
});

test("large still PNG cards are bounded and retain transparent pixels", async ({ library }) => {
  const result = await library.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 1600;
    canvas.height = 2400;
    const paint = canvas.getContext("2d")!;
    paint.fillStyle = "teal";
    paint.fillRect(400, 600, 800, 1200);
    const original = await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob!), "image/png"));
    const db = Reflect.get(window, "__libraryDatabase");
    const id = await db.addBook(new Blob(["PNG"]), { title: "PNG", identifier: "png" }, original);
    const cover = await db.getLibraryCoverBlobs(id);
    const url = URL.createObjectURL(cover.card);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      paint.drawImage(image, 0, 0);
      return { dimensions: [image.naturalWidth, image.naturalHeight], type: cover.card.type,
        center: [...paint.getImageData(200, 300, 1, 1).data], corner: [...paint.getImageData(10, 10, 1, 1).data],
        originalBytes: (await db.getCoverBlob(id)).size, expectedBytes: original.size };
    } finally { URL.revokeObjectURL(url); }
  });
  expect(result.dimensions).toEqual([400, 600]);
  expect(result.type).toBe("image/png");
  expect(result.center).toEqual([0, 128, 128, 255]);
  expect(result.corner).toEqual([0, 0, 0, 0]);
  expect(result.originalBytes).toBe(result.expectedBytes);
});

for (const failure of ["quota", "abort", "read-only"] as const) {
  test(`${failure} cache failures still list and open books, preserve originals, and retry persistence`, async ({ library }) => {
    const archive = await readFile(new URL("../fixtures/long-content.epub", import.meta.url));
    const id = await seedCover(library, "jpeg", archive);
    const snapshot = () => library.evaluate(async (id) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("ambra-library");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        const record = await new Promise<{ blob: Blob; libraryCoverV1?: Blob | "original" }>((resolve, reject) => {
          const request = db.transaction("bookCovers", "readonly").objectStore("bookCovers").get(id);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        return { original: [...new Uint8Array(await record.blob.arrayBuffer())], saved: record.libraryCoverV1 !== undefined };
      } finally { db.close(); }
    }, id);
    const before = await snapshot();
    await library.addInitScript((failure) => {
      const shouldFail = () => localStorage.getItem("allow-cover-cache") !== "1";
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) {
        if (this.name === "bookCovers" && shouldFail() && failure === "quota") {
          throw new DOMException("Thumbnail cache quota exceeded", "QuotaExceededError");
        }
        const request = put.apply(this, args);
        if (this.name === "bookCovers" && shouldFail() && failure === "abort") {
          request.addEventListener("success", () => this.transaction.abort(), { once: true });
        }
        return request;
      };
      const transaction = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function (stores, mode, options) {
        const names = typeof stores === "string" ? [stores] : Array.from(stores);
        if (mode === "readwrite" && names.includes("bookCovers") &&
          shouldFail() && failure === "read-only") {
          throw new DOMException("Thumbnail cache is read-only", "ReadOnlyError");
        }
        return transaction.call(this, stores, mode, options);
      };
    }, failure);
    const warnings: string[] = [];
    library.on("console", (message) => { if (message.type() === "warning") warnings.push(message.text()); });
    await library.reload();
    const card = library.getByRole("button", { name: /^Open Cover test/ });
    await expect(card).toBeVisible();
    await expect(library.getByRole("alert")).toHaveCount(0);
    expect(warnings.some((message) => message.includes("temporary cover"))).toBe(true);
    expect(await snapshot()).toEqual(before);
    expect(before.saved).toBe(false);
    expect(await card.evaluate(async (element) => {
      const image = new Image();
      image.src = getComputedStyle(element).backgroundImage.slice(5, -2);
      await image.decode();
      return [image.naturalWidth, image.naturalHeight];
    })).toEqual([400, 600]);
    const opened = library.context().waitForEvent("page");
    await card.click();
    const reader = await opened;
    try {
      await reader.waitForFunction(() => [...document.querySelectorAll("iframe")].some(
        (frame) => (frame.contentDocument?.body?.textContent?.trim().length ?? 0) > 100,
      ));
    } finally { await reader.close(); }
    await library.evaluate(() => localStorage.setItem("allow-cover-cache", "1"));
    await library.reload();
    await expect(card).toBeVisible();
    expect(await snapshot()).toEqual({ ...before, saved: true });
  });
}
