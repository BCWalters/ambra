import { chromium, expect, test as base, type BrowserContext } from "@playwright/test";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { EXTENSION_PATH, launchReader } from "../harness.js";

// These harness unit tests replace Chromium launch entirely: no browser is started.
class Locator {
  public readonly _apiName = "Locator";
  public importFailure: Error | undefined;
  public async _expect() { return { matches: true }; }
  public first() { return this; }
  public async waitFor() {}
  public async click() {}
  public async setInputFiles() {
    if (this.importFailure) throw this.importFailure;
  }
}

class StubContext extends EventEmitter {
  public closeCount = 0;
  public closeFailure: Error | undefined;
  public readonly input = new Locator();
  private readonly reader = {
    url: () => "chrome-extension://test/src/reader/index.html",
    waitForLoadState: async () => {},
    waitForTimeout: async () => {},
  };
  public serviceWorkers() { return [{ url: () => "chrome-extension://test/worker.js" }]; }
  public async newPage() {
    return {
      goto: async () => {},
      locator: () => this.input,
      getByRole: () => this.input,
      waitForTimeout: async () => {},
    };
  }
  public pages() { return [this.reader]; }
  public async close() {
    this.closeCount++;
    if (this.closeFailure) throw this.closeFailure;
    this.emit("close");
  }
}

interface HarnessStub {
  context: StubContext;
  profiles: string[];
  launchFailure?: Error;
}

const test = base.extend<{ harness: HarnessStub }>({
  harness: async ({ browserName: _browserName }, use) => {
    const originalLaunch = chromium.launchPersistentContext;
    const originalExists = fs.existsSync;
    const harness: HarnessStub = { context: new StubContext(), profiles: [] };
    fs.existsSync = (file) => String(file) === EXTENSION_PATH || originalExists(file);
    chromium.launchPersistentContext = async (profile) => {
      harness.profiles.push(profile);
      if (harness.launchFailure) throw harness.launchFailure;
      return harness.context as unknown as BrowserContext;
    };
    try {
      await use(harness);
    } finally {
      chromium.launchPersistentContext = originalLaunch;
      fs.existsSync = originalExists;
      for (const profile of harness.profiles) fs.rmSync(profile, { recursive: true, force: true });
    }
  },
});

test("successful context close removes only its own unique profile", async ({ harness }) => {
  const { context } = await launchReader("unused.epub");
  const profile = harness.profiles[0]!;
  const neighbor = fs.mkdtempSync(path.join(path.dirname(profile), "unrelated-test-profile-"));
  try {
    expect(fs.existsSync(profile)).toBe(true);
    await context.close();
    expect(harness.context.closeCount).toBe(1);
    expect(fs.existsSync(profile)).toBe(false);
    expect(fs.existsSync(neighbor)).toBe(true);
  } finally {
    fs.rmSync(neighbor, { recursive: true, force: true });
  }
});

test("failed initial import closes the context and removes its profile before rejecting", async ({ harness }) => {
  const failure = new Error("Initial import failed");
  harness.context.input.importFailure = failure;
  await expect(launchReader("unused.epub")).rejects.toBe(failure);
  expect(harness.context.closeCount).toBe(1);
  expect(fs.existsSync(harness.profiles[0]!)).toBe(false);
});

test("browser-launch failure also removes the newly created profile", async ({ harness }) => {
  const failure = new Error("Launch failed");
  harness.launchFailure = failure;
  await expect(launchReader("unused.epub")).rejects.toBe(failure);
  expect(harness.context.closeCount).toBe(0);
  expect(fs.existsSync(harness.profiles[0]!)).toBe(false);
});

test("a context-close failure does not replace the original setup failure or skip profile cleanup", async ({ harness }) => {
  const failure = new Error("Initial import failed");
  harness.context.input.importFailure = failure;
  harness.context.closeFailure = new Error("Close failed");
  const warn = console.warn;
  const warnings: unknown[][] = [];
  console.warn = (...args: unknown[]) => { warnings.push(args); };
  try {
    await expect(launchReader("unused.epub")).rejects.toBe(failure);
    expect(harness.context.closeCount).toBe(1);
    expect(fs.existsSync(harness.profiles[0]!)).toBe(false);
    expect(warnings).toEqual([[
      "Could not close the failed reader test context.", harness.context.closeFailure,
    ]]);
  } finally {
    console.warn = warn;
  }
});
