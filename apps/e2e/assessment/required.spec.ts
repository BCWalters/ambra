import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  requiredNativeCriteria,
  requiredNativeVerdict,
} from "../../../scripts/epub-conformance-required.mjs";
import { rollImageHitPoint } from "../../../scripts/epub-conformance-foundations.mjs";
import { archiveProperties } from "../../../scripts/epub-conformance-publications.mjs";
import {
  assessNativeCriterion,
  assessmentPublication,
  requiredAssessmentPath,
} from "./native-assessment.js";
import { openAssessmentPublication } from "./publication-opening.js";

async function expectations(page: Page, id: string) {
  const root = path.join(requiredAssessmentPath("AMBRA_EPUB_TESTS_PATH"), "tests", id);
  const xml: Record<string, string> = {};
  const hashes: Record<string, string> = {};
  const read = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) read(file);
      else if (entry.isFile()) {
        const name = path.relative(root, file).split(path.sep).join("/");
        const bytes = fs.readFileSync(file);
        hashes[name] = createHash("sha256").update(bytes).digest("hex");
        if (/\.(?:xml|opf|xhtml|svg)$/.test(name)) xml[name] = bytes.toString("utf8");
      }
    }
  };
  read(root);
  return page.evaluate(
    async ({ xml, hashes }) => {
      const parser = new DOMParser();
      const parse = (name: string) => {
        if (!Object.hasOwn(xml, name)) throw new Error(`Missing original XML: ${name}`);
        const doc = parser.parseFromString(xml[name]!, "application/xml");
        if (doc.getElementsByTagName("parsererror").length)
          throw new Error(`Invalid original XML: ${name}`);
        return doc;
      };
      const resolve = (href: string, from: string) =>
        decodeURIComponent(new URL(href, `https://assessment.invalid/${from}`).pathname.slice(1));
      const packagePath = parse("META-INF/container.xml")
        .getElementsByTagNameNS("*", "rootfile")[0]
        ?.getAttribute("full-path");
      if (!packagePath) throw new Error("Missing original rootfile.");
      const pkg = parse(packagePath);
      const manifest = Array.from(pkg.getElementsByTagNameNS("*", "item"));
      const spine = Array.from(pkg.getElementsByTagNameNS("*", "itemref"));
      const documents = [];
      for (const ref of spine) {
        const original = manifest.find(
          (item) => item.getAttribute("id") === ref.getAttribute("idref"),
        );
        const originalHref = original?.getAttribute("href");
        if (!original || !originalHref) throw new Error("Missing original spine item.");
        let item: Element = original;
        const visited = new Set<string>();
        while (
          !["application/xhtml+xml", "image/svg+xml"].includes(
            item.getAttribute("media-type") ?? "",
          )
        ) {
          const fallback: string | null = item.getAttribute("fallback");
          if (!fallback || visited.has(fallback)) throw new Error("No original document fallback.");
          visited.add(fallback);
          const next: Element | undefined = manifest.find(
            (candidate) => candidate.getAttribute("id") === fallback,
          );
          if (!next) throw new Error("Missing original fallback item.");
          item = next;
        }
        const href = item.getAttribute("href");
        if (!href) throw new Error("Missing original document href.");
        const file = resolve(href, packagePath);
        const doc = parse(file);
        const anchor =
          doc.getElementsByTagNameNS("*", "p")[0] ??
          doc.getElementsByTagNameNS("http://www.w3.org/2000/svg", "text")[0];
        if (!anchor?.textContent?.trim())
          throw new Error(`Missing original authored text: ${file}`);
        const expectedText = anchor.textContent.trim().replace(/\s+/g, " ");
        const expectedTextHash = Array.from(
          new Uint8Array(
            await crypto.subtle.digest("SHA-256", new TextEncoder().encode(expectedText)),
          ),
        )
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join("");
        const media = Array.from(doc.querySelectorAll("audio, video")).map((element) => {
          const src =
            element.getAttribute("src") ?? element.querySelector("source")?.getAttribute("src");
          if (!src) throw new Error("Missing original media URL.");
          const expectedHash = hashes[resolve(src, file)];
          if (!expectedHash) throw new Error("Missing original media bytes.");
          return { expectedHash };
        });
        const shapeHashes = await Promise.all(
          Array.from(doc.querySelectorAll("path.fil0")).map(async (shape) =>
            Array.from(
              new Uint8Array(
                await crypto.subtle.digest(
                  "SHA-256",
                  new TextEncoder().encode(shape.getAttribute("d") ?? ""),
                ),
              ),
            )
              .map((byte) => byte.toString(16).padStart(2, "0"))
              .join(""),
          ),
        );
        documents.push({
          path: resolve(originalHref, packagePath),
          contentPath: file,
          expectedTextHash,
          media,
          shapeHashes,
        });
      }
      if (!documents.length) throw new Error("Empty original spine.");
      return documents;
    },
    { xml, hashes },
  );
}

