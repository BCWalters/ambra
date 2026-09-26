import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";
import { navigationFixture } from "../navigation-fixture.js";
import { exposeReaderController } from "../reader-controller.js";

async function ready(page: Page) {
  await exposeReaderController(page);
  await page.waitForFunction(() => {
    const c = Reflect.get(window, "__readerController");
    return c?.host && !c.isLoadInFlight && !c.isApplyingLayout && !c.pendingLayout;
  });
}
async function focusBook(page: Page) {
  await page.evaluate(() => {
    const c = Reflect.get(window, "__readerController");
    for (const view of c.contentDocumentViews()) view.document.getSelection()?.removeAllRanges();
    c.restoreContentFocus();
  });
}
async function mod(page: Page) {
  return page.evaluate(() => /Mac|iPhone|iPad|iPod/i.test(navigator.platform) ? "Meta" : "Control");
}
const dialog = (page: Page, mode: "Page" | "Percentage") =>
  page.getByRole("dialog", { name: `Go to ${mode}`, exact: true });

async function finishModalMotion(page: Page) {
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations()
      .filter(animation => animation.effect?.getComputedTiming().endTime !== Infinity)
      .map(animation => animation.finished.catch(() => undefined)));
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
}

async function runExitFrameBeforeReactCommit(page: Page) {
  await page.evaluate(() => {
    const requestFrame = window.requestAnimationFrame;
    window.requestAnimationFrame = callback => {
      window.requestAnimationFrame = requestFrame;
      // React schedules the Fluent unmount with MessageChannel after the exit
      // callback. Deliver that work after the frame to exercise both legal orders.
      const postMessage = MessagePort.prototype.postMessage;
      const commits: Array<() => void> = [];
      MessagePort.prototype.postMessage = function (message: unknown, options?: Transferable[] | StructuredSerializeOptions) {
        const send = () => Reflect.apply(postMessage, this, [message, options]);
        if (message === null) commits.push(send);
        else send();
      };
      return requestFrame.call(window, time => {
        Reflect.set(window, "__goToExitFrame", {
          modal: !!document.querySelector('[aria-modal="true"]'),
          pendingCommits: commits.length,
        });
        try {
          callback(time);
        } finally {
          MessagePort.prototype.postMessage = postMessage;
          for (const commit of commits) commit();
        }
      });
    };
  });
}

async function readingCaret(page: Page) {
  return page.evaluate(() => {
    const c = Reflect.get(window, "__readerController");
    const view = c.contentDocumentViews().find((view: { document: Document }) =>
      view.document.defaultView?.frameElement === document.activeElement);
    const selection: Selection | undefined = view?.document.getSelection();
    if (!view || !selection?.anchorNode) return undefined;
    return {
      spine: view.spineIndex, text: selection.anchorNode.textContent, offset: selection.anchorOffset,
      collapsed: selection.isCollapsed,
      hidden: view.document.defaultView.frameElement.getAttribute("aria-hidden") === "true",
      cfi: c.locatorResolver.generate(view.spineIndex, selection.anchorNode, selection.anchorOffset).cfi,
    };
  });
}

