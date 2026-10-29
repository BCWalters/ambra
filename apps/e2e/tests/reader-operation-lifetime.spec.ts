import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader, READER_FRAME_SELECTOR } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures");

async function holdIncomingFrame(page: Page, style: "slide" | "scroll" = "slide"): Promise<void> {
  await page.evaluate(async style => {
    const ctl = Reflect.get(window, "__readerController");
    // Page flip reuses documents; flat effects exercise incoming-frame ownership.
    await ctl.setPageTurnAnimationStyle(style);
    ctl.pageTurnPrefetch.clear();
    ctl.schedulePageTurnPrefetch = () => {};
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
  }, style);
}

async function dragForwardEdge(page: Page): Promise<void> {
  const bounds = await page.evaluate(() => {
    const ctl = Reflect.get(window, "__readerController");
    const edge = [...ctl.pageMargins().edges].sort((a, b) => a.left - b.left).at(-1);
    return { x: edge.right - 3, y: edge.top + edge.height / 2, width: ctl.width };
  });
  await page.mouse.move(bounds.x, bounds.y);
  await page.mouse.down();
  await page.mouse.move(bounds.x - bounds.width * 0.6, bounds.y, { steps: 12 });
}

for (const style of ["slide", "scroll"] as const) {
  for (const direction of [1, -1] as const) {
    test(`${style} direction=${direction}: mouse paper moves at 8px before the incoming page loads`, async () => {
      const { context, readerPage: page } = await launchReader(
        path.join(fixtures, "two-chapter.epub"),
      );
      try {
        await exposeReaderController(page);
        await page.evaluate(async (style) => {
          const c = Reflect.get(window, "__readerController");
          await c.setPageTurnAnimationStyle("none");
          await c.turnPage(1);
          await c.setPageTurnAnimationStyle(style);
        }, style);
        await holdIncomingFrame(page, style);
        const before = await page.evaluate(() =>
          Reflect.get(window, "__readerController").currentReadingCfi(),
        );
        const bounds = await page.evaluate((direction) => {
          const c = Reflect.get(window, "__readerController");
          const edges = [...c.pageMargins().edges].sort((a, b) => a.left - b.left);
          const edge = edges[direction === 1 ? edges.length - 1 : 0];
          return {
            x: direction === 1 ? edge.right - 3 : edge.left + 3,
            y: edge.top + edge.height / 2,
            width: c.width,
          };
        }, direction);
        await page.mouse.move(bounds.x, bounds.y);
        await page.mouse.down();
        await page.mouse.move(bounds.x - direction * 8, bounds.y);
        await page.waitForFunction(() => Reflect.get(window, "__operationGate").held);
        const preview = await page.evaluate(() => {
          const c = Reflect.get(window, "__readerController");
          const paper =
            document.querySelector<HTMLElement>("[data-ambra-preparing-page-turn]") ??
            c.hostWrapperEl ??
            c.host.element;
          return {
            transform: paper.style.transform,
            animating: c.isAnimatingPageTurn,
            cfi: c.currentReadingCfi(),
          };
        });
        expect(preview.animating).toBe(false);
        expect(preview.cfi).toBe(before);
        const expected =
          style === "slide" && direction === -1
            ? direction * 100 * (1 - 8 / bounds.width)
            : (-direction * 100 * 8) / bounds.width;
        expect(Number.parseFloat(preview.transform.slice("translateX(".length))).toBeCloseTo(
          expected,
          4,
        );
        await page.keyboard.press("Escape");
        await page.evaluate(() => Reflect.get(window, "__operationGate").release());
        await page.mouse.up();
        await page.waitForFunction(() => !Reflect.get(window, "__readerController").isTurningPage);
        await expect(
          page.locator("[data-ambra-preparing-page-turn], [data-ambra-page-turn-input]"),
        ).toHaveCount(0);
        expect(
          await page.evaluate(() => {
            const c = Reflect.get(window, "__readerController");
            return (c.hostWrapperEl ?? c.host.element).style.transform;
          }),
        ).toBe("");
        expect(
          await page.evaluate(() => Reflect.get(window, "__readerController").currentReadingCfi()),
        ).toBe(before);
      } finally {
        await context.close();
      }
    });
  }
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
      await expect.poll(() => page.locator(READER_FRAME_SELECTOR).count()).toBe(1);
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
    await expect.poll(() => page.locator(READER_FRAME_SELECTOR).count()).toBe(1);
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
                Array.from(document.querySelectorAll("iframe")).filter(
                  (frame) => !frame.closest("[data-ambra-prefetched-turn]"),
                ).length - ctl.host.contentDocuments().length
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
    await expect.poll(() => page.locator(READER_FRAME_SELECTOR).count()).toBe(1);
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
    await expect.poll(() => page.locator(READER_FRAME_SELECTOR).count()).toBe(2);
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
    await dragForwardEdge(page);
    await page.waitForFunction(() => Reflect.get(window, "__operationGate").held);
    await page.evaluate(() => Reflect.get(window, "__operationGate").release(true));
    await page.waitForFunction(() => !Reflect.get(window, "__readerController").isTurningPage);
    await page.mouse.up();
    await expect(page.locator("[data-ambra-page-turn-input]")).toHaveCount(0);
    expect(
      await page.evaluate(() => Reflect.get(window, "__readerController").controlledTurn),
    ).toBeUndefined();
    await page.evaluate(() => Reflect.get(window, "__readerController").turnPage(1));
    expect(
      await page.evaluate(() => Reflect.get(window, "__readerController").host.currentPageIndex),
    ).toBe(1);
    await expect.poll(() => page.locator(READER_FRAME_SELECTOR).count()).toBe(1);
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
    await dragForwardEdge(page);
    await page.waitForFunction(() => Reflect.get(window, "__operationGate").held);
    await page.evaluate(() => {
      const ctl = Reflect.get(window, "__readerController");
      document.dispatchEvent(
        new PointerEvent("pointercancel", {
          pointerId: ctl.controlledTurn.start.pointerId,
        }),
      );
    });
    await page.evaluate(() => Reflect.get(window, "__operationGate").release());
    await page.waitForFunction(() => !Reflect.get(window, "__readerController").isTurningPage);
    await page.mouse.up();
    await expect(page.locator("[data-ambra-page-turn-input]")).toHaveCount(0);
    expect(
      await page.evaluate(() => Reflect.get(window, "__readerController").host.currentPageIndex),
    ).toBe(0);
    await expect.poll(() => page.locator(READER_FRAME_SELECTOR).count()).toBe(1);
    await page.evaluate(() => Reflect.get(window, "__readerController").turnPage(1));
    expect(
      await page.evaluate(() => Reflect.get(window, "__readerController").host.currentPageIndex),
    ).toBe(1);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
