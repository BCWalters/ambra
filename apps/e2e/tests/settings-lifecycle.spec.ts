import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";

const book = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/two-chapter.epub");

async function findController(page: Page): Promise<void> {
  // Access the real mounted controller through React's existing hook state,
  // without shipping a test-only production global or replacing host behavior.
  await page.evaluate(() => {
    for (const element of document.querySelectorAll("*")) {
      const key = Object.keys(element).find(key => key.startsWith("__reactFiber$"));
      if (!key) continue;
      for (let fiber = Reflect.get(element, key); fiber; fiber = fiber.return) {
        for (let hook = fiber.memoizedState; hook; hook = hook.next) {
          const value = hook.memoizedState;
          if (value && typeof value.turnPage === "function" && typeof value.setFontScale === "function") {
            Reflect.set(window, "__settingsController", value);
            return;
          }
        }
      }
    }
    throw new Error("Mounted ReaderController not found");
  });
}

async function holdSecondColumn(page: Page): Promise<void> {
  await page.evaluate(() => {
    const prototype = HTMLIFrameElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "src")!;
    const gate: { held: boolean; release: (fail?: boolean) => void } = { held: false, release: () => {} };
    Reflect.set(window, "__settingsGate", gate);
    Object.defineProperty(prototype, "src", {
      ...descriptor,
      set(this: HTMLIFrameElement, value: string) {
        const siblings = this.parentElement?.querySelectorAll("iframe");
        if (!gate.held && siblings?.length === 2 && siblings[1] === this) {
          gate.held = true;
          Object.defineProperty(prototype, "src", descriptor);
          const block = (event: Event) => event.stopImmediatePropagation();
          this.addEventListener("load", block, true);
          gate.release = (fail = false) => {
            this.removeEventListener("load", block, true);
            if (fail) this.dispatchEvent(new Event("error"));
            else descriptor.set!.call(this, value);
          };
          return;
        }
        descriptor.set!.call(this, value);
      },
    });
  });
}

async function waitForLayout(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const controller = Reflect.get(window, "__settingsController");
    const requests = Reflect.get(window, "__settingsRequests");
    return requests?.settled === requests?.count && !controller.isTurningPage &&
      !controller.isLoadInFlight && !controller.isApplyingLayout;
  });
}

