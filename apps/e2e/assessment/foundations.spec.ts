import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  foundationVerdict,
  isFoundationCriterion,
  rollImageHitPoint,
} from "../../../scripts/epub-conformance-foundations.mjs";
import { assessNativeCriterion, requiredAssessmentPath } from "./native-assessment.js";

const profile: unknown = JSON.parse(
  fs.readFileSync(
    new URL("../../../conformance/epub-3.4/foundations-profile.json", import.meta.url),
    "utf8",
  ),
);
if (
  !Array.isArray(profile) ||
  profile.length !== 10 ||
  !profile.every(isFoundationCriterion) ||
  new Set(profile.map((item) => item.id)).size !== profile.length
)
  throw new Error("Invalid native foundations profile.");

async function sourceExpectations(page: Page, id: string) {
  const directory = path.join(requiredAssessmentPath("AMBRA_EPUB_TESTS_PATH"), "tests", id);
  const xml: Record<string, string> = {};
  const hashes: Record<string, string> = {};
  function read(directoryPath: string) {
    for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
      const file = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) read(file);
      else if (entry.isFile()) {
        const name = path.relative(directory, file).split(path.sep).join("/");
        const bytes = fs.readFileSync(file);
        hashes[name] = createHash("sha256").update(bytes).digest("hex");
        if (/\.(?:opf|xhtml|svg|xml)$/.test(name)) xml[name] = bytes.toString("utf8");
      }
    }
  }
  read(directory);
  return page.evaluate(
    async ({ xml, hashes }) => {
      const parser = new DOMParser();
      const parse = (file: string): Document => {
        if (!(file in xml)) throw new Error(`Missing pinned source document: ${file}`);
        const doc = parser.parseFromString(xml[file]!, "application/xml");
        if (doc.getElementsByTagName("parsererror").length)
          throw new Error(`Invalid pinned XML: ${file}`);
        return doc;
      };
      const resolve = (href: string, from: string) =>
        new URL(href, `https://assessment.invalid/${from}`);
      const archivePath = (url: URL) => decodeURIComponent(url.pathname.slice(1));
      const xmlLanguage = (element: Element) =>
        element.getAttributeNS("http://www.w3.org/XML/1998/namespace", "lang");
      const container = parse("META-INF/container.xml");
      const packagePath = container
        .getElementsByTagNameNS("*", "rootfile")[0]
        ?.getAttribute("full-path");
      if (!packagePath) throw new Error("Missing pinned rootfile.");
      const pkg = parse(packagePath);
      const root = pkg.documentElement;
      const metadata = pkg.getElementsByTagNameNS("*", "metadata")[0];
      if (!metadata) throw new Error("Missing pinned metadata.");
      const dc = (name: string) =>
        Array.from(metadata.getElementsByTagNameNS("http://purl.org/dc/elements/1.1/", name));
      const manifest = Array.from(pkg.getElementsByTagNameNS("*", "item"));
      const spine = Array.from(pkg.getElementsByTagNameNS("*", "itemref")).map((ref) => {
        const item = manifest.find((item) => item.getAttribute("id") === ref.getAttribute("idref"));
        const href = item?.getAttribute("href");
        if (!href) throw new Error("Missing pinned spine manifest item.");
        return archivePath(resolve(href, packagePath));
      });
      const content = parse(spine[0]!);
      const unannotated = [
        content.documentElement,
        content.getElementsByTagNameNS("*", "body")[0],
        content.getElementsByTagNameNS("*", "p")[0],
      ]
        .filter((element): element is Element => !!element)
        .every(
          (element) =>
            !element.getAttribute("lang") && !xmlLanguage(element) && !element.getAttribute("dir"),
        );
      const navItem = manifest.find((item) =>
        item.getAttribute("properties")?.split(/\s+/).includes("nav"),
      );
      const navHref = navItem?.getAttribute("href");
      if (!navHref) throw new Error("Missing pinned navigation document.");
      const navPath = archivePath(resolve(navHref, packagePath));
      const toc = Array.from(parse(navPath).getElementsByTagNameNS("*", "nav")).find((nav) =>
        nav.getAttributeNS("http://www.idpf.org/2007/ops", "type")?.split(/\s+/).includes("toc"),
      );
      if (!toc) throw new Error("Missing pinned table of contents.");
      const navigation = Array.from(toc.getElementsByTagNameNS("*", "a")).map((link) => {
        const target = resolve(link.getAttribute("href")!, navPath);
        const targetPath = archivePath(target);
        const doc = parse(targetPath);
        const spineIndex = spine.indexOf(targetPath);
        if (spineIndex < 0) throw new Error("Pinned TOC target is not in the spine.");
        const fragment = target.hash ? decodeURIComponent(target.hash.slice(1)) : null;
        const targetElement = fragment
          ? doc.getElementById(fragment)
          : doc.getElementsByTagNameNS("*", "body")[0]?.firstElementChild ??
            (doc.documentElement.localName === "svg" &&
              doc.documentElement.namespaceURI === "http://www.w3.org/2000/svg"
              ? doc.documentElement
              : null);
        if (!targetElement) throw new Error("Missing pinned navigation target element.");
        return {
          label: link.textContent!.trim().replace(/\s+/g, " "),
          path: targetPath,
          fragment,
          text: targetElement.textContent!.trim().replace(/\s+/g, " "),
          title: doc.getElementsByTagNameNS("*", "title")[0]?.textContent ?? null,
          spineIndex,
        };
      });
      const roll = Array.from(metadata.getElementsByTagNameNS("*", "meta")).some(
        (meta) =>
          meta.getAttribute("property") === "rendition:layout" &&
          meta.textContent?.trim() === "roll",
      );
      const frames = roll
        ? spine.map((file) => {
            const doc = parse(file);
            const viewport = Array.from(doc.getElementsByTagNameNS("*", "meta"))
              .find((meta) => meta.getAttribute("name") === "viewport")
              ?.getAttribute("content");
            const viewBox = doc.documentElement
              .getAttribute("viewBox")
              ?.trim()
              .split(/[ ,]+/)
              .map(Number);
            const width = viewport
              ? Number(/width\s*=\s*([\d.]+)/.exec(viewport)?.[1])
              : viewBox?.[2];
            const height = viewport
              ? Number(/height\s*=\s*([\d.]+)/.exec(viewport)?.[1])
              : viewBox?.[3];
            if (!width || !height) throw new Error(`Missing pinned intrinsic viewport: ${file}`);
            const images = Array.from(doc.querySelectorAll("img, image")).map((image) => {
              const href =
                image.getAttribute("src") ??
                image.getAttribute("href") ??
                image.getAttributeNS("http://www.w3.org/1999/xlink", "href");
              if (!href) throw new Error(`Missing pinned image href: ${file}`);
              const hash = hashes[archivePath(resolve(href, file))];
              if (!hash) throw new Error(`Missing pinned image bytes: ${file}`);
              return hash;
            });
            return { width, height, images };
          })
        : [];
      const paragraph = content.getElementsByTagNameNS("*", "p")[0];
      const contentDigest = paragraph
        ? Array.from(
            new Uint8Array(
              await crypto.subtle.digest(
                "SHA-256",
                new TextEncoder().encode(paragraph.textContent!.trim().replace(/\s+/g, " ")),
              ),
            ),
          )
            .map((byte) => byte.toString(16).padStart(2, "0"))
            .join("")
        : null;
      return {
        package: {
          contentDigest,
          titles: dc("title").map((node) => node.textContent!),
          creators: dc("creator").map((node) => node.textContent!),
          dir: root.getAttribute("dir"),
          lang: xmlLanguage(root),
          creatorDir: dc("creator")[0]?.getAttribute("dir") ?? null,
          contentUnannotated: unannotated,
        },
        navigation,
        frames,
      };
    },
    { xml, hashes },
  );
}

