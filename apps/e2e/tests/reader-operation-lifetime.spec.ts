import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures");

async function holdIncomingFrame(page: Page): Promise<void> {
  await page.evaluate(() => {
    const ctl = Reflect.get(window, "__readerController");
    const container = ctl.containerEl;
    const prototype = HTMLIFrameElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "src")!;
    const gate = { held: false, release: (_fail = false) => {} };
    Reflect.set(window, "__operationGate", gate);
    Object.defineProperty(prototype, "src", {
      ...descriptor,
      set(this: HTMLIFrameElement, value: string) {
        if (!gate.held && container.contains(this)) {
          gate.held = true;
          Object.defineProperty(prototype, "src", descriptor);
          const block = (event: Event) => event.stopImmediatePropagation();
          this.addEventListener("load", block, true);
          gate.release = (fail = false) => {
            this.removeEventListener("load", block, true);
            if (fail) this.dispatchEvent(new Event("error"));
            else if (this.isConnected) descriptor.set!.call(this, value);
          };
          return;
        }
        descriptor.set!.call(this, value);
      },
    });
  });
}

for (const trigger of ["held", "animated"] as const) {
  test(`seek wins over a ${trigger} page turn`, async () => {
    const { context, readerPage: page } = await launchReader(
      path.join(fixtures, "two-chapter.epub"),
    );
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await exposeReaderController(page);
      if (trigger === "held") await holdIncomingFrame(page);
      await page.evaluate(() => {
        const ctl = Reflect.get(window, "__readerController");
        Reflect.set(window, "__oldHost", ctl.host);
        Reflect.set(window, "__turn", ctl.turnPage(1));
      });
      await page.waitForFunction(
        (trigger) =>
          trigger === "held"
            ? Reflect.get(window, "__operationGate").held
            : Reflect.get(window, "__readerController").snapshot().isAnimatingPageTurn,
        trigger,
      );
      await page.evaluate(() => Reflect.get(window, "__readerController").seekToFraction(1));
      if (trigger === "held")
        await page.evaluate(() => Reflect.get(window, "__operationGate").release());
      await page.evaluate(() => Reflect.get(window, "__turn"));
      const result = await page.evaluate(() => {
        const ctl = Reflect.get(window, "__readerController");
        return {
          spineIndex: ctl.spineIndex,
          text: ctl.host.element.contentDocument?.body.textContent,
        };
      });
      expect(result.spineIndex).toBe(1);
      expect(result.text).toContain("CHAPTER TWO");
      await expect.poll(() => page.locator("iframe").count()).toBe(1);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
}

for (const trigger of ["held", "animated"] as const) {
  test(`dispose during a ${trigger} turn cancels candidates and settles queued layout`, async () => {
    const { context, readerPage: page } = await launchReader(
      path.join(fixtures, "two-chapter.epub"),
    );
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await exposeReaderController(page);
      if (trigger === "held") await holdIncomingFrame(page);
      await page.evaluate(() => {
        const ctl = Reflect.get(window, "__readerController");
        Reflect.set(window, "__turn", ctl.turnPage(1));
      });
      await page.waitForFunction(
        (trigger) =>
          trigger === "held"
            ? Reflect.get(window, "__operationGate").held
            : Reflect.get(window, "__readerController").snapshot().isAnimatingPageTurn,
        trigger,
      );
      await page.evaluate(async () => {
        const ctl = Reflect.get(window, "__readerController");
        const settings = ctl.setFontScale(1.5);
        ctl.dispose();
        await settings;
        await Reflect.get(window, "__turn");
      });
      if (trigger === "held")
        await page.evaluate(() => Reflect.get(window, "__operationGate").release());
      await expect.poll(() => page.locator("iframe").count()).toBe(0);
      expect(
        await page.evaluate(() => {
          const ctl = Reflect.get(window, "__readerController");
          return {
            host: !!ctl.host,
            container: !!ctl.containerEl,
            turning: ctl.isTurningPage,
            loading: ctl.isLoadInFlight,
            applying: ctl.isApplyingLayout,
            pending: !!ctl.pendingLayout,
            documents: ctl.disclosures.documents.size,
          };
        }),
      ).toEqual({
        host: false,
        container: false,
        turning: false,
        loading: false,
        applying: false,
        pending: false,
        documents: 0,
      });
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
}

test("a failed page preparation keeps the current host interactive and permits another turn", async () => {
  const { context, readerPage: page } = await launchReader(path.join(fixtures, "two-chapter.epub"));
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await exposeReaderController(page);
    await holdIncomingFrame(page);
    await page.evaluate(() => {
      const ctl = Reflect.get(window, "__readerController");
      Reflect.set(window, "__oldHost", ctl.host);
      Reflect.set(window, "__turn", ctl.turnPage(1));
    });

    await page.waitForFunction(() => Reflect.get(window, "__operationGate").held);
    await page.evaluate(() => Reflect.get(window, "__operationGate").release(true));
    await page.evaluate(() => Reflect.get(window, "__turn"));
    expect(
      await page.evaluate(() => {
        const ctl = Reflect.get(window, "__readerController");
        return (
          ctl.host === Reflect.get(window, "__oldHost") &&
          ctl.host.element.isConnected &&
          !ctl.isTurningPage
        );
      }),
    ).toBe(true);
    await expect.poll(() => page.locator("iframe").count()).toBe(1);
    await page.evaluate(() => Reflect.get(window, "__readerController").turnPage(1));
    expect(
      await page.evaluate(() => Reflect.get(window, "__readerController").host.currentPageIndex),
    ).toBe(1);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

for (const fixture of ["two-chapter.epub", "fxl-spread-ltr.epub"]) {
  for (const trigger of ["held", "animated"] as const) {
    test(`${fixture}: TOC navigation supersedes a ${trigger} spread turn`, async () => {
      const { context, readerPage: page } = await launchReader(path.join(fixtures, fixture), {
        viewport: { width: 1400, height: 900 },
      });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      try {
        await exposeReaderController(page);
        if (trigger === "held") await holdIncomingFrame(page);
        await page.evaluate(() => {
          const ctl = Reflect.get(window, "__readerController");
          Reflect.set(window, "__turn", ctl.turnPage(1));
        });
        await page.waitForFunction(
          (trigger) =>
            trigger === "held"
              ? Reflect.get(window, "__operationGate").held
              : Reflect.get(window, "__readerController").snapshot().isAnimatingPageTurn,
          trigger,
        );
        await page.evaluate(async () => {
          const ctl = Reflect.get(window, "__readerController");
          await ctl.goToNavPoint({ path: ctl.pkg.spine.at(-1).manifestItem.path });
          Reflect.set(window, "__navigationHost", ctl.host);
        });
        if (trigger === "held")
          await page.evaluate(() => Reflect.get(window, "__operationGate").release());
        await page.evaluate(() => Reflect.get(window, "__turn"));
        expect(
          await page.evaluate(() => {
            const ctl = Reflect.get(window, "__readerController");
            return (
              ctl.host === Reflect.get(window, "__navigationHost") &&
              ctl.host.element.isConnected &&
              !ctl.isTurningPage &&
              !ctl.isLoadInFlight
            );
          }),
        ).toBe(true);
        await expect
          .poll(() =>
            page.evaluate(() => {
              const ctl = Reflect.get(window, "__readerController");
              return (
                document.querySelectorAll("iframe").length - ctl.host.contentDocuments().length
              );
            }),
          )
          .toBe(0);
        expect(errors).toEqual([]);
      } finally {
        await context.close();
      }
    });
  }
}

test("disposing a held settings reload settles both active and queued setters without a late host", async () => {
  const { context, readerPage: page } = await launchReader(
    path.join(fixtures, "two-chapter.epub"),
    {
      viewport: { width: 1400, height: 900 },
    },
  );
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await exposeReaderController(page);
    await holdIncomingFrame(page);
    await page.evaluate(() => {
      const ctl = Reflect.get(window, "__readerController");
      Reflect.set(window, "__settings", ctl.setFontScale(1.25));
    });
    await page.waitForFunction(() => Reflect.get(window, "__operationGate").held);
    await page.evaluate(async () => {
      const ctl = Reflect.get(window, "__readerController");
      const queued = ctl.setFontScale(1.5);
      ctl.dispose();
      await Promise.all([queued, Reflect.get(window, "__settings")]);
    });
    await page.evaluate(() => Reflect.get(window, "__operationGate").release());
    await expect.poll(() => page.locator("iframe").count()).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test("a failed navigation that cancels an animated turn retains the original interactive host", async () => {
  const { context, readerPage: page } = await launchReader(path.join(fixtures, "two-chapter.epub"));
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await exposeReaderController(page);
    await page.evaluate(() => {
      const ctl = Reflect.get(window, "__readerController");
      Reflect.set(window, "__original", ctl.host);
      Reflect.set(window, "__turn", ctl.turnPage(1));
    });
    await page.waitForFunction(
      () => Reflect.get(window, "__readerController").snapshot().isAnimatingPageTurn,
    );
    await holdIncomingFrame(page);
    await page.evaluate(() => {
      const ctl = Reflect.get(window, "__readerController");
      // Section shortcuts ignore busy readers; explicit TOC navigation supersedes the operation.
      Reflect.set(
        window,
        "__navigation",
        ctl.goToNavPoint({ path: ctl.pkg.spine.at(-1).manifestItem.path }),
      );
    });
    await page.waitForFunction(() => Reflect.get(window, "__operationGate").held);
    await page.evaluate(() => Reflect.get(window, "__operationGate").release(true));
    await page.evaluate(() =>
      Promise.all([Reflect.get(window, "__turn"), Reflect.get(window, "__navigation")]),
    );
    expect(
      await page.evaluate(() => {
        const ctl = Reflect.get(window, "__readerController");
        return (
          ctl.host === Reflect.get(window, "__original") &&
          ctl.host.element.isConnected &&
          ctl.host.currentPageIndex === 0 &&
          ctl.host.element.style.transform === ""
        );
      }),
    ).toBe(true);
    await expect.poll(() => page.locator("iframe").count()).toBe(1);
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(
      () => Reflect.get(window, "__readerController").host.currentPageIndex === 1,
    );
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test("settings superseded by navigation settle only when the replacement using those settings commits", async () => {
  const { context, readerPage: page } = await launchReader(
    path.join(fixtures, "two-chapter.epub"),
    {
      viewport: { width: 1400, height: 900 },
    },
  );
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await exposeReaderController(page);
    await holdIncomingFrame(page);
    await page.evaluate(() => {
      const ctl = Reflect.get(window, "__readerController");
      Reflect.set(window, "__settingsSettled", false);
      Reflect.set(
        window,
        "__settings",
        ctl.setFontScale(1.25).then(() => {
          Reflect.set(window, "__settingsSettled", true);
        }),
      );
    });
    await page.waitForFunction(() => Reflect.get(window, "__operationGate").held);
    await holdIncomingFrame(page);
    await page.evaluate(() => {
      const ctl = Reflect.get(window, "__readerController");
      Reflect.set(
        window,
        "__navigation",
        ctl.goToNavPoint({ path: ctl.pkg.spine.at(-1).manifestItem.path }),
      );
    });
    await page.waitForFunction(() => Reflect.get(window, "__operationGate").held);
    expect(await page.evaluate(() => Reflect.get(window, "__settingsSettled"))).toBe(false);
    await page.evaluate(() => Reflect.get(window, "__operationGate").release());
    await page.evaluate(() =>
      Promise.all([Reflect.get(window, "__settings"), Reflect.get(window, "__navigation")]),
    );
    expect(
      await page.evaluate(() => {
        const ctl = Reflect.get(window, "__readerController");
        return { scale: ctl.fontScale, spine: ctl.spineIndex, error: ctl.snapshot().error };
      }),
    ).toEqual({ scale: 1.25, spine: 1, error: undefined });
    await expect.poll(() => page.locator("iframe").count()).toBe(2);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test("failed drag preparation releases its gate and gesture listeners", async () => {
  const { context, readerPage: page } = await launchReader(path.join(fixtures, "two-chapter.epub"));
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await exposeReaderController(page);
    await holdIncomingFrame(page);
    await page.evaluate(() => {
      const ctl = Reflect.get(window, "__readerController");
      const doc = ctl.host.element.contentDocument;
      doc.dispatchEvent(
        new PointerEvent("pointerdown", { pointerId: 1, clientX: 800, clientY: 200 }),
      );
      doc.dispatchEvent(
        new PointerEvent("pointermove", { pointerId: 1, clientX: 100, clientY: 200 }),
      );
    });
    await page.waitForFunction(() => Reflect.get(window, "__operationGate").held);
    await page.evaluate(() => Reflect.get(window, "__operationGate").release(true));
    await page.waitForFunction(() => !Reflect.get(window, "__readerController").isTurningPage);
    expect(
      await page.evaluate(() => Reflect.get(window, "__readerController").gestureCleanup),
    ).toBeUndefined();
    await page.evaluate(() => Reflect.get(window, "__readerController").turnPage(1));
    expect(
      await page.evaluate(() => Reflect.get(window, "__readerController").host.currentPageIndex),
    ).toBe(1);
    await expect.poll(() => page.locator("iframe").count()).toBe(1);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test("pointercancel never commits a drag even after passing the commit threshold", async () => {
  const { context, readerPage: page } = await launchReader(path.join(fixtures, "two-chapter.epub"));
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await exposeReaderController(page);
    await holdIncomingFrame(page);
    await page.evaluate(() => {
      const ctl = Reflect.get(window, "__readerController");
      const doc = ctl.host.element.contentDocument;
      doc.dispatchEvent(
        new PointerEvent("pointerdown", { pointerId: 1, clientX: 800, clientY: 200 }),
      );
      doc.dispatchEvent(
        new PointerEvent("pointermove", { pointerId: 1, clientX: 100, clientY: 200 }),
      );
      doc.dispatchEvent(
        new PointerEvent("pointercancel", { pointerId: 1, clientX: 100, clientY: 200 }),
      );
    });
    await page.waitForFunction(() => Reflect.get(window, "__operationGate").held);
    await page.evaluate(() => Reflect.get(window, "__operationGate").release());
    await page.waitForFunction(() => !Reflect.get(window, "__readerController").isTurningPage);
    expect(
      await page.evaluate(() => Reflect.get(window, "__readerController").host.currentPageIndex),
    ).toBe(0);
    await expect.poll(() => page.locator("iframe").count()).toBe(1);
    await page.evaluate(() => Reflect.get(window, "__readerController").turnPage(1));
    expect(
      await page.evaluate(() => Reflect.get(window, "__readerController").host.currentPageIndex),
    ).toBe(1);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
