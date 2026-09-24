import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(here, "../fixtures");
const nativeProbe = path.resolve(here, "../scripts/native-reading-focus.swift");

interface NativeState {
  focusPid: number;
  frontmostPid: number;
  focused: boolean;
  focusRole: string;
  focusTitle: string;
  webAreaURL: string;
  selectionOwnerURL: string;
  selectionOwnerRole: string;
  selectionOwnerText: string;
  selectionCollapsed: boolean;
  selectionIndex: number;
}

function probe(pid: number, sourceURL?: string): { before: NativeState; after: NativeState } {
  return JSON.parse(execFileSync("swift", [nativeProbe, String(pid), ...(sourceURL ? [sourceURL] : [])],
    { encoding: "utf8", timeout: 20_000 }));
}

async function readingState(page: Page, spineIndex: number) {
  return page.evaluate(spineIndex => {
    const controller = Reflect.get(window, "__readerController");
    const doc = controller.contentDocumentViews()
      .find((view: { spineIndex: number }) => view.spineIndex === spineIndex).document as Document;
    const selection = doc.getSelection()!;
    return {
      url: doc.URL,
      text: doc.querySelector("p")!.textContent!,
      offset: selection.anchorOffset,
      focusedFrame: doc.defaultView?.frameElement === document.activeElement,
      inPublication: doc.activeElement?.getRootNode() === doc && !doc.activeElement.hasAttribute("data-ambra-boundary"),
      caretInPublication: selection.anchorNode?.getRootNode() === doc,
    };
  }, spineIndex);
}

function expectNative(state: NativeState, pid: number, expected: { url: string; text: string; offset: number }) {
  expect(state).toMatchObject({
    focusPid: pid,
    frontmostPid: pid,
    focused: true,
    webAreaURL: expected.url,
    selectionOwnerURL: expected.url,
    selectionOwnerRole: "AXStaticText",
    selectionOwnerText: expected.text,
    selectionCollapsed: true,
    selectionIndex: expected.offset,
  });
}

// Native AX focus/text markers are stronger evidence than DOM focus, but do not
// expose or prove VoiceOver's private virtual cursor or spoken reading position.
test("native macOS reading focus and selection enter, cross a same-spread boundary, and resume", async () => {
  test.skip(process.env.AMBRA_NATIVE_ACCESSIBILITY !== "1", "Opt-in macOS accessibility automation");
  test.setTimeout(90_000);
  expect(process.platform).toBe("darwin");
  expect(process.env.AMBRA_E2E_HEADLESS).not.toBe("1");
  const locked = execFileSync("swift", ["-e", `
    import CoreGraphics
    let session = CGSessionCopyCurrentDictionary() as? [String: Any]
    print(session?["CGSSessionScreenIsLocked"] as? Bool ?? false)
  `], { encoding: "utf8" }).trim() === "true";
  test.skip(locked, "Native macOS accessibility requires an unlocked desktop");
  const { context, readerPage: page } = await launchReader(path.join(fixtures, "reading-boundaries.epub"), {
    viewport: { width: 1400, height: 900 },
    forceAccessibility: true,
  });
  try {
    await exposeReaderController(page);
    const beforeWindowResize = await page.evaluate(async () => {
      const controller = Reflect.get(window, "__readerController");
      return {
        spineIndex: controller.spineIndex,
        focusedSpine: controller.contentDocumentViews().find((view: { document: Document }) =>
          view.document.defaultView?.frameElement === document.activeElement,
        )?.spineIndex,
        progress: (await controller.library.getProgress(controller.bookId))?.cfi,
      };
    });
    expect(beforeWindowResize.focusedSpine).toBe(0);
    const pageClient = await context.newCDPSession(page);
    const { windowId } = await pageClient.send("Browser.getWindowForTarget");
    await pageClient.send("Browser.setWindowBounds", {
      windowId, bounds: { left: 80, top: 80, width: 1400, height: 1000 },
    });
    await page.bringToFront();
    const browser = context.browser();
    if (!browser) throw new Error("Browser unavailable for native accessibility test");
    const client = await browser.newBrowserCDPSession();
    const { processInfo } = await client.send("SystemInfo.getProcessInfo");
    const browserProcess = processInfo.find(process => process.type === "browser");
    if (!browserProcess) throw new Error("Browser process unavailable for native accessibility test");
    const pid = browserProcess.id;
    execFileSync("osascript", ["-e",
      `tell application "System Events" to set frontmost of (first process whose unix id is ${pid}) to true`,
    ]);
    await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true);
    const initialSpine = await page.evaluate(() => {
      const controller = Reflect.get(window, "__readerController");
      return controller.contentDocumentViews().find((view: { document: Document }) =>
        view.document.defaultView?.frameElement === document.activeElement,
      )?.spineIndex;
    });
    expect(initialSpine).toBe(0);
    const initial = await readingState(page, initialSpine);
    const initialEntry = probe(pid);
    expectNative(initialEntry.after, pid, initial);

    // The source must already own entry focus; manually resetting it here would
    // hide a regression where a new spread starts reading its second chapter.
    const source = await readingState(page, 0);
    expect(source.focusedFrame).toBe(true);
    const entry = probe(pid);
    expectNative(entry.after, pid, source);

    const handoff = probe(pid, source.url);
    expectNative(handoff.before, pid, source);
    await expect.poll(async () => (await readingState(page, 1)).focusedFrame).toBe(true);
    const destination = await readingState(page, 1);
    expect(destination).toMatchObject({ inPublication: true, caretInPublication: true });
    expect(destination.url).not.toBe(source.url);
    expectNative(handoff.after, pid, destination);
    expect(await page.evaluate(() => Reflect.get(window, "__readerController").contentDocumentViews()
      .map((view: { document: Document }) => view.document.URL))).toEqual([source.url, destination.url]);

    await page.evaluate(async () => {
      const controller = Reflect.get(window, "__readerController");
      const doc = controller.contentDocumentViews().find((view: { spineIndex: number }) => view.spineIndex === 1).document;
      doc.getSelection().collapse(doc.querySelector("p").firstChild, 9);
      await controller.flushProgress();
    });
    await page.reload();
    await page.waitForFunction(() => [...document.querySelectorAll("iframe")]
      .some(frame => frame.contentDocument?.body?.querySelector("p")));
    await exposeReaderController(page);
    await page.waitForFunction(() => !Reflect.get(window, "__readerController").isLoadInFlight);
    const restored = await readingState(page, 1);
    expect(restored).toMatchObject({ offset: 9, focusedFrame: true, inPublication: true, caretInPublication: true });
    const resume = probe(pid);
    expectNative(resume.after, pid, restored);
    const evidence = test.info().outputPath("native-focus-and-selection.json");
    await writeFile(evidence,
      JSON.stringify({ pid, beforeWindowResize, initial, source, destination, restored, initialEntry, entry, handoff, resume }, null, 2));
    await test.info().attach("native-focus-and-selection", { path: evidence, contentType: "application/json" });
  } finally {
    await context.close();
  }
});