for (const criterion of profile) {
  test(`official foundations criterion: ${criterion.id}`, async ({
    browserName: _browserName,
  }, info) => {
    await assessNativeCriterion(criterion.id, info, async ({ readerPage: page, libraryPage }) => {
      const source = await sourceExpectations(page, criterion.id);
      let observations: unknown;
      if (criterion.kind === "package") {
        await libraryPage.bringToFront();
        const rendered = await libraryPage
          .locator("[data-library-book]")
          .first()
          .evaluate((card) => {
            const title =
              card.querySelector("[data-library-continue] strong") ??
              card.querySelector("strong") ??
              card.querySelector("p");
            const creator = title?.nextElementSibling;
            const measure = (element: Element | null | undefined) => {
              if (!(element instanceof HTMLElement)) return null;
              const rect = element.getBoundingClientRect();
              const hit = document.elementFromPoint(
                rect.left + rect.width / 2,
                rect.top + rect.height / 2,
              );
              return {
                text: element.innerText,
                lang: element.getAttribute("lang"),
                dir: element.getAttribute("dir"),
                direction: getComputedStyle(element).direction,
                painted:
                  element.checkVisibility({ opacityProperty: true, visibilityProperty: true }) &&
                  rect.width > 0 &&
                  rect.height > 0 &&
                  !!hit &&
                  element.contains(hit),
              };
            };
            return { title: measure(title), creator: measure(creator) };
          });
        await page.bringToFront();
        const content = await page.evaluate(async () => {
          const view = Reflect.get(window, "__readerController").contentDocumentViews()[0];
          const doc: Document = view.document;
          const root = doc.documentElement;
          const authored = doc.querySelector("p");
          if (!authored) throw new Error("Pinned metadata content paragraph unavailable.");
          const languages: string[] = [];
          const capture = (element: Element | null) => {
            for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
              for (const value of [
                ancestor.getAttribute("lang"),
                ancestor.getAttributeNS("http://www.w3.org/XML/1998/namespace", "lang"),
              ])
                if (value) languages.push(value);
            }
          };
          capture(authored);
          capture(doc.defaultView?.frameElement ?? null);
          const rect = authored.getBoundingClientRect();
          const frame = doc.defaultView?.frameElement;
          const box = frame?.getBoundingClientRect();
          const x = rect.left + rect.width / 2;
          const y = rect.top + rect.height / 2;
          return {
            sha256: Array.from(
              new Uint8Array(
                await crypto.subtle.digest(
                  "SHA-256",
                  new TextEncoder().encode(authored.textContent!.trim().replace(/\s+/g, " ")),
                ),
              ),
            )
              .map((byte) => byte.toString(16).padStart(2, "0"))
              .join(""),
            painted: !!(
              frame &&
              box &&
              rect.width > 0 &&
              rect.height > 0 &&
              authored.checkVisibility({ opacityProperty: true, visibilityProperty: true }) &&
              frame.checkVisibility({ opacityProperty: true, visibilityProperty: true }) &&
              authored.contains(doc.elementFromPoint(x, y)) &&
              document.elementFromPoint(box.left + x, box.top + y) === frame
            ),
            htmlLang: root.getAttribute("lang"),
            xmlLang: root.getAttributeNS("http://www.w3.org/XML/1998/namespace", "lang"),
            bodyLang: doc.body?.getAttribute("lang") ?? null,
            frameLang: doc.defaultView?.frameElement?.getAttribute("lang") ?? null,
            direction: doc.defaultView!.getComputedStyle(authored).direction,
            languages,
            locale: doc.defaultView!.navigator.language,
          };
        });
        observations = { kind: "package", source: source.package, rendered, content };
      } else if (criterion.kind === "navigation") {
        await page.mouse.move(350, 2);
        const button = page.getByRole("button", { name: "Contents", exact: true });
        const available = (await button.count()) === 1 && (await button.isVisible());
        const activations: {
          path: string;
          title: string | null;
          text: string;
          spineIndex: number;
          found: boolean;
          painted: boolean;
        }[] = [];
        let controls = { available, painted: false, labels: [] as string[] };
        if (available) {
          await button.click();
          const toc = page.getByRole("navigation", { name: "Table of contents" });
          await expect
            .poll(() =>
              toc.evaluate((element) =>
                element
                  .getAnimations({ subtree: true })
                  .every((animation) => animation.playState === "finished"),
              ),
            )
            .toBe(true);
          await expect
            .poll(() =>
              toc.evaluate((element) =>
                element
                  .getAnimations({ subtree: true })
                  .every((animation) => animation.playState === "finished"),
              ),
            )
            .toBe(true);
          const entries = await toc.locator("li button").evaluateAll((buttons) =>
            buttons.map((button) => {
              const rect = button.getBoundingClientRect();
              const hit = document.elementFromPoint(
                rect.left + rect.width / 2,
                rect.top + rect.height / 2,
              );
              return {
                label: button.querySelector("span")?.textContent?.trim().replace(/\s+/g, " ") ?? "",
                painted:
                  button.checkVisibility({ opacityProperty: true, visibilityProperty: true }) &&
                  rect.width > 0 &&
                  rect.height > 0 &&
                  !!hit &&
                  button.contains(hit),
              };
            }),
          );
          controls = {
            available,
            painted:
              (await toc.isVisible()) &&
              entries.length > 0 &&
              entries.every((entry) => entry.painted),
            labels: entries.map((entry) => entry.label),
          };
          if (criterion.id === "nav-activation") {
            for (const [index, link] of source.navigation.entries()) {
              if (index > 0) {
                await page.mouse.move(350, 2);
                await page.getByRole("button", { name: "Contents", exact: true }).click();
              }
              await toc
                .getByRole("button")
                .filter({ has: page.getByText(link.label, { exact: true }) })
                .click();
              await expect
                .poll(() =>
                  page.evaluate(() => !Reflect.get(window, "__readerController").isLoadInFlight),
                )
                .toBe(true);
              activations.push(
                await page.evaluate((link) => {
                  const controller = Reflect.get(window, "__readerController");
                  const snapshot = controller.snapshot();
                  const views: { document: Document; spineIndex: number }[] =
                    controller.contentDocumentViews();
                  const doc = views.find(
                    (view) => view.spineIndex === snapshot.spineIndex,
                  )?.document;
                  const target = link.fragment
                    ? doc?.getElementById(link.fragment)
                    : doc?.body?.firstElementChild;
                  const frame = doc?.defaultView?.frameElement;
                  const range = doc?.createRange();
                  if (target) range?.selectNodeContents(target);
                  const rect = range?.getBoundingClientRect();
                  const box = frame?.getBoundingClientRect();
                  const x = rect ? rect.left + rect.width / 2 : 0;
                  const y = rect ? rect.top + rect.height / 2 : 0;
                  return {
                    path: snapshot.currentSpinePath,
                    title: doc?.title ?? null,
                    text: target?.textContent?.trim().replace(/\s+/g, " ") ?? "",
                    spineIndex: snapshot.spineIndex,
                    found: !!target,
                    painted: !!(
                      target &&
                      rect &&
                      box &&
                      frame &&
                      rect.width > 0 &&
                      rect.height > 0 &&
                      frame.checkVisibility({ opacityProperty: true, visibilityProperty: true }) &&
                      target.contains(doc!.elementFromPoint(x, y)) &&
                      document.elementFromPoint(box.left + x, box.top + y) === frame
                    ),
                  };
                }, link),
              );
            }
          }
        }
        observations = { kind: "navigation", source: source.navigation, controls, activations };
      } else {
        await expect
          .poll(() => page.locator("[data-ambra-roll] iframe").count())
          .toBe(source.frames.length);
        const geometry = await page.evaluate(() => {
          const scroller = document.querySelector<HTMLElement>("[data-ambra-roll]");
          return {
            viewportWidth: scroller?.clientWidth ?? 0,
            frames: Array.from(scroller?.querySelectorAll("iframe") ?? []).map((frame) => {
              const { x, y, width, height } = frame.getBoundingClientRect();
              return { x, y, width, height };
            }),
          };
        });
        const frames = [];
        for (const [index, frame] of geometry.frames.entries()) {
          const measurements = await page.evaluate(async (index) => {
            const frame = document.querySelectorAll<HTMLIFrameElement>("[data-ambra-roll] iframe")[
              index
            ];
            const doc = frame?.contentDocument;
            if (!frame || !doc) throw new Error("Mounted roll document unavailable.");
            const measurements = [];
            for (const [imageIndex, element] of doc.querySelectorAll<HTMLElement | SVGImageElement>(
              "img, image",
            ).entries()) {
              const src =
                element.getAttribute("src") ??
                element.getAttribute("href") ??
                element.getAttributeNS("http://www.w3.org/1999/xlink", "href");
              const packaged = src?.startsWith("blob:") === true;
              let sha256: string | null = null;
              let error: string | null = null;
              const probe = new Image();
              if (packaged) {
                const response = await fetch(src!);
                if (!response.ok) throw new Error(`Packaged image read failed: ${response.status}`);
                sha256 = Array.from(
                  new Uint8Array(
                    await crypto.subtle.digest("SHA-256", await response.arrayBuffer()),
                  ),
                )
                  .map((byte) => byte.toString(16).padStart(2, "0"))
                  .join("");
                probe.src = src!;
                try {
                  await probe.decode();
                } catch (failure) {
                  if (!(failure instanceof DOMException) || failure.name !== "EncodingError")
                    throw failure;
                  error = failure.message;
                }
              }
              frame.scrollIntoView({ block: "start" });
              await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
              const rect = element.getBoundingClientRect();
              const box = frame.getBoundingClientRect();
              const scroller = document.querySelector("[data-ambra-roll]");
              if (!scroller) throw new Error("Native roll scroller is missing.");
              const clip = scroller.getBoundingClientRect();
              const rectangle = ({ x, y, width, height }: DOMRect) => ({ x, y, width, height });
              measurements.push({
                imageIndex,
                sha256,
                packaged,
                error,
                width: probe.naturalWidth,
                height: probe.naturalHeight,
                visible:
                  element.checkVisibility({ opacityProperty: true, visibilityProperty: true }) &&
                  frame.checkVisibility({ opacityProperty: true, visibilityProperty: true }),
                paintGeometry: {
                  frame: rectangle(box),
                  image: rectangle(rect),
                  clip: rectangle(clip),
                  viewport: { width: innerWidth, height: innerHeight },
                  clientWidth: frame.clientWidth,
                  clientHeight: frame.clientHeight,
                },
              });
            }
            return measurements;
          }, index);
          const images = [];
          for (const { imageIndex, visible, paintGeometry, ...decoded } of measurements) {
            const hitPoint = rollImageHitPoint(paintGeometry);
            const painted = visible && hitPoint !== null && await page.evaluate(({ index, imageIndex, hitPoint }) => {
              const frame = document.querySelectorAll<HTMLIFrameElement>("[data-ambra-roll] iframe")[index];
              const doc = frame?.contentDocument;
              const element = doc?.querySelectorAll("img, image")[imageIndex];
              if (!frame || !doc || !element) throw new Error("Native roll paint target is missing.");
              return element.contains(doc.elementFromPoint(hitPoint.document.x, hitPoint.document.y)) &&
                document.elementFromPoint(hitPoint.viewport.x, hitPoint.viewport.y) === frame;
            }, { index, imageIndex, hitPoint });
            images.push({ ...decoded, painted, paintGeometry, hitPoint });
          }
          frames.push({ ...frame, images });
        }
        observations = {
          kind: "roll",
          source: source.frames,
          viewportWidth: geometry.viewportWidth,
          frames,
        };
      }
      return {
        observations,
        passed: foundationVerdict(observations, criterion),
        reason: `Named check foundations.spec.ts: ${criterion.kind} observations use independently parsed pinned sources and native UI/content measurements. See archived scalar evidence; this is not an assistive-technology assessment.`,
        trackingIssue: "https://github.com/BCWalters/ambra/issues/326",
      };
    });
  });
}
