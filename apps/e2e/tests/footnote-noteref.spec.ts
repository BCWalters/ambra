import { expect, test } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { launchReader } from "../harness.js";

/**
 * Spec-gap fix: `epub:type="noteref"` links previously behaved as plain
 * links (navigating to the footnote's own position in the flow, leaving
 * the reader to find their way back) and were never given the matching
 * `role="doc-noteref"`/`role="doc-footnote"` DPUB-ARIA roles assistive
 * technology needs to announce them as notes rather than generic links.
 * `fixtures/footnote.epub` declares a single `epub:type="noteref"` link
 * with a same-document `epub:type="footnote"` target.
 */
test("clicking an epub:type=noteref link shows its footnote content inline instead of navigating", async () => {
  const { context, readerPage } = await launchReader(path.resolve(__dirname, "../fixtures/footnote.epub"));

  const roles = await readerPage.evaluate(() => {
    const iframe = document.querySelector("iframe") as HTMLIFrameElement;
    const doc = iframe.contentDocument!;
    return {
      noterefRole: doc.getElementById("fnref1")?.getAttribute("role"),
      footnoteRole: doc.getElementById("fn1")?.getAttribute("role"),
    };
  });
  expect(roles.noterefRole).toBe("doc-noteref");
  expect(roles.footnoteRole).toBe("doc-footnote");

  await readerPage.evaluate(() => {
    const iframe = document.querySelector("iframe") as HTMLIFrameElement;
    const doc = iframe.contentDocument!;
    const link = doc.getElementById("fnref1")!;
    const rect = link.getBoundingClientRect();
    link.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, clientX: rect.left, clientY: rect.top }),
    );
  });

  const popup = readerPage.getByRole("dialog", { name: "Footnote" });
  await expect(popup).toBeVisible();
  await expect(popup).toContainText("full text of the footnote");

  // Still on the same page — a noteref click must not navigate away.
  const stillOnChapter1 = await readerPage.evaluate(() => {
    const iframe = document.querySelector("iframe") as HTMLIFrameElement;
    return iframe.contentDocument?.querySelector("h1")?.textContent;
  });
  expect(stillOnChapter1).toBe("Chapter 1");

  await readerPage.keyboard.press("Escape");
  await expect(popup).toBeHidden();

  await context.close();
});