async function measureDocument(page: Page, spineIndex: number) {
  return page.evaluate(async (index) => {
    const controller = Reflect.get(window, "__readerController");
    const snapshot: { currentSpinePath?: string; spineIndex: number } = controller.snapshot();
    if (typeof snapshot.currentSpinePath !== "string")
      throw new Error("Missing native current spine path.");
    const views: { document: Document; spineIndex: number }[] = controller.contentDocumentViews();
    const doc = views.find((view) => view.spineIndex === index)?.document;
    if (!doc) throw new Error(`Missing native document at spine ${index}.`);
    const frame = doc.defaultView?.frameElement;
    if (!(frame instanceof HTMLIFrameElement)) throw new Error("Missing native content frame.");
    const anchor =
      doc.getElementsByTagNameNS("*", "p")[0] ??
      doc.getElementsByTagNameNS("http://www.w3.org/2000/svg", "text")[0];
    if (!anchor) throw new Error("Missing native authored text.");
    const rect = (element: Element) => {
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    };
    const range = doc.createRange();
    range.selectNodeContents(anchor);
    const box = range.getBoundingClientRect();
    const actualTextHash = Array.from(
      new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(anchor.textContent!.trim().replace(/\s+/g, " ")),
        ),
      ),
    )
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    return {
      path: snapshot.currentSpinePath,
      spineIndex: snapshot.spineIndex,
      actualTextHash,
      frame: rect(frame),
      image: { x: box.x, y: box.y, width: box.width, height: box.height },
      clip: { x: 0, y: 0, width: innerWidth, height: innerHeight },
      viewport: { width: innerWidth, height: innerHeight },
      clientWidth: frame.clientWidth,
      clientHeight: frame.clientHeight,
    };
  }, spineIndex);
}

async function paintedDocument(
  page: Page,
  index: number,
  geometry: Awaited<ReturnType<typeof measureDocument>>,
) {
  const point = rollImageHitPoint(geometry);
  if (!point) return false;
  return page.evaluate(
    ({ index, point }) => {
      const views: { document: Document; spineIndex: number }[] = Reflect.get(
        window,
        "__readerController",
      ).contentDocumentViews();
      const doc = views.find((view) => view.spineIndex === index)?.document;
      const anchor =
        doc?.getElementsByTagNameNS("*", "p")[0] ??
        doc?.getElementsByTagNameNS("http://www.w3.org/2000/svg", "text")[0];
      const frame = doc?.defaultView?.frameElement;
      const hit = doc?.elementFromPoint(point.document.x, point.document.y);
      return (
        !!anchor &&
        !!frame &&
        !!hit &&
        anchor.contains(hit) &&
        frame.checkVisibility({ opacityProperty: true, visibilityProperty: true }) &&
        document.elementFromPoint(point.viewport.x, point.viewport.y) === frame
      );
    },
    { index, point },
  );
}