test("Go to shortcuts seek pages and percentages, retain focus, and explain scrolling without switching mode", async ({ browserName }, info) => {
  expect(browserName).toBe("chromium");
  const { context, readerPage: page } = await launchReader(navigationFixture(info, [3, 4, 3]));
  try {
    await ready(page);
    const modifier = await mod(page);
    await page.waitForFunction(() => Reflect.get(window, "__readerController").snapshot().bookPageCount > 0);
    const count = await page.evaluate(() => Reflect.get(window, "__readerController").snapshot().bookPageCount as number);
    for (const [mode, value, expectedPage] of [
      ["Page", String(count), count],
      ["Page", "1", 1],
      ["Percentage", "50", Math.max(1, Math.round(count * 0.5))],
    ] as const) {
      await focusBook(page);
      await page.keyboard.press(`${modifier}+${mode === "Percentage" ? "Shift+" : ""}g`);
      const modal = dialog(page, mode);
      await expect(modal).toBeVisible();
      await expect(modal).toHaveAttribute("aria-keyshortcuts", `${modifier}+${mode === "Percentage" ? "Shift+" : ""}G`);
      const input = modal.getByRole("spinbutton");
      await expect(input).toBeFocused();
      await input.fill(value);
      await page.screenshot({ path: info.outputPath(`go-to-${mode.toLowerCase()}-${value}.png`), animations: "disabled" });
      await input.press("Enter");
      await expect(modal).toBeHidden();
      await expect.poll(() => page.evaluate(() => Reflect.get(window, "__readerController").snapshot().bookPageIndex)).toBe(expectedPage);
      await expect.poll(() => page.evaluate(() => document.activeElement instanceof HTMLIFrameElement)).toBe(true);
    }

    await focusBook(page);
    await page.keyboard.press(`${modifier}+g`);
    const pageInput = dialog(page, "Page").getByRole("spinbutton");
    await expect(pageInput).toBeFocused();
    await pageInput.fill(String(count + 1));
    await expect(dialog(page, "Page").getByRole("button", { name: "Go", exact: true })).toBeDisabled();
    await pageInput.press("Enter");
    await expect(dialog(page, "Page")).toBeVisible();
    await pageInput.press("Escape");
    await expect(dialog(page, "Page")).toBeHidden();

    await page.keyboard.press("Alt+Shift+PageDown");
    await expect.poll(() => page.evaluate(() => Reflect.get(window, "__readerController").snapshot().viewMode)).toBe("scroll");
    await ready(page);
    for (const mode of ["Page", "Percentage"] as const) {
      await focusBook(page);
      await page.keyboard.press(`${modifier}+${mode === "Percentage" ? "Shift+" : ""}g`);
      await expect(dialog(page, mode)).toContainText("Go to requires paginated mode.");
      await expect(dialog(page, mode).getByRole("spinbutton")).toHaveCount(0);
      await expect(dialog(page, mode).getByRole("button", { name: "Go", exact: true })).toBeDisabled();
      await page.keyboard.press("Escape");
      await expect(dialog(page, mode)).toBeHidden();
      expect(await page.evaluate(() => Reflect.get(window, "__readerController").snapshot().viewMode)).toBe("scroll");
    }

    await focusBook(page);
    await page.keyboard.press(`${modifier}+/`);
    const guide = page.getByRole("dialog", { name: "Keyboard shortcuts", exact: true });
    await expect(guide.getByText("Go to page", { exact: true })).toBeVisible();
    await expect(guide.getByText("Go to percentage", { exact: true })).toBeVisible();
    const enabled = guide.getByRole("checkbox", { name: "Enable keyboard shortcuts" });
    await enabled.click();
    await expect(guide.getByRole("status")).toHaveText("Shortcut settings saved.");
    await expect(enabled).not.toBeChecked();
    await page.keyboard.press("Escape");
    await focusBook(page);
    await page.keyboard.press(`${modifier}+g`);
    await page.keyboard.press(`${modifier}+Shift+g`);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("A late Go to exit preserves the shortcut guide's focus and accessibility ownership", async ({ browserName }, info) => {
  expect(browserName).toBe("chromium");
  const { context, readerPage: page } = await launchReader(navigationFixture(info, [3, 4]));
  try {
    await ready(page);
    const modifier = await mod(page);
    await focusBook(page);
    await page.keyboard.press(`${modifier}+Shift+g`);
    await expect(dialog(page, "Percentage").getByRole("spinbutton")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog(page, "Percentage")).toBeHidden();
    await focusBook(page);
    await page.keyboard.press(`${modifier}+/`);
    const guide = page.getByRole("dialog", { name: "Keyboard shortcuts", exact: true });
    await expect(guide).toBeVisible();
    await finishModalMotion(page);
    await expect(guide.getByRole("button", { name: "Close", exact: true })).toBeFocused();
    const enabled = guide.getByRole("checkbox", { name: "Enable keyboard shortcuts" });
    await enabled.click();
    await expect(guide.getByRole("status")).toHaveText("Shortcut settings saved.");
    await expect(enabled).not.toBeChecked();
    await expect(enabled).toBeFocused();
  } finally {
    await context.close();
  }
});

test("A late Go to exit preserves a newly opened Settings menu and its focus", async ({ browserName }, info) => {
  expect(browserName).toBe("chromium");
  const { context, readerPage: page } = await launchReader(navigationFixture(info, [3, 4]));
  try {
    await ready(page);
    await focusBook(page);
    await page.keyboard.press(`${await mod(page)}+Shift+g`);
    await expect(dialog(page, "Percentage").getByRole("spinbutton")).toBeFocused();
    await page.evaluate(() => {
      const requestFrame = window.requestAnimationFrame;
      window.requestAnimationFrame = callback => {
        window.requestAnimationFrame = requestFrame;
        return requestFrame.call(window, time => {
          Reflect.set(window, "__finishGoToExit", () => callback(time));
        });
      };
    });
    await page.keyboard.press("Escape");
    await expect(dialog(page, "Percentage")).toHaveCount(0);
    await page.waitForFunction(() => Reflect.has(window, "__finishGoToExit"));
    await page.mouse.move(10, 2);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem").first()).toBeFocused();
    await page.evaluate(() => Reflect.get(window, "__finishGoToExit")());
    await finishModalMotion(page);
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem").first()).toBeFocused();
    await menu.getByRole("menuitem", { name: "Help & About", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Help & About", exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
});

for (const destination of [
  { page: 2, spine: 0, localPage: 1, text: "C1Para 2.", name: "same-chapter" },
  { page: 4, spine: 1, localPage: 0, text: "C2Para 1.", name: "cross-chapter" },
]) {
  test(`Go to focuses the exact right-hand ${destination.name} page and Cancel retains its caret`, async ({ browserName }, info) => {
    expect(browserName).toBe("chromium");
    const { context, readerPage: page } = await launchReader(navigationFixture(info, [3, 4, 3]), {
      viewport: { width: 1400, height: 900 },
    });
    try {
      await ready(page);
      await page.waitForFunction(() => Reflect.get(window, "__readerController").snapshot().bookPageCount === 10);
      const modifier = await mod(page);
      for (const mode of ["Page", "Percentage"] as const) {
        await focusBook(page);
        await page.keyboard.press(`${modifier}+${mode === "Percentage" ? "Shift+" : ""}g`);
        const input = dialog(page, mode).getByRole("spinbutton");
        await input.fill(String(destination.page * (mode === "Percentage" ? 10 : 1)));
        await input.press("Enter");
        await expect(dialog(page, mode)).toBeHidden();
        await ready(page);
        await finishModalMotion(page);
        expect(await page.evaluate(() => Reflect.get(window, "__readerController").host.positions.second))
          .toEqual({ spineIndex: destination.spine, pageIndex: destination.localPage });
        expect(await readingCaret(page)).toMatchObject({
          spine: destination.spine, text: destination.text, offset: 0, collapsed: true, hidden: false,
        });

        await page.evaluate(() => {
          const c = Reflect.get(window, "__readerController");
          const doc = (document.activeElement as HTMLIFrameElement).contentDocument!;
          const selection = doc.getSelection()!;
          const node = selection.anchorNode!;
          const text = node.nodeType === Node.TEXT_NODE ? node
            : doc.createTreeWalker(node, NodeFilter.SHOW_TEXT).nextNode()!;
          selection.collapse(text, 3);
          c.nativeReading.current();
        });
        const original = await readingCaret(page);
        await page.keyboard.press(`${modifier}+g`);
        await dialog(page, "Page").getByRole("spinbutton").fill("1");
        await page.keyboard.press("Escape");
        await expect(dialog(page, "Page")).toBeHidden();
        await finishModalMotion(page);
        expect(await readingCaret(page)).toEqual(original);
      }
    } finally {
      await context.close();
    }
  });
}

for (const destination of [
  { page: 2, spine: 0, text: "C1Para 2.", name: "same chapter" },
  { page: 6, spine: 1, text: "C2Para 2.", name: "new chapter" },
].flatMap(destination => [
  { ...destination, frameBeforeCommit: false },
  { ...destination, name: `${destination.name}, frame before unmount`, frameBeforeCommit: true },
])) {
  test(`Go to enters the right-page destination once after modal exit (${destination.name})`, async ({ browserName }, info) => {
    expect(browserName).toBe("chromium");
    const { context, readerPage: page } = await launchReader(navigationFixture(info, [4, 4]), {
      viewport: { width: 1400, height: 900 },
    });
    try {
      await ready(page);
      await page.waitForFunction(() => Reflect.get(window, "__readerController").snapshot().bookPageCount === 8);
      await focusBook(page);
      await page.keyboard.press(`${await mod(page)}+g`);
      await page.evaluate(() => {
        const c = Reflect.get(window, "__readerController");
        const calls: Array<{ modal: boolean; text: string | null }> = [];
        Reflect.set(window, "__readingFocusCalls", calls);
        const original = c.accessibility.focusReadingPosition.bind(c.accessibility);
        c.accessibility.focusReadingPosition = (doc: Document, position: { node: Node; offset?: number }) => {
          const target = position.node.nodeType === Node.ELEMENT_NODE
            ? position.node.childNodes[position.offset ?? 0] ?? position.node : position.node;
          calls.push({
            modal: !!document.querySelector('[aria-modal="true"]'),
            text: target.textContent,
          });
          return original(doc, position);
        };
      });
      const input = dialog(page, "Page").getByRole("spinbutton");
      await input.fill(String(destination.page));
      if (destination.frameBeforeCommit) await runExitFrameBeforeReactCommit(page);
      await input.press("Enter");
      await expect(dialog(page, "Page")).toBeHidden();
      await finishModalMotion(page);
      if (destination.frameBeforeCommit) {
        const frame = await page.evaluate(() => Reflect.get(window, "__goToExitFrame"));
        expect(frame.modal).toBe(true);
        expect(frame.pendingCommits).toBeGreaterThan(0);
      }
      const calls = await page.evaluate(() => Reflect.get(window, "__readingFocusCalls"));
      const evidence = info.outputPath("go-to-focus-lifecycle.json");
      await writeFile(evidence, JSON.stringify(calls, null, 2));
      await info.attach("go-to-focus-lifecycle", { path: evidence, contentType: "application/json" });
      expect(calls).toEqual([{ modal: false, text: destination.text }]);
      expect(await readingCaret(page)).toMatchObject({
        spine: destination.spine, text: destination.text, offset: 0, collapsed: true, hidden: false,
      });
    } finally {
      await context.close();
    }
  });
}

test("Go to returns focus after an in-flight navigation finishes following dismissal", async ({ browserName }, info) => {
  expect(browserName).toBe("chromium");
  const { context, readerPage: page } = await launchReader(navigationFixture(info, [4, 4]), {
    viewport: { width: 1400, height: 900 },
  });
  try {
    await ready(page);
    await page.waitForFunction(() => Reflect.get(window, "__readerController").snapshot().bookPageCount === 8);
    await page.evaluate(() => {
      const c = Reflect.get(window, "__readerController");
      Reflect.set(window, "__previousHost", c.host);
      const original = c.seekToFraction.bind(c);
      c.seekToFraction = async (...args: unknown[]) => {
        await new Promise<void>(resolve => Reflect.set(window, "__releaseSeek", resolve));
        return original(...args);
      };
    });
    await focusBook(page);
    await page.keyboard.press(`${await mod(page)}+g`);
    const modal = dialog(page, "Page");
    await modal.getByRole("spinbutton").fill("6");
    await modal.getByRole("spinbutton").press("Enter");
    await expect(modal.getByRole("spinbutton")).toHaveAttribute("readonly", "");
    await modal.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(modal).toBeHidden();
    await finishModalMotion(page);
    await page.evaluate(() => Reflect.get(window, "__releaseSeek")());
    await page.waitForFunction(() => Reflect.get(window, "__readerController").host !== Reflect.get(window, "__previousHost"));
    await ready(page);
    expect(await readingCaret(page)).toMatchObject({
      spine: 1, text: "C2Para 2.", offset: 0, collapsed: true, hidden: false,
    });
  } finally {
    await context.close();
  }
});

test("Go to retains the exact right-page text boundary in the accessible chapter", async ({ browserName }, info) => {
  expect(browserName).toBe("chromium");
  const native = process.env.AMBRA_NATIVE_ACCESSIBILITY === "1";
  if (native) {
    expect(process.platform).toBe("darwin");
    expect(process.env.AMBRA_E2E_HEADLESS).not.toBe("1");
    const helper = fileURLToPath(new URL("../scripts/native-reader-shortcut.swift", import.meta.url));
    const prerequisites = JSON.parse(execFileSync("swift", [helper, "--check"], { encoding: "utf8" }));
    test.skip(prerequisites.locked || !prerequisites.accessibilityTrusted, "Native AX requires existing permission and an unlocked desktop");
  }
  const fixture = fileURLToPath(new URL("../fixtures/long-content.epub", import.meta.url));
  const { context, readerPage: page } = await launchReader(fixture, {
    viewport: { width: 1400, height: 900 }, forceAccessibility: native,
  });
  try {
    await ready(page);
    await page.waitForFunction(() => Reflect.get(window, "__readerController").snapshot().bookPageCount > 1);
    const expected = await page.evaluate(() => {
      const c = Reflect.get(window, "__readerController");
      const right = c.contentDocumentViews().find((view: { physicalSide: string }) => view.physicalSide === "right");
      if (right?.spineIndex !== 0 || right.page?.index !== 1) throw new Error("Expected the second page on the right");
      let { node, offset = 0 }: { node: Node; offset?: number } = right.page.startBreak;
      if (node.nodeType === Node.ELEMENT_NODE && node.childNodes[offset]) {
        node = node.childNodes[offset]!;
        offset = 0;
      }
      return {
        spine: right.spineIndex, text: node.textContent, offset,
        cfi: c.locatorResolver.generate(right.spineIndex, node, offset).cfi,
      };
    });
    expect(expected.text).not.toBe((await readingCaret(page))?.text);
    await page.keyboard.press(`${await mod(page)}+g`);
    const input = dialog(page, "Page").getByRole("spinbutton");
    await input.fill("2");
    await input.press("Enter");
    await expect(dialog(page, "Page")).toBeHidden();
    await finishModalMotion(page);
    expect(await readingCaret(page)).toEqual({ ...expected, collapsed: true, hidden: false });

    if (native) {
      const browser = context.browser();
      if (!browser) throw new Error("Owned test browser unavailable");
      const client = await browser.newBrowserCDPSession();
      const { processInfo } = await client.send("SystemInfo.getProcessInfo");
      const pid = processInfo.find(process => process.type === "browser")?.id;
      if (!pid) throw new Error("Owned test browser PID unavailable");
      await page.bringToFront();
      execFileSync("osascript", ["-e",
        `tell application "System Events" to set frontmost of (first process whose unix id is ${pid}) to true`,
      ]);
      const url = await page.evaluate(() => (document.activeElement as HTMLIFrameElement).contentDocument!.URL);
      const helper = fileURLToPath(new URL("../scripts/native-reading-focus.swift", import.meta.url));
      const result = JSON.parse(execFileSync("swift", [helper, String(pid)], { encoding: "utf8", timeout: 20_000 })).after;
      const evidence = info.outputPath("native-go-to-destination.json");
      await writeFile(evidence, JSON.stringify({ expected, result }, null, 2));
      await info.attach("native-go-to-destination", {
        path: evidence, contentType: "application/json",
      });
      expect(result).toMatchObject({
        focusPid: pid, frontmostPid: pid, focused: true, webAreaURL: url,
        selectionOwnerURL: url, selectionOwnerRole: "AXStaticText", selectionCollapsed: true,
        selectionIndex: expected.offset,
      });
      expect(result.selectionOwnerText.trim()).toBe(expected.text!.trim());
    }
  } finally {
    await context.close();
  }
});

test("Go to leaves editing, selections, widgets, and other modals in charge of keyboard input", async ({ browserName }, info) => {
  expect(browserName).toBe("chromium");
  const { context, readerPage: page } = await launchReader(navigationFixture(info, [3, 4]));
  try {
    await ready(page);
    const modifier = await mod(page);
    const toolbarButton = page.getByRole("button", { name: "Book details", exact: true });
    for (const mode of ["Page", "Percentage"] as const) {
      await toolbarButton.focus();
      await page.keyboard.press(`${modifier}+${mode === "Percentage" ? "Shift+" : ""}g`);
      await expect(dialog(page, mode)).toBeVisible();
      await expect(dialog(page, mode).getByRole("spinbutton")).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(dialog(page, mode)).toBeHidden();
      await expect.poll(() => page.evaluate(() => document.activeElement instanceof HTMLIFrameElement)).toBe(true);
    }
    for (const kind of ["input", "textarea", "select", "button", "slider", "contenteditable", "selection"]) {
      await page.evaluate(kind => {
        const doc = Reflect.get(window, "__readerController").contentDocumentViews()[0].document as Document;
        doc.getSelection()?.removeAllRanges();
        doc.getElementById("goto-keyboard-owner")?.remove();
        const element = doc.createElement(["slider", "contenteditable", "selection"].includes(kind) ? "div" : kind);
        element.id = "goto-keyboard-owner";
        element.tabIndex = 0;
        if (kind === "slider") element.setAttribute("role", "slider");
        if (kind === "contenteditable") element.contentEditable = "true";
        element.textContent = "Native keyboard owner";
        doc.body.prepend(element);
        element.focus();
        if (kind === "selection") doc.getSelection()!.selectAllChildren(element);
      }, kind);
      await page.keyboard.press(`${modifier}+g`);
      await page.keyboard.press(`${modifier}+Shift+g`);
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }
    await focusBook(page);
    await page.keyboard.press(`${modifier}+/`);
    const guide = page.getByRole("dialog", { name: "Keyboard shortcuts", exact: true });
    await expect(guide).toBeVisible();
    await page.keyboard.press(`${modifier}+g`);
    await page.keyboard.press(`${modifier}+Shift+g`);
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(guide).toBeVisible();
  } finally {
    await context.close();
  }
});

test("Go to retains keyboard focus during pending seeks and after failure", async ({ browserName }, info) => {
  expect(browserName).toBe("chromium");
  const { context, readerPage: page } = await launchReader(navigationFixture(info, [3, 4]));
  try {
    await ready(page);
    const modifier = await mod(page);
    await page.waitForFunction(() => Reflect.get(window, "__readerController").snapshot().bookPageCount > 0);
    await page.evaluate(() => {
      const controller = Reflect.get(window, "__readerController");
      controller.seekToFraction = () => new Promise<void>((_resolve, reject) => {
        Reflect.set(window, "__rejectGoToSeek", () => reject(new Error("Fixture seek failure")));
        Reflect.set(window, "__goToSeekCalls", (Reflect.get(window, "__goToSeekCalls") ?? 0) + 1);
      });
    });
    for (const [mode, target] of [["Page", "input"], ["Percentage", "submit"]] as const) {
      await focusBook(page);
      await page.keyboard.press(`${modifier}+${mode === "Percentage" ? "Shift+" : ""}g`);
      const modal = dialog(page, mode);
      const input = modal.getByRole("spinbutton");
      const go = modal.getByRole("button", { name: "Go", exact: true });
      await expect(input).toBeFocused();
      await input.fill("1");
      const control = target === "input" ? input : go;
      if (target === "submit") {
        await input.press("Tab");
        await expect(modal.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
        await page.keyboard.press("Tab");
        await expect(go).toBeFocused();
      }
      const callsBefore = await page.evaluate(() => Reflect.get(window, "__goToSeekCalls") ?? 0);
      await control.press("Enter");
      await expect(input).toHaveAttribute("readonly", "");
      await expect(control).toHaveAttribute("aria-disabled", "true");
      await expect(control).toBeFocused();
      await control.press("Enter");
      expect(await page.evaluate(() => Reflect.get(window, "__goToSeekCalls"))).toBe(callsBefore + 1);
      await page.evaluate(() => Reflect.get(window, "__rejectGoToSeek")());
      await expect(modal.getByRole("alert")).toHaveText("Could not go to that position. Please try again.");
      await expect(control).toBeFocused();
      await expect(input).not.toHaveAttribute("readonly", "");
      await expect(go).toBeEnabled();
      await control.press("Escape");
      await expect(modal).toBeHidden();
    }
  } finally {
    await context.close();
  }
});

test("Go to explains fixed-layout unavailability without moving the book", async () => {
  const book = fileURLToPath(new URL("../fixtures/fxl-spread-ltr.epub", import.meta.url));
  const { context, readerPage: page } = await launchReader(book);
  try {
    await ready(page);
    const modifier = await mod(page);
    const before = await page.evaluate(() => Reflect.get(window, "__readerController").snapshot().spineIndex);
    for (const mode of ["Page", "Percentage"] as const) {
      await focusBook(page);
      await page.keyboard.press(`${modifier}+${mode === "Percentage" ? "Shift+" : ""}g`);
      await expect(dialog(page, mode)).toContainText("Go to is unavailable for fixed-layout content.");
      await expect(dialog(page, mode).getByRole("button", { name: "Go", exact: true })).toBeDisabled();
      await page.keyboard.press("Escape");
      await expect(dialog(page, mode)).toBeHidden();
    }
    expect(await page.evaluate(() => Reflect.get(window, "__readerController").snapshot().spineIndex)).toBe(before);
  } finally {
    await context.close();
  }
});
