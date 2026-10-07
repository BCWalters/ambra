import { test } from "@playwright/test";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { assessNativeCriterion } from "./native-assessment.js";

interface Criterion {
  readonly id: string;
  readonly kind: "font" | "image";
  readonly family?: string;
}

function criteria(): Criterion[] {
  const profile: unknown = JSON.parse(
    fs.readFileSync(
      fileURLToPath(
        new URL("../../../conformance/epub-3.4/core-media-profile.json", import.meta.url),
      ),
      "utf8",
    ),
  );
  if (!Array.isArray(profile) || profile.length !== 11)
    throw new Error("Invalid core-media profile.");
  return profile.map((raw: unknown) => {
    if (
      !raw ||
      typeof raw !== "object" ||
      !("id" in raw) ||
      typeof raw.id !== "string" ||
      !/^[a-z0-9_-]+$/.test(raw.id) ||
      !("kind" in raw) ||
      (raw.kind !== "font" && raw.kind !== "image")
    )
      throw new Error("Invalid core-media criterion.");
    const family = "family" in raw ? raw.family : undefined;
    if (raw.kind === "font" && (typeof family !== "string" || !family)) {
      throw new Error(`Missing font family for ${raw.id}.`);
    }
    return { id: raw.id, kind: raw.kind, family: typeof family === "string" ? family : undefined };
  });
}

for (const criterion of criteria()) {
  test(`official core-media criterion: ${criterion.id}`, async ({
    browserName: _browserName,
  }, info) => {
    await assessNativeCriterion(criterion.id, info, async launched => {
      const page = launched.readerPage;
      const measured = await page.evaluate(async ({ kind, family }) => {
        const controller = Reflect.get(window, "__readerController");
        const painted = (element: Element, doc: Document): boolean => {
          const frame = doc.defaultView?.frameElement;
          if (
            !(frame instanceof HTMLIFrameElement) ||
            !frame.checkVisibility({ opacityProperty: true, visibilityProperty: true })
          )
            return false;
          const range = doc.createRange();
          range.selectNodeContents(element);
          const rect =
            element.localName === "img"
              ? element.getBoundingClientRect()
              : range.getBoundingClientRect();
          const box = frame.getBoundingClientRect();
          const x = rect.left + rect.width / 2;
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            [rect.top + 1, rect.bottom - 1].every(
              (y) =>
                element.contains(doc.elementFromPoint(x, y)) &&
                document.elementFromPoint(box.left + x, box.top + y) === frame,
            )
          );
        };
        const fonts: {
          family: string;
          status: string;
          used: boolean;
          painted: boolean;
          distinctGlyphs: boolean;
        }[] = [];
        const images: {
          complete: boolean;
          width: number;
          height: number;
          painted: boolean;
          packaged: boolean;
          decodeError: string | null;
        }[] = [];
        for (const view of controller.contentDocumentViews() as { document: Document }[]) {
          const doc = view.document;
          await doc.fonts.ready;
          if (kind === "font") {
            for (const face of doc.fonts) {
              if (face.family.replace(/^['"]|['"]$/g, "") !== family) continue;
              const users = Array.from(doc.body?.querySelectorAll("*") ?? []).filter(
                (element) =>
                  element.textContent?.trim() &&
                  doc
                    .defaultView!.getComputedStyle(element)
                    .fontFamily.split(",")
                    .some((value) => value.trim().replace(/^['"]|['"]$/g, "") === family),
              );
              const canvas = doc.createElement("canvas");
              canvas.width = 800;
              canvas.height = 100;
              const context = canvas.getContext("2d");
              if (!context) throw new Error("Native glyph-rasterization context unavailable.");
              context.font = `48px "${family}"`;
              context.fillText("Ambra glyph probe 0123456789", 0, 65);
              const actual = context.getImageData(0, 0, canvas.width, canvas.height).data;
              context.clearRect(0, 0, canvas.width, canvas.height);
              context.font = "48px serif";
              context.fillText("Ambra glyph probe 0123456789", 0, 65);
              const fallback = context.getImageData(0, 0, canvas.width, canvas.height).data;
              fonts.push({
                family: face.family,
                status: face.status,
                used: users.length > 0,
                painted: users.some((element) => painted(element, doc)),
                distinctGlyphs: actual.some((value, index) => value !== fallback[index]),
              });
            }
          } else {
            for (const image of doc.images) {
              let decodeError: string | null = null;
              if (image.getAttribute("src")?.startsWith("blob:")) {
                try {
                  await image.decode();
                } catch (error) {
                  if (
                    !error ||
                    typeof error !== "object" ||
                    !("name" in error) ||
                    error.name !== "EncodingError"
                  )
                    throw error;
                  decodeError =
                    "message" in error && typeof error.message === "string"
                      ? error.message
                      : "Native image decoding failed.";
                }
              }
              images.push({
                complete: image.complete,
                width: image.naturalWidth,
                height: image.naturalHeight,
                painted: painted(image, doc),
                packaged: image.getAttribute("src")?.startsWith("blob:") === true,
                decodeError,
              });
            }
          }
        }
        return { fonts, images };
      }, criterion);
      const passed =
        criterion.kind === "font"
          ? measured.fonts.length > 0 &&
            measured.fonts.every(
              (face) =>
                face.status === "loaded" && face.used && face.painted && face.distinctGlyphs,
            )
          : measured.images.length > 0 &&
            measured.images.every(
              (image) =>
                image.complete &&
                image.width > 0 &&
                image.height > 0 &&
                image.painted &&
                image.packaged &&
                image.decodeError === null,
            );
      return {
        observations: measured,
        passed,
        reason:
          criterion.kind === "font"
            ? "Named check core-media.spec.ts requires the pinned font to be natively loaded, used by authored visible content, and rasterize original probe glyphs differently from generic serif. See archived observations."
            : "Named check core-media.spec.ts requires every pinned image to decode from a packaged blob and pass native hit-testing in both the content frame and shell. See archived observations.",
        trackingIssue: "https://github.com/BCWalters/ambra/issues/328",
      };
    });
  });
}