for (const criterion of process.env.AMBRA_ASSESSMENT_REQUIRED === "1"
  ? requiredNativeCriteria
  : []) {
  test(`official required criterion: ${criterion.id}`, async ({
    browserName: _browserName,
  }, info) => {
    await assessNativeCriterion(
      criterion.id,
      info,
      async (launched) => {
        let page = launched.readerPage;
        const { libraryPage } = launched;
        if (criterion.kind === "rejection") {
          const file = assessmentPublication(criterion.id);
          const properties = await archiveProperties(file);
          await libraryPage.bringToFront();
          const cards = libraryPage.locator("[data-library-book]");
          const before = await cards.count();
          await libraryPage.locator('input[type="file"]').setInputFiles(file);
          await expect
            .poll(
              async () =>
                (await libraryPage.getByRole("alert").count()) > 0 ||
                (await cards.count()) > before,
              { timeout: 20_000 },
            )
            .toBe(true);
          const alert = libraryPage.getByRole("alert");
          const observations = {
            kind: "rejection",
            ...properties,
            error: (await alert.count()) ? await alert.innerText() : "",
            imported: (await cards.count()) > before,
          };
          return {
            observations,
            passed: requiredNativeVerdict(observations, criterion),
            reason:
              "Verified deliberately nonconforming original-source archive; native import outcome and surfaced error.",
            trackingIssue: "https://github.com/BCWalters/ambra/issues/326",
          };
        }
        const source = await expectations(page, criterion.id);
        if (["cnt-svg-support", "cnt-svg-css", "pkg-spine-order-svg"].includes(criterion.id)) {
          const opened = await openAssessmentPublication(launched, criterion.id);
          if (opened.status === "rejected") {
            return {
              observations: {
                kind: criterion.kind,
                sourceSpine: source.map((item) => item.path),
                openingError: { stage: opened.stage, message: opened.message },
              },
              passed: false,
              reason: `Native ${opened.stage} rejected original authored content: ${opened.message}`,
              trackingIssue: "https://github.com/BCWalters/ambra/issues/326",
            };
          }
          page = opened.page;
        }
        const readingOrder: string[] = await page.evaluate(() =>
          Reflect.get(window, "__readerController").pkg.spine.map(
            (item: { manifestItem: { path: string } }) => item.manifestItem.path,
          ),
        );
        const documents = [];
        let math: unknown;
        const shapes: unknown[] = [];
        const media: unknown[] = [];
        for (const [index, expected] of source.entries()) {
          if (index > 0) {
            await page.evaluate(() => Reflect.get(window, "__readerController").goToChapter(1));
            await expect
              .poll(() =>
                page.evaluate(() => !Reflect.get(window, "__readerController").isLoadInFlight),
              )
              .toBe(true);
          }
          const measured = await measureDocument(page, index);
          documents.push({
            ...measured,
            expectedPath: expected.path,
            contentPath: expected.contentPath,
            expectedSpineIndex: index,
            expectedTextHash: expected.expectedTextHash,
            painted: await paintedDocument(page, index, measured),
          });
          if (criterion.kind === "math") {
            const geometry = await page.evaluate(() => {
              const views: { document: Document }[] = Reflect.get(
                window,
                "__readerController",
              ).contentDocumentViews();
              const doc = views[0]!.document;
              const math = doc.querySelector("math");
              const superscript = math?.querySelector("msup");
              const base = superscript?.firstElementChild?.getBoundingClientRect();
              const exponent = superscript?.lastElementChild?.getBoundingClientRect();
              const frame = doc.defaultView?.frameElement;
              if (!(frame instanceof HTMLIFrameElement))
                throw new Error("Missing MathML content frame.");
              const box = frame.getBoundingClientRect();
              const target = math?.getBoundingClientRect();
              return {
                namespace: math?.namespaceURI === "http://www.w3.org/1998/Math/MathML",
                superscript: !!superscript,
                visible: !!math?.checkVisibility({
                  opacityProperty: true,
                  visibilityProperty: true,
                }),
                frame: { x: box.x, y: box.y, width: box.width, height: box.height },
                image: {
                  x: target?.x ?? 0,
                  y: target?.y ?? 0,
                  width: target?.width ?? 0,
                  height: target?.height ?? 0,
                },
                clientWidth: frame.clientWidth,
                clientHeight: frame.clientHeight,
                clip: { x: 0, y: 0, width: innerWidth, height: innerHeight },
                viewport: { width: innerWidth, height: innerHeight },
                baseTop: base?.top ?? 0,
                exponentTop: exponent?.top ?? 0,
                baseHeight: base?.height ?? 0,
                exponentHeight: exponent?.height ?? 0,
              };
            });
            const point = rollImageHitPoint(geometry);
            const painted =
              geometry.visible &&
              !!point &&
              (await page.evaluate((point) => {
                const views: { document: Document }[] = Reflect.get(
                  window,
                  "__readerController",
                ).contentDocumentViews();
                const doc = views[0]!.document;
                const math = doc.querySelector("math");
                const hit = doc.elementFromPoint(point.document.x, point.document.y);
                return (
                  !!math &&
                  !!hit &&
                  math.contains(hit) &&
                  document.elementFromPoint(point.viewport.x, point.viewport.y) ===
                    doc.defaultView!.frameElement
                );
              }, point));
            math = { ...geometry, point, painted };
          } else if (criterion.kind === "svg") {
            const geometry = await page.evaluate(async () => {
              const views: { document: Document }[] = Reflect.get(
                window,
                "__readerController",
              ).contentDocumentViews();
              const records = [];
              for (const [viewIndex, { document: doc }] of views.entries()) {
                const frame = doc.defaultView?.frameElement;
                if (!(frame instanceof HTMLIFrameElement))
                  throw new Error("Missing SVG content frame.");
                const frameBox = frame.getBoundingClientRect();
                for (const [shapeIndex, shape] of Array.from(
                  doc.querySelectorAll("path.fil0"),
                ).entries()) {
                  const box = shape.getBoundingClientRect();
                  records.push({
                    viewIndex,
                    shapeIndex,
                    namespace: shape.namespaceURI === "http://www.w3.org/2000/svg",
                    visible: shape.checkVisibility({
                      opacityProperty: true,
                      visibilityProperty: true,
                    }),
                    dHash: Array.from(
                      new Uint8Array(
                        await crypto.subtle.digest(
                          "SHA-256",
                          new TextEncoder().encode(shape.getAttribute("d") ?? ""),
                        ),
                      ),
                    )
                      .map((byte) => byte.toString(16).padStart(2, "0"))
                      .join(""),
                    width: box.width,
                    height: box.height,
                    image: { x: box.x, y: box.y, width: box.width, height: box.height },
                    frame: {
                      x: frameBox.x,
                      y: frameBox.y,
                      width: frameBox.width,
                      height: frameBox.height,
                    },
                    clientWidth: frame.clientWidth,
                    clientHeight: frame.clientHeight,
                    clip: { x: 0, y: 0, width: innerWidth, height: innerHeight },
                    viewport: { width: innerWidth, height: innerHeight },
                    fill: doc.defaultView!.getComputedStyle(shape).fill,
                    pattern:
                      doc.getElementById("star")?.localName === "pattern" &&
                      !!doc.getElementById("star")?.querySelector("polygon"),
                  });
                }
              }
              return records;
            });
            for (const shape of geometry) {
              const points = [];
              for (let x = 1; x < 8; x++) {
                for (let y = 1; y < 8; y++) {
                  const point = rollImageHitPoint({
                    ...shape,
                    image: {
                      x: shape.image.x + (shape.width * x) / 8,
                      y: shape.image.y + (shape.height * y) / 8,
                      width: 1,
                      height: 1,
                    },
                  });
                  if (point) points.push(point);
                }
              }
              const painted =
                shape.visible &&
                (await page.evaluate(
                  ({ viewIndex, shapeIndex, points }) => {
                    const views: { document: Document }[] = Reflect.get(
                      window,
                      "__readerController",
                    ).contentDocumentViews();
                    const doc = views[viewIndex]!.document;
                    const target = doc.querySelectorAll("path.fil0")[shapeIndex]!;
                    const frame = doc.defaultView!.frameElement;
                    return points.some(
                      (point) =>
                        doc.elementFromPoint(point.document.x, point.document.y) === target &&
                        document.elementFromPoint(point.viewport.x, point.viewport.y) === frame,
                    );
                  },
                  { viewIndex: shape.viewIndex, shapeIndex: shape.shapeIndex, points },
                ));
              shapes.push({ ...shape, points, painted });
            }
          } else if (criterion.kind === "media") {
            const frame = page.getByRole("main").locator("iframe").first().contentFrame();
            for (const [mediaIndex, original] of expected.media.entries()) {
              const element = frame.locator("audio, video").nth(mediaIndex);
              const before = await element.evaluate((element) => {
                if (!(element instanceof HTMLMediaElement)) throw new Error("Not native media.");
                return element.currentTime;
              });
              const box = await element.boundingBox();
              if (!box) throw new Error("Native media controls are not visible.");
              await element.click({ position: { x: 20, y: box.height / 2 } });
              await page.waitForTimeout(1_500);
              const observed = await element.evaluate(async (element) => {
                if (!(element instanceof HTMLMediaElement)) throw new Error("Not native media.");
                const response = await fetch(element.currentSrc);
                if (!response.ok)
                  throw new Error(`Cannot inspect native media bytes: ${response.status}`);
                const bytes = await response.arrayBuffer();
                const actualHash = Array.from(
                  new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
                )
                  .map((byte) => byte.toString(16).padStart(2, "0"))
                  .join("");
                let signalPeak = 0;
                let decodingError: string | null = null;
                try {
                  const decoded = await new OfflineAudioContext(1, 1, 48_000).decodeAudioData(
                    bytes,
                  );
                  for (let channel = 0; channel < decoded.numberOfChannels; channel++)
                    for (const sample of decoded.getChannelData(channel))
                      signalPeak = Math.max(signalPeak, Math.abs(sample));
                } catch (error) {
                  if (
                    !(error instanceof DOMException) ||
                    !["EncodingError", "NotSupportedError"].includes(error.name)
                  )
                    throw error;
                  decodingError = `${error.name}: ${error.message}`;
                  console.error(`Native PCM decoding failed: ${decodingError}`);
                }
                return {
                  actualHash,
                  signalPeak,
                  after: element.currentTime,
                  readyState: element.readyState,
                  muted: element.muted,
                  paused: element.paused,
                  ended: element.ended,
                  volume: element.volume,
                  duration: Number.isFinite(element.duration) ? element.duration : 0,
                  error: element.error
                    ? `${element.error.code}: ${element.error.message}`
                    : decodingError,
                };
              });
              media.push({ ...original, before, ...observed });
            }
          }
        }
        const observations = {
          kind: criterion.kind,
          documents,
          math,
          shapes,
          media,
          sourceSpine: source.map((item) => item.path),
          acceptedSpinePaths: source.map((item) => [...new Set([item.path, item.contentPath])]),
          readingOrder,
          expectedShapeHashes: source.flatMap((item) => item.shapeHashes),
        };
        return {
          observations,
          passed: requiredNativeVerdict(observations, criterion),
          reason:
            "Original source-derived reading order/text and native rendering/playback measurements; no audible-output or live AT claim.",
          trackingIssue: "https://github.com/BCWalters/ambra/issues/326",
        };
      },
      criterion.kind === "rejection" ||
        ["cnt-svg-support", "cnt-svg-css", "pkg-spine-order-svg"].includes(criterion.id)
        ? { publicationId: "cnt-xhtml-support" }
        : {},
    );
  });
}