for (const trigger of ["animated turn", "held load"] as const) {
  for (const mode of ["paginated", "scroll"] as const) {
    test(`${trigger}: typography and ${mode} requests merge with resize and settle on one owned host`, async () => {
      const { context, readerPage: page } = await launchReader(book, { viewport: { width: 1400, height: 900 } });
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      try {
        await findController(page);
        if (trigger === "animated turn") {
          await page.evaluate(() => { void Reflect.get(window, "__settingsController").turnPage(1); });
          await page.waitForFunction(() => Reflect.get(window, "__settingsController").snapshot().isAnimatingPageTurn);
        } else {
          await holdSecondColumn(page);
          await page.setViewportSize({ width: 1300, height: 900 });
          await page.waitForFunction(() => Reflect.get(window, "__settingsGate").held);
        }

        const scale = trigger === "held load" && mode === "paginated" ? 1 : 1.25;
        const during = await page.evaluate(({ mode, scale }) => {
          const controller = Reflect.get(window, "__settingsController");
          const active = () => ({
            width: controller.width, height: controller.height, mode: controller.viewMode,
            scale: controller.fontScale, family: controller.fontFamily,
            line: controller.lineSpacing, letter: controller.letterSpacing, content: controller.contentWidthEm,
          });
          const before = active();
          const requests = { count: 0, settled: 0 };
          Reflect.set(window, "__settingsRequests", requests);
          const promises = [
            controller.setFontScale(1.5), controller.setFontScale(scale),
            controller.setFontFamily("times"), controller.setFontFamily("georgia"),
            controller.setLineSpacing(1.3), controller.setLineSpacing(1.15),
            controller.setLetterSpacing(0.04), controller.setLetterSpacing(0.02),
            controller.setContentWidth(28), controller.setContentWidth(30),
            controller.setViewMode("scroll"), controller.setViewMode(mode),
          ];
          requests.count = promises.length;
          for (const promise of promises) void promise.then(() => requests.settled++);
          return { before, after: active(), settled: requests.settled };
        }, { mode, scale });
        expect(during.after, "active-operation settings must not change across its awaits").toEqual(during.before);
        expect(during.settled, "a queued setter must not resolve before its layout exists").toBe(0);

        await page.setViewportSize({ width: 1100, height: 900 });
        await page.evaluate(() => new Promise<void>(resolve =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        if (trigger === "held load") {
          expect(await page.evaluate(() => Reflect.get(window, "__settingsRequests").settled)).toBe(0);
          await page.evaluate(() => Reflect.get(window, "__settingsGate").release());
        }
        await waitForLayout(page);

        const expectedFrames = mode === "paginated" ? 2 : 1;
        await expect.poll(() => page.locator("iframe").count()).toBe(expectedFrames);
        await expect.poll(() => page.evaluate(() =>
          Reflect.get(window, "__settingsController").disclosures.documents.size)).toBe(expectedFrames);
        const actual = await page.evaluate(async () => {
          const controller = Reflect.get(window, "__settingsController");
          const frames = Array.from(document.querySelectorAll("iframe"));
          const library = controller.library;
          return {
            mode: controller.snapshot().viewMode,
            width: controller.width,
            appliedWidth: controller.appliedWidth,
            scale: controller.fontScale,
            family: controller.fontFamily,
            line: controller.lineSpacing,
            letter: controller.letterSpacing,
            content: controller.contentWidthEm,
            widths: frames.map(frame => Math.round(frame.getBoundingClientRect().width)),
            styles: frames.map(frame => {
              const style = frame.contentDocument!.documentElement.style;
              return ["--ambra-font-scale", "--ambra-line-spacing", "--ambra-letter-spacing", "--ambra-content-width"]
                .map(property => style.getPropertyValue(property));
            }),
            families: frames.map(frame =>
              frame.contentDocument!.documentElement.style.getPropertyValue("--ambra-font-family")),
            focused: frames.includes(document.activeElement as HTMLIFrameElement),
            persisted: await Promise.all([
              library.getDefaultViewMode(), library.getDefaultFontScale(), library.getDefaultFontFamily(),
              library.getDefaultLineSpacing(), library.getDefaultLetterSpacing(), library.getDefaultContentWidth(),
            ]),
          };
        });
        expect(actual).toMatchObject({
          mode, width: 1100, appliedWidth: 1100, scale, family: "georgia", line: 1.15, letter: 0.02, content: 30,
          widths: mode === "paginated" ? [530, 530] : [1100], focused: true,
          styles: Array.from({ length: expectedFrames }, () => [String(scale), "1.15", "0.02", "30"]),
        });
        expect(actual.families.every(family => family.includes("Georgia"))).toBe(true);
        // Returning to an unchanged default need not materialize that default
        // in IndexedDB; effective persisted values must still match the request.
        const defaults = ["paginated", 1, during.before.family, 1, 0, 34];
        expect(actual.persisted.map((value, index) => value ?? defaults[index]))
          .toEqual([mode, scale, "georgia", 1.15, 0.02, 30]);

        if (mode === "scroll") {
          await page.evaluate(() => Reflect.get(window, "__settingsController").setViewMode("paginated"));
        }

        const before = await page.evaluate(() => JSON.stringify(Reflect.get(window, "__settingsController").host.positions));
        await page.evaluate(() => Reflect.get(window, "__settingsController").turnPage(1));
        expect(await page.evaluate(() => JSON.stringify(Reflect.get(window, "__settingsController").host.positions)))
          .not.toBe(before);
        await page.evaluate(() => Reflect.get(window, "__settingsController").turnPage(-1));
        expect(await page.evaluate(() => JSON.stringify(Reflect.get(window, "__settingsController").host.positions)))
          .toBe(before);
        await expect.poll(() => page.locator("iframe").count()).toBe(2);
        expect(errors).toEqual([]);
        await expect(page.getByRole("alert")).toHaveCount(0);
      } finally {
        await context.close();
      }
    });
  }
}

test("setters arriving during a settings reload settle only after the latest layout, including return to defaults", async () => {
  const { context, readerPage: page } = await launchReader(book, { viewport: { width: 1400, height: 900 } });
  try {
    await findController(page);
    await holdSecondColumn(page);
    await page.evaluate(() => {
      const controller = Reflect.get(window, "__settingsController");
      const state = { count: 0, settled: 0, completions: [] as unknown[] };
      Reflect.set(window, "__settingsRequests", state);
      const track = (promise: Promise<void>) => {
        state.count++;
        void promise.then(() => {
          state.settled++;
          state.completions.push({
            scale: controller.fontScale, mode: controller.viewMode,
            width: controller.appliedWidth,
            busy: controller.isApplyingLayout || controller.isLoadInFlight || controller.isTurningPage,
            columns: controller.host.element.querySelectorAll("iframe").length,
          });
        });
      };
      Reflect.set(window, "__trackSettingsRequest", track);
      track(controller.setFontScale(1.25));
    });
    await page.waitForFunction(() => Reflect.get(window, "__settingsGate").held);
    const activeScale = await page.evaluate(() => {
      const controller = Reflect.get(window, "__settingsController");
      const track = Reflect.get(window, "__trackSettingsRequest");
      track(controller.setFontScale(1.5));
      track(controller.setFontScale(1));
      track(controller.setViewMode("scroll"));
      track(controller.setViewMode("paginated"));
      return controller.fontScale;
    });
    expect(activeScale).toBe(1.25);
    expect(await page.evaluate(() => Reflect.get(window, "__settingsRequests").settled)).toBe(0);
    await page.setViewportSize({ width: 1100, height: 900 });
    await page.evaluate(() => new Promise<void>(resolve =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await page.evaluate(() => Reflect.get(window, "__settingsGate").release());
    await waitForLayout(page);
    const completions = await page.evaluate(() => Reflect.get(window, "__settingsRequests").completions);
    expect(completions).toEqual(Array.from({ length: 5 }, () => ({
      scale: 1, mode: "paginated", width: 1100, busy: false, columns: 2,
    })));
    expect(await page.evaluate(() => Reflect.get(window, "__settingsController").library.getDefaultFontScale())).toBe(1);
    await expect.poll(() => page.locator("iframe").count()).toBe(2);
    await expect.poll(() => page.evaluate(() =>
      Reflect.get(window, "__settingsController").disclosures.documents.size)).toBe(2);
    await expect(page.getByRole("alert")).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("a failed settings reload rejects its waiter and still applies the newer queued configuration", async () => {
  const { context, readerPage: page } = await launchReader(book, { viewport: { width: 1400, height: 900 } });
  try {
    await findController(page);
    await holdSecondColumn(page);
    await page.evaluate(() => {
      const controller = Reflect.get(window, "__settingsController");
      Reflect.set(window, "__failedSettingsRequest", controller.setFontScale(1.25)
        .then(() => "resolved", () => "rejected"));
    });
    await page.waitForFunction(() => Reflect.get(window, "__settingsGate").held);
    await page.evaluate(() => {
      Reflect.set(window, "__nextSettingsRequest", Reflect.get(window, "__settingsController").setFontScale(1.5));
      Reflect.get(window, "__settingsGate").release(true);
    });
    expect(await page.evaluate(() => Reflect.get(window, "__failedSettingsRequest"))).toBe("rejected");
    await page.evaluate(() => Reflect.get(window, "__nextSettingsRequest"));
    const final = await page.evaluate(async () => {
      const controller = Reflect.get(window, "__settingsController");
      return {
        scale: controller.fontScale,
        persisted: await controller.library.getDefaultFontScale(),
        busy: controller.isLoadInFlight || controller.isTurningPage || controller.isApplyingLayout,
      };
    });
    expect(final).toEqual({ scale: 1.5, persisted: 1.5, busy: false });
    await expect.poll(() => page.locator("iframe").count()).toBe(2);
    await expect.poll(() => page.evaluate(() =>
      Reflect.get(window, "__settingsController").disclosures.documents.size)).toBe(2);
    await expect(page.getByRole("alert")).toHaveCount(0);
  } finally {
    await context.close();
  }
});

for (const interaction of ["keyboard", "click", "selection"] as const) {
  test(`a failed replacement followed by original settings retains working ${interaction} on the original host`, async () => {
    const { context, readerPage: page } = await launchReader(book, { viewport: { width: 1400, height: 900 } });
    try {
      await findController(page);
      await holdSecondColumn(page);
      await page.evaluate(() => {
        const controller = Reflect.get(window, "__settingsController");
        Reflect.set(window, "__retainedSettingsHost", controller.host);
        Reflect.set(window, "__failedSettingsRequest", controller.setFontScale(1.25)
          .then(() => "resolved", () => "rejected"));
      });
      await page.waitForFunction(() => Reflect.get(window, "__settingsGate").held);
      await page.evaluate(() => {
        Reflect.set(window, "__originalSettingsRequest", Reflect.get(window, "__settingsController").setFontScale(1));
        Reflect.get(window, "__settingsGate").release(true);
      });
      expect(await page.evaluate(() => Reflect.get(window, "__failedSettingsRequest"))).toBe("rejected");
      await page.evaluate(() => Reflect.get(window, "__originalSettingsRequest"));
      expect(await page.evaluate(() =>
        Reflect.get(window, "__settingsController").host === Reflect.get(window, "__retainedSettingsHost"))).toBe(true);
      await expect.poll(() => page.locator("iframe").count()).toBe(2);

      await page.frameLocator("iframe").first().locator("body").focus();
      if (interaction === "keyboard") {
        const before = await page.evaluate(() => JSON.stringify(Reflect.get(window, "__settingsController").host.positions));
        // A real key in the iframe must reach its own navigation listener;
        // the parent document's keyboard fallback cannot rescue this assertion.
        await page.keyboard.press("ArrowRight");
        await expect.poll(() => page.evaluate(() =>
          JSON.stringify(Reflect.get(window, "__settingsController").host.positions))).not.toBe(before);
        await expect.poll(() => page.locator("iframe").count()).toBe(2);
        await page.keyboard.press("ArrowLeft");
        await expect.poll(() => page.evaluate(() =>
          JSON.stringify(Reflect.get(window, "__settingsController").host.positions))).toBe(before);
      } else if (interaction === "click") {
        const before = await page.evaluate(() => ({
          position: JSON.stringify(Reflect.get(window, "__settingsController").host.positions),
          activity: Reflect.get(window, "__settingsController").snapshot().contentPointerActivityId,
        }));
        const box = await page.locator("iframe").nth(1).boundingBox();
        await page.mouse.click(box!.x + box!.width * 0.9, box!.y + box!.height / 2);
        await expect.poll(() => page.evaluate(() =>
          JSON.stringify(Reflect.get(window, "__settingsController").host.positions))).not.toBe(before.position);
        expect(await page.evaluate(() =>
          Reflect.get(window, "__settingsController").snapshot().contentPointerActivityId)).toBeGreaterThan(before.activity);
      } else {
        await page.frameLocator("iframe").first().locator("p").first().evaluate(paragraph => {
          const doc = paragraph.ownerDocument;
          const range = doc.createRange();
          range.selectNodeContents(paragraph);
          doc.getSelection()!.removeAllRanges();
          doc.getSelection()!.addRange(range);
          doc.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
        });
        await page.getByRole("button", { name: "Yellow", exact: true }).click();
        await expect.poll(() => page.evaluate(() => {
          const frame = document.querySelector("iframe")!;
          return Reflect.get(frame.contentWindow!, "CSS").highlights.has("ambra-highlight-yellow");
        })).toBe(true);
      }
    } finally {
      await context.close();
    }
  });
}
