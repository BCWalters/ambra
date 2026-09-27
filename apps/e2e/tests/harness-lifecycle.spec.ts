import { chromium, expect, test as base, type BrowserContext } from "@playwright/test";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { EXTENSION_PATH, launchReader } from "../harness.js";

// These harness unit tests replace Chromium launch entirely: no browser is started.
interface ReadinessCheck {
  selector: string;
  expression: string;
  options: Record<string, unknown>;
}

class Locator {
  public readonly _apiName = "Locator";
  public importFailure: Error | undefined;
  public onClick: (() => void) | undefined;
  public constructor(private selector = "", private checks?: ReadinessCheck[]) {}
  public async _expect(expression: string, options: Record<string, unknown>) {
    this.checks?.push({ selector: this.selector, expression, options });
    return { matches: true };
  }
  public locator(selector: string) {
    return new Locator(`${this.selector}.locator(${JSON.stringify(selector)})`, this.checks);
  }
  public first() {
    // Library stubs also use first(); keep their import/click behavior intact.
    if (!this.checks) return this;
    return new Locator(`${this.selector}.first()`, this.checks);
  }
  public async waitFor() {}
  public async click() { this.onClick?.(); }
  public async setInputFiles() {
    if (this.importFailure) throw this.importFailure;
  }
}

class StubContext extends EventEmitter {
  public closeCount = 0;
  public closeFailure: Error | undefined;
  public preferenceSeedCount = 0;
  public preferenceSeedFailure: Error | undefined;
  public readerReadinessFailure: Error | undefined;
  public pageSubscribedBeforeOpen = false;
  public readonly readinessChecks: ReadinessCheck[] = [];
  public readonly input = new Locator();
  private readonly reader = {
    url: () => "chrome-extension://test/src/reader/index.html",
    waitForURL: async () => {},
    waitForLoadState: async () => {},
    getByRole: (role: string) => {
      if (this.readerReadinessFailure) throw this.readerReadinessFailure;
      return new Locator(`getByRole(${JSON.stringify(role)})`, this.readinessChecks);
    },
    locator: (selector: string) =>
      new Locator(`locator(${JSON.stringify(selector)})`, this.readinessChecks),
  };
  public constructor() {
    super();
    this.input.onClick = () => {
      this.pageSubscribedBeforeOpen = this.listenerCount("page") > 0;
      this.emit("page", this.reader);
    };
  }
  public waitForEvent(event: string) {
    return new Promise(resolve => this.once(event, resolve));
  }
  public serviceWorkers() { return [{ url: () => "chrome-extension://test/worker.js" }]; }
  public async newPage() {
    return {
      goto: async () => {},
      locator: () => this.input,
      getByRole: () => this.input,
      evaluate: async () => {
        this.preferenceSeedCount++;
        if (this.preferenceSeedFailure) throw this.preferenceSeedFailure;
      },
    };
  }
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

test("successful context close removes only its own unique profile outside runner output", async ({ harness }) => {
  const { context } = await launchReader("unused.epub");
  expect(harness.context.preferenceSeedCount).toBe(1);
  expect(harness.context.pageSubscribedBeforeOpen).toBe(true);
  expect(harness.context.readinessChecks).toMatchObject([
    {
      selector: 'getByRole("main").locator("iframe").first()',
      expression: "to.be.visible",
      options: { timeout: 20_000 },
    },
    {
      selector: 'getByRole("progressbar")',
      expression: "to.have.count",
      options: { expectedNumber: 0, timeout: 20_000 },
    },
  ]);
  const profile = harness.profiles[0]!;
  const relativeToOutput = path.relative(test.info().project.outputDir, profile);
  expect(relativeToOutput.startsWith(`..${path.sep}`)).toBe(true);
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

test("first-reading coverage leaves the real profile preference unseeded", async ({ harness }) => {
  const { context } = await launchReader("unused.epub", { firstReadingWelcome: true });
  expect(harness.context.preferenceSeedCount).toBe(0);
  expect(harness.context.readinessChecks).toHaveLength(3);
  expect(harness.context.readinessChecks[2]).toMatchObject({
    selector: 'locator(".reading-welcome[role=\\"dialog\\"]")',
    expression: "to.be.visible",
    options: { isNot: false },
  });
  await context.close();
  expect(fs.existsSync(harness.profiles[0]!)).toBe(false);
});

test("reader-readiness failure closes the context and removes its profile", async ({ harness }) => {
  const failure = new Error("Reader content never became ready");
  harness.context.readerReadinessFailure = failure;
  await expect(launchReader("unused.epub")).rejects.toBe(failure);
  expect(harness.context.pageSubscribedBeforeOpen).toBe(true);
  expect(harness.context.closeCount).toBe(1);
  expect(fs.existsSync(harness.profiles[0]!)).toBe(false);
});

test("a preference-seeding failure closes the context and removes its profile", async ({ harness }) => {
  const failure = new Error("Preference write failed");
  harness.context.preferenceSeedFailure = failure;
  await expect(launchReader("unused.epub")).rejects.toBe(failure);
  expect(harness.context.closeCount).toBe(1);
  expect(fs.existsSync(harness.profiles[0]!)).toBe(false);
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
