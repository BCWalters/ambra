import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures");

test("native macOS accessibility activation transfers reading focus between spread documents", async () => {
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
    execFileSync("osascript", ["-e",
      `tell application "System Events" to set frontmost of (first process whose unix id is ${browserProcess.id}) to true`,
    ]);
    await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true);
    const result = execFileSync("swift", ["-e", `
      import ApplicationServices
      import Foundation
      func fail(_ message: String) -> Never {
        fputs(message + "\\n", stderr)
        exit(1)
      }
      guard AXIsProcessTrusted() else { fail("Existing accessibility permission required") }
      let app = AXUIElementCreateApplication(${browserProcess.id})
      func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
        var value: CFTypeRef?
        AXUIElementCopyAttributeValue(element, name as CFString, &value)
        return value
      }
      func find(_ element: AXUIElement, _ depth: Int = 0) -> AXUIElement? {
        if depth > 40 { return nil }
        let role = attribute(element, kAXRoleAttribute) as? String
        let title = attribute(element, kAXTitleAttribute) as? String
        let description = attribute(element, kAXDescriptionAttribute) as? String
        if role == kAXButtonRole && (title == "Next section" || description == "Next section") {
          return element
        }
        for child in attribute(element, kAXChildrenAttribute) as? [AXUIElement] ?? [] {
          if let found = find(child, depth + 1) { return found }
        }
        return nil
      }
      var target: AXUIElement?
      for _ in 0..<50 {
        target = find(app)
        if target != nil { break }
        usleep(100000)
      }
      guard let button = target else { fail("Native Next section button not found") }
      let result = AXUIElementPerformAction(button, kAXPressAction as CFString)
      guard result == .success else { fail("AXPress failed: \\(result)") }
      print("AXPress succeeded")
    `], { encoding: "utf8" });
    expect(result).toContain("AXPress succeeded");
    await expect.poll(() => page.evaluate(() => {
      const controller = Reflect.get(window, "__readerController");
      return controller.contentDocumentViews().find((view: { document: Document }) =>
        view.document.defaultView?.frameElement === document.activeElement,
      )?.spineIndex;
    })).toBe(1);
    expect(await page.evaluate(() => {
      const controller = Reflect.get(window, "__readerController");
      const view = controller.contentDocumentViews().find((view: { spineIndex: number }) => view.spineIndex === 1);
      const doc = view.document as Document;
      return {
        inPublication: doc.activeElement?.getRootNode() === doc && !doc.activeElement.hasAttribute("data-ambra-boundary"),
        caretInPublication: doc.getSelection()?.anchorNode?.getRootNode() === doc,
      };
    })).toEqual({ inPublication: true, caretInPublication: true });
  } finally {
    await context.close();
  }
});
