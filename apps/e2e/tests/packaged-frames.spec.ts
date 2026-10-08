import { expect, test, type Frame, type Page, type TestInfo } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { launchReader } from "../harness.js";
import { navigationFixture } from "../navigation-fixture.js";

function document(body: string, head = ""): string {
  return `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Packaged frame</title>${head}</head><body>${body}</body></html>`;
}

function fixture(info: TestInfo, scenario: "resources" | "svg" | "failures" | "depth" | "cycle"): string {
  const files = new Map<string, { type: string; text: string }>();
  let frames: string;
  if (scenario === "resources") {
    frames = '<iframe title="Packaged child" width="500" height="70" style="border:0" src="frames/child.xhtml" sandbox="allow-scripts allow-same-origin" csp="script-src \'unsafe-inline\'" referrerpolicy="unsafe-url" srcdoc="&lt;p&gt;UNSAFE SRCDOC&lt;/p&gt;"/>';
    files.set("frames/child.xhtml", { type: "application/xhtml+xml", text: document(
      '<p id="child-text">Static packaged child</p><img id="picture" src="../images/picture.svg" width="20" height="20"/><iframe title="Grandchild" src="deep/grandchild.xhtml" width="250" height="24" style="display:block;border:0"/>',
      '<link rel="stylesheet" href="../styles/frame.css"/><script>window.__publisherScriptRan=true;parent.document.getElementById("host-marker").textContent="MODIFIED";</script>',
    ) });
    files.set("frames/deep/grandchild.xhtml", { type: "application/xhtml+xml", text: document(
      '<p id="grandchild-text" style="margin:0;font-size:12px">Static packaged grandchild</p>',
      "<style>body{margin:0}</style>",
    ) });
    files.set("styles/frame.css", { type: "text/css", text: '@import "nested/color.css";body{margin:0;font-size:12px}p{margin:0}' });
    files.set("styles/nested/color.css", { type: "text/css", text: 'p{color:rgb(0,96,0);background-image:url("../../images/picture.svg")}' });
    files.set("images/picture.svg", { type: "image/svg+xml", text: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="green"/></svg>' });
  } else if (scenario === "svg") {
    frames = '<iframe title="SVG child" width="500" height="70" style="border:0" src="frames/child.svg"/>';
    files.set("frames/child.svg", { type: "image/svg+xml", text: '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="70"><style>@import url("../styles/svg.css");</style><text id="svg-text" x="10" y="30">Static packaged SVG</text><image id="svg-picture" href="../images/picture.svg" x="10" y="40" width="20" height="20"/><script>window.__publisherScriptRan=true;</script></svg>' });
    files.set("styles/svg.css", { type: "text/css", text: "text{fill:rgb(0,96,0)}" });
    files.set("images/picture.svg", { type: "image/svg+xml", text: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="green"/></svg>' });
  } else if (scenario === "failures") {
    frames = '<iframe title="Missing child" src="missing.xhtml"/><iframe title="Malformed child" src="bad.xhtml"/><iframe title="Remote child" src="https://frames.example.test/private"/><iframe title="Data child" src="data:text/html,blocked"/>';
    files.set("bad.xhtml", { type: "application/xhtml+xml", text: "<html><unclosed></html>" });
  } else if (scenario === "cycle") {
    frames = '<iframe title="Cycle child" src="a.xhtml"/>';
    files.set("a.xhtml", { type: "application/xhtml+xml", text: document('Child A<iframe src="b.xhtml"/>') });
    files.set("b.xhtml", { type: "application/xhtml+xml", text: document('Child B<iframe src="a.xhtml"/>') });
  } else {
    frames = '<iframe title="Depth child" src="level0.xhtml"/>';
    for (let index = 0; index <= 8; index++) {
      files.set(`level${index}.xhtml`, { type: "application/xhtml+xml", text: document(
        `<p id="level">Level ${index}</p><iframe src="level${index + 1}.xhtml"/>`,
      ) });
    }
  }
  const book = navigationFixture(info, [1], () =>
    `<p id="host-marker">3.1.1 Host remains readable</p>${frames}`);
  const source = info.outputPath("navigation-source");
  let manifest = "";
  for (const [index, [name, resource]] of [...files].entries()) {
    const target = path.join(source, "EPUB", name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, resource.text);
    manifest += `<item id="frame-resource-${index}" href="${name}" media-type="${resource.type}"/>`;
  }
  const opf = path.join(source, "EPUB/package.opf");
  fs.writeFileSync(opf, fs.readFileSync(opf, "utf8")
    .replace("</manifest>", `${manifest}</manifest>`)
    .replace("Navigation boundaries", `3.1.1 Packaged frames: ${scenario}`));
  execFileSync("zip", ["-q", "-X", "-r", book, "EPUB"], { cwd: source });
  return book;
}

async function readingFrame(page: Page): Promise<Frame> {
  const url: string = await page.evaluate(() =>
    Reflect.get(window, "__readerController").contentDocumentViews()[0].document.URL);
  const frame = page.frames().find(candidate => candidate.url() === url);
  if (!frame) throw new Error("Committed reading frame was not found.");
  return frame;
}

async function childFrame(parent: Frame): Promise<Frame> {
  await expect.poll(() => parent.childFrames().filter(frame => /^(blob:|data:)/.test(frame.url())).length).toBe(1);
  return parent.childFrames().find(frame => /^(blob:|data:)/.test(frame.url()))!;
}

test("packaged frames render static resources and grandchildren without publisher script or parent access (#384)", async () => {
  const { context, readerPage: page } = await launchReader(fixture(test.info(), "resources"), {
    viewport: { width: 900, height: 700 },
  });
  try {
    const host = await readingFrame(page);
    const child = await childFrame(host);
    await expect(child.locator("#child-text")).toBeVisible();
    await expect(child.locator("#child-text")).toHaveCSS("color", "rgb(0, 96, 0)");
    await expect(child.locator("#child-text")).toHaveCSS("background-image", /^url\("data:image\/svg\+xml;base64,/);
    await expect.poll(() => child.locator("#picture").evaluate(image =>
      image instanceof HTMLImageElement ? image.naturalWidth : 0)).toBe(20);
    const grandchild = await childFrame(child);
    await expect(grandchild.locator("#grandchild-text")).toBeVisible();
    await expect(host.locator("#host-marker")).toHaveText("3.1.1 Host remains readable");
    const frame = host.getByTitle("Packaged child", { exact: true });
    await expect(frame).toHaveAttribute("sandbox", "");
    await expect(frame).toHaveAttribute("referrerpolicy", "no-referrer");
    await expect(frame).not.toHaveAttribute("srcdoc");
    const geometry = await frame.evaluate(element => {
      const bounds = element.getBoundingClientRect();
      return { width: bounds.width, height: bounds.height,
        childDocumentInaccessible: element instanceof HTMLIFrameElement && element.contentDocument === null };
    });
    expect(geometry).toEqual({ width: 500, height: 70, childDocumentInaccessible: true });
    expect(await child.evaluate(() => {
      let denied = false;
      try { void parent.document.body; } catch (error) {
        if (!(error instanceof DOMException) || error.name !== "SecurityError") throw error;
        denied = true;
      }
      return { denied, publisherScriptRan: Reflect.has(window, "__publisherScriptRan") };
    })).toEqual({ denied: true, publisherScriptRan: false });
    await expect(child.getByText("UNSAFE SRCDOC", { exact: true })).toHaveCount(0);
    expect(await child.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content"))
      .toContain("script-src 'none'");
  } finally {
    await context.close();
  }
});

test("packaged SVG child loads its rewritten stylesheet without a head or origin privileges (#384)", async () => {
  const { context, readerPage: page } = await launchReader(fixture(test.info(), "svg"));
  try {
    const host = await readingFrame(page);
    const child = await childFrame(host);
    await expect(child.locator("#svg-text")).toBeVisible();
    await expect(child.locator("#svg-text")).toHaveCSS("fill", "rgb(0, 96, 0)");
    await expect(child.locator("#svg-picture")).toHaveAttribute("href", /^data:image\/svg\+xml;base64,/);
    expect(await child.evaluate(() => Reflect.has(window, "__publisherScriptRan"))).toBe(false);
    expect(await host.getByTitle("SVG child", { exact: true }).evaluate(element =>
      element instanceof HTMLIFrameElement && element.contentDocument === null)).toBe(true);
  } finally {
    await context.close();
  }
});

test("missing, malformed and policy-blocked child frames do not replace a readable host with an error (#384)", async () => {
  const { context, readerPage: page } = await launchReader(fixture(test.info(), "failures"));
  try {
    const host = await readingFrame(page);
    await expect(host.locator("#host-marker")).toBeVisible();
    for (const title of ["Missing child", "Malformed child", "Remote child", "Data child"]) {
      await expect(host.getByTitle(title, { exact: true })).not.toHaveAttribute("src");
    }
    expect(await page.evaluate(() =>
      Reflect.get(window, "__readerController").snapshot().errorSeverity)).not.toBe("blocking");
    await expect(page.getByRole("alert")).toHaveCount(0);
  } finally {
    await context.close();
  }
});

for (const scenario of ["depth", "cycle"] as const) {
  test(`packaged frame ${scenario} limit retains static content and terminates recursion (#384)`, async () => {
    const { context, readerPage: page } = await launchReader(fixture(test.info(), scenario));
    try {
      let current = await readingFrame(page);
      const levels = scenario === "depth" ? 8 : 2;
      for (let index = 0; index < levels; index++) current = await childFrame(current);
      await expect(current.locator("body")).toContainText(scenario === "depth" ? "Level 7" : "Child B");
      await expect(current.locator("iframe")).not.toHaveAttribute("src");
      expect(current.childFrames().filter(frame => /^(blob:|data:)/.test(frame.url()))).toHaveLength(0);
      const host = await readingFrame(page);
      await expect(host.locator("#host-marker")).toBeVisible();
    } finally {
      await context.close();
    }
  });
}

for (const name of ["scr-not-support_ccscript-modify-host", "scr-not-support_ccscript-modify-size"]) {
  test(`original W3C ${name}: static iframe loads but publication scripting remains unsupported (#384)`, async () => {
    const directory = process.env.AMBRA_NESTED_FRAME_EPUB_DIR;
    test.skip(!directory, "Set AMBRA_NESTED_FRAME_EPUB_DIR to the pinned assessment-kit folder.");
    const { context, readerPage: page } = await launchReader(path.join(directory!, `${name}.epub`), {
      viewport: { width: 900, height: 700 },
    });
    try {
      const host = await readingFrame(page);
      const child = await childFrame(host);
      await expect(child.locator("#scripting_support")).toBeVisible();
      await expect(child.locator("#scripting_support")).toContainText("does not support scripting");
      await expect(host.locator("iframe")).toHaveAttribute("sandbox", "");
      expect(await host.locator("iframe").evaluate(element =>
        element instanceof HTMLIFrameElement && element.contentDocument === null)).toBe(true);
    } finally {
      await context.close();
    }
  });
}
