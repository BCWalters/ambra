import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

const fixture = fileURLToPath(new URL("../fixtures/reading-boundaries.epub", import.meta.url));
const keyboardHelper = fileURLToPath(new URL("../scripts/native-reader-shortcut.swift", import.meta.url));
const readingHelper = fileURLToPath(new URL("../scripts/native-reading-focus.swift", import.meta.url));

interface NativeFocus { pid: number; role: string; focused: boolean }
interface Delivery {
  pid: number;
  shortcut: string;
  frontmostPid: number;
  before: NativeFocus;
  after: NativeFocus;
}

function swift(helper: string, ...args: string[]) {
  return JSON.parse(execFileSync("swift", [helper, ...args], { encoding: "utf8", timeout: 20_000 }));
}

async function settled(page: Page) {
  await page.waitForFunction(() => {
    const c = Reflect.get(window, "__readerController");
    return c?.host && !c.isApplyingLayout && !c.isLoadInFlight && !c.isTurningPage && !c.pendingLayout;
  });
}

async function readingState(page: Page) {
  return page.evaluate(() => {
    const c = Reflect.get(window, "__readerController");
    const view = c.contentDocumentViews().find((view: { document: Document }) =>
      view.document.defaultView?.frameElement === document.activeElement);
    if (!view) return undefined;
    const doc: Document = view.document;
    const selection = doc.getSelection();
    if (!selection?.anchorNode) return undefined;
    return {
      spine: view.spineIndex as number, url: doc.URL,
      text: selection.anchorNode.textContent, offset: selection.anchorOffset,
      cfi: c.locatorResolver.generate(view.spineIndex, selection.anchorNode, selection.anchorOffset).cfi as string,
      mode: c.snapshot().viewMode as string,
    };
  });
}

// These CGEvents go through the owned macOS application's native keyboard path,
// not CDP keyboard dispatch. Native AX markers still do not prove VoiceOver speech.
test("native macOS shortcuts preserve reading ownership through modes, sections, help and search", async () => {
  test.skip(process.env.AMBRA_NATIVE_ACCESSIBILITY !== "1", "Opt-in native macOS accessibility automation");
  test.setTimeout(180_000);
  expect(process.platform).toBe("darwin");
  expect(process.env.AMBRA_E2E_HEADLESS).not.toBe("1");
  const prerequisites = swift(keyboardHelper, "--check");
  test.skip(prerequisites.locked, "Native keyboard validation requires an unlocked desktop");
  test.skip(!prerequisites.accessibilityTrusted || !prerequisites.eventPostingAllowed,
    "Existing accessibility and native event-posting permissions are required");
  const { context, readerPage: page } = await launchReader(fixture, {
    viewport: { width: 1400, height: 900 }, forceAccessibility: true,
  });
  const evidence: unknown[] = [{ prerequisites }];
  try {
    await exposeReaderController(page);
    await settled(page);
    await page.bringToFront();
    const browser = context.browser();
    if (!browser) throw new Error("Owned test browser unavailable");
    const client = await browser.newBrowserCDPSession();
    const { processInfo } = await client.send("SystemInfo.getProcessInfo");
    const pid = processInfo.find(process => process.type === "browser")?.id;
    if (!pid) throw new Error("Owned test browser PID unavailable");
    execFileSync("osascript", ["-e",
      `tell application "System Events" to set frontmost of (first process whose unix id is ${pid}) to true`,
    ]);
    await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true);

    const send = (shortcut: string) => {
      const result: Delivery = swift(keyboardHelper, String(pid), shortcut);
      evidence.push(result);
      expect(result).toMatchObject({ pid, frontmostPid: pid, before: { pid, focused: true } });
      return result;
    };
    const expectReading = async (spine: number, cfi?: string) => {
      await settled(page);
      await expect.poll(async () => (await readingState(page))?.spine).toBe(spine);
      const state = (await readingState(page))!;
      if (cfi) expect(state.cfi).toBe(cfi);
      const native = swift(readingHelper, String(pid)).after;
      evidence.push({ state, native });
      expect(native).toMatchObject({
        focusPid: pid, frontmostPid: pid, focused: true,
        webAreaURL: state.url, selectionOwnerURL: state.url,
        selectionOwnerText: state.text, selectionCollapsed: true, selectionIndex: state.offset,
      });
      return state;
    };
    await expectReading(0);
    await page.evaluate(() => {
      const c = Reflect.get(window, "__readerController");
      const doc = c.contentDocumentViews().find((view: { spineIndex: number }) => view.spineIndex === 0).document;
      doc.getSelection().collapse(doc.querySelector("p").firstChild, 9);
    });
    const original = await expectReading(0);

    for (const [shortcut, mode] of [
      ["Option+Shift+PageDown", "scroll"], ["Option+Shift+PageUp", "paginated"],
    ]) {
      send(shortcut!);
      await expect.poll(() => page.evaluate(() =>
        Reflect.get(window, "__readerController").snapshot().viewMode)).toBe(mode);
      const first = await expectReading(0, original.cfi);
      send(shortcut!);
      const repeated = await expectReading(0, original.cfi);
      expect(repeated.url).toBe(first.url);
      expect(repeated.mode).toBe(mode);
    }

    send("Command+B");
    await expect.poll(() => page.evaluate(() =>
      Reflect.get(window, "__readerController").snapshot().bookmarks.length)).toBe(1);
    send("Command+B");
    await expect.poll(() => page.evaluate(() =>
      Reflect.get(window, "__readerController").snapshot().bookmarks.length)).toBe(0);
    await expectReading(0, original.cfi);

    send("Command+F");
    const search = page.getByRole("searchbox", { name: "Search this book…" });
    await expect(search).toBeFocused();
    const fromSearch = send("Escape");
    expect(fromSearch.before.role).toBe("AXTextField");
    await expect(search).toBeHidden();
    await expectReading(0, original.cfi);

    send("Command+/");
    const help = page.getByRole("dialog", { name: "Keyboard shortcuts", exact: true });
    await expect(help).toBeVisible();
    expect(await help.evaluate(element => element.contains(document.activeElement))).toBe(true);
    send("Escape");
    await expect(help).toBeHidden();
    await expectReading(0, original.cfi);

    // The initial visual primary is spine 1, but the reading source is spine 0.
    for (const [shortcut, spine] of [
      ["Option+PageDown", 1], ["Option+PageDown", 2], ["Option+PageUp", 1], ["Option+PageUp", 0],
    ] as const) {
      send(shortcut);
      await expectReading(spine);
    }
  } finally {
    try {
      const file = test.info().outputPath("native-shortcut-evidence.json");
      await writeFile(file, JSON.stringify(evidence, null, 2));
      await test.info().attach("native-shortcut-evidence", { path: file, contentType: "application/json" });
    } finally {
      await context.close();
    }
  }
});
