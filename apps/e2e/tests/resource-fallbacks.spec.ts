import { expect, test, type TestInfo } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

const script = fileURLToPath(
  new URL("../scripts/generate-resource-fallback-media.py", import.meta.url),
);

function fixture(info: TestInfo, layout: string): string {
  const root = info.outputPath("fallback-source");
  const media = path.join(root, "EPUB/media");
  fs.mkdirSync(path.join(root, "META-INF"), { recursive: true });
  execFileSync(process.env.AMBRA_E2E_MEDIA_PYTHON ?? "python3", [script, media]);
  const write = (name: string, text: string) => fs.writeFileSync(path.join(root, name), text);
  write("mimetype", "application/epub+zip");
  write(
    "META-INF/container.xml",
    '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
  );
  const items = [
    '<item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml" media-overlay="overlay"/>',
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="overlay" href="overlay.smil" media-type="application/smil+xml"/>',
    '<item id="foreign-css" href="foreign-css.bin" media-type="application/foreign" fallback="css"/>',
    '<item id="css" href="media/style.css" media-type="text/css"/>',
    '<item id="foreign-image" href="foreign-image.bin" media-type="application/foreign" fallback="svg"/>',
    '<item id="svg" href="media/image.svg" media-type="image/svg+xml"/>',
    '<item id="avif" href="media/image.avif" media-type="image/avif" fallback="svg"/>',
    '<item id="jxl" href="media/image.jxl" media-type="image/jxl" fallback="svg"/>',
    '<item id="foreign-audio" href="foreign-audio.bin" media-type="application/foreign" fallback="aac"/>',
    '<item id="aac" href="media/aac.mp4" media-type="audio/mp4"/>',
    '<item id="opus" href="media/opus.mp4" media-type="audio/mp4"/>',
    '<item id="foreign-video" href="foreign-video.bin" media-type="application/foreign" fallback="video"/>',
    '<item id="video" href="media/video.mp4" media-type="video/mp4"/>',
    '<item id="exhausted" href="exhausted.bin" media-type="application/foreign"/>',
    '<item id="missing" href="missing.bin" media-type="application/foreign" fallback="no-such-id"/>',
    '<item id="cycle-a" href="cycle-a.bin" media-type="application/foreign" fallback="cycle-b"/>',
    '<item id="cycle-b" href="cycle-b.bin" media-type="application/foreign" fallback="cycle-a"/>',
    '<item id="document-object" href="document.xhtml" media-type="application/xhtml+xml"/>',
  ];
  for (const format of ["otf", "ttf", "woff", "woff2"]) {
    items.push(
      `<item id="foreign-${format}" href="media/foreign-${format}.bin" media-type="application/foreign" fallback="${format}"/>`,
    );
    items.push(`<item id="${format}" href="media/font.${format}" media-type="font/${format}"/>`);
    write(`EPUB/media/foreign-${format}.bin`, "Synthetic unsupported font format");
  }
  for (const file of [
    "foreign-css",
    "foreign-image",
    "foreign-audio",
    "foreign-video",
    "exhausted",
    "missing",
    "cycle-a",
    "cycle-b",
  ]) {
    write(`EPUB/${file}.bin`, "Synthetic unsupported format");
  }
  write(
    "EPUB/package.opf",
    `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:ambra:fallbacks:${layout}</dc:identifier><dc:title>Resource fallbacks</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2026-10-06T00:00:00Z</meta><meta property="rendition:layout">${layout}</meta><meta property="rendition:spread">none</meta></metadata><manifest>${items.join("")}</manifest><spine><itemref idref="chapter"/></spine></package>`,
  );
  write(
    "EPUB/nav.xhtml",
    '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol><li><a href="chapter.xhtml">Resource fallbacks</a></li></ol></nav></body></html>',
  );
  write(
    "EPUB/media/image.svg",
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="24"><view id="view" viewBox="0 0 32 24"/><rect width="32" height="24" fill="green"/></svg>',
  );
  write(
    "EPUB/media/style.css",
    '@import "../foreign-css.bin";#background{background-image:url("../foreign-image.bin#view");width:32px;height:24px}' +
      ["otf", "ttf", "woff", "woff2"]
        .map(
          (format) =>
            `@font-face{font-family:Synthetic_${format};src:url(foreign-${format}.bin) format("foreign")}#font-${format}{font-family:Synthetic_${format}!important}`,
        )
        .join(""),
  );
  write(
    "EPUB/document.xhtml",
    '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Blocked object</title></head><body>Must not create a nested document</body></html>',
  );
  write(
    "EPUB/chapter.xhtml",
    `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Resource fallbacks</title><meta name="viewport" content="width=600,height=800"/><link rel="stylesheet" href="foreign-css.bin"/></head><body><h1>Resource fallbacks</h1><p id="passage">Read this passage.</p>
    <img id="image" src="foreign-image.bin#view" alt="Foreign image"/><img id="avif" src="media/image.avif"/><img id="jxl" src="media/image.jxl"/>
    <picture><source id="picture" type="application/foreign" srcset="cycle-a.bin 1x, foreign-image.bin 2x, missing.bin 3x"/><img id="responsive" src="foreign-image.bin" alt="Responsive image"/></picture>
    <object id="object" width="32" height="24" data="foreign-image.bin">Object alternative</object>
    <object id="blocked-object" data="document.xhtml">Document object alternative</object>
    <img id="unavailable" src="exhausted.bin" alt="Unavailable illustration"/>
    <div id="background">CSS</div>${["otf", "ttf", "woff", "woff2"].map((format) => `<span id="font-${format}">A</span>`).join("")}
    <audio id="aac" preload="metadata"><source id="audio-source" src="foreign-audio.bin" type="application/foreign"/></audio>
    <audio id="opus" src="media/opus.mp4" preload="metadata"/>
    <video id="video" src="foreign-video.bin" poster="foreign-image.bin" preload="metadata"/>
    </body></html>`,
  );
  write(
    "EPUB/overlay.smil",
    '<smil xmlns="http://www.w3.org/ns/SMIL" version="3.0"><body><seq><par><text src="chapter.xhtml#passage"/><audio src="foreign-audio.bin" clipBegin="0s" clipEnd="1s"/></par></seq></body></smil>',
  );
  const target = info.outputPath("resource-fallbacks.epub");
  execFileSync("zip", ["-q", "-X", "-0", target, "mimetype"], { cwd: root });
  execFileSync("zip", ["-q", "-X", "-r", target, "META-INF", "EPUB"], { cwd: root });
  return target;
}

for (const layout of ["reflowable", "pre-paginated", "roll"]) {
  test(`${layout}: selects native media and ordered fallbacks without blocking unrelated content`, async ({
    page: unusedPage,
  }, info) => {
    void unusedPage;
    const { context, readerPage: page } = await launchReader(fixture(info, layout));
    try {
      await expect(
        page.getByRole("status").filter({ hasText: "no usable fallback" }),
      ).toBeVisible();
      await exposeReaderController(page);
      await page.waitForFunction(() => {
        const controller = Reflect.get(window, "__readerController");
        return (
          !controller.isLoadInFlight &&
          controller.contentDocumentViews()[0]?.document.getElementById("passage")
        );
      });
      await expect
        .poll(() =>
          page.evaluate(() => {
            const doc: Document = Reflect.get(
              window,
              "__readerController",
            ).contentDocumentViews()[0].document;
            return ["aac", "opus", "video"].every(
              (id) => (doc.getElementById(id) as HTMLMediaElement).readyState >= 1,
            );
          }),
        )
        .toBe(true);
      const result = await page.evaluate(async () => {
        const controller = Reflect.get(window, "__readerController");
        const doc: Document = controller.contentDocumentViews()[0].document;
        await doc.fonts.ready;
        const images = [];
        for (const id of ["image", "avif", "jxl", "responsive", "object"]) {
          const image = doc.getElementById(id) as HTMLImageElement;
          await image.decode();
          const blob = await (await fetch(image.currentSrc)).blob();
          images.push({
            id,
            width: image.naturalWidth,
            height: image.naturalHeight,
            type: blob.type,
          });
        }
        const nativeTypes: Record<string, boolean> = {};
        for (const format of ["avif", "jxl"]) {
          const bytes = await controller.contentLoader.loadResourceBytes(
            `EPUB/media/image.${format}`,
          );
          const url = URL.createObjectURL(new Blob([bytes], { type: `image/${format}` }));
          try {
            const image = new Image();
            image.src = url;
            nativeTypes[format] = await image.decode().then(
              () => true,
              () => false,
            );
          } finally {
            URL.revokeObjectURL(url);
          }
        }
        const fonts = Array.from(doc.fonts)
          .filter((face) => face.family.startsWith("Synthetic_"))
          .map((face) => ({ family: face.family, status: face.status }));
        const media = ["aac", "opus", "video"].map((id) => {
          const element = doc.getElementById(id) as HTMLMediaElement;
          return {
            id,
            duration: element.duration,
            ready: element.readyState,
            error: element.error?.code ?? null,
            paused: element.paused,
          };
        });
        const background = doc.defaultView!.getComputedStyle(
          doc.getElementById("background")!,
        ).backgroundImage;
        return {
          images,
          nativeTypes,
          fonts,
          media,
          background,
          sourceType: doc.getElementById("audio-source")?.getAttribute("type"),
          pictureType: doc.getElementById("picture")?.getAttribute("type"),
          candidates: doc.getElementById("picture")?.getAttribute("srcset"),
          unavailable: doc.getElementById("unavailable")?.hasAttribute("src"),
          objectTag: doc.getElementById("object")?.localName,
          blockedObject: doc.getElementById("blocked-object")?.hasAttribute("data"),
          alternative: doc.getElementById("blocked-object")?.textContent,
          policy: doc
            .querySelector('meta[http-equiv="Content-Security-Policy"]')
            ?.getAttribute("content"),
          sandbox: doc.defaultView?.frameElement?.getAttribute("sandbox"),
        };
      });
      await info.attach("resource-fallback-evidence.json", {
        body: JSON.stringify(result),
        contentType: "application/json",
      });
      expect(result.images.map((image) => [image.width, image.height])).toEqual([
        [32, 24],
        [32, 24],
        [32, 24],
        [16, 12],
        [32, 24],
      ]);
      expect(result.images.find((image) => image.id === "avif")?.type).toBe(
        result.nativeTypes.avif ? "image/avif" : "image/svg+xml",
      );
      expect(result.images.find((image) => image.id === "jxl")?.type).toBe(
        result.nativeTypes.jxl ? "image/jxl" : "image/svg+xml",
      );
      expect(result.nativeTypes.avif, "EPUB 3.4 AVIF decoder capability").toBe(true);
      expect(result.fonts.map((font) => font.family).sort()).toEqual([
        "Synthetic_otf",
        "Synthetic_ttf",
        "Synthetic_woff",
        "Synthetic_woff2",
      ]);
      expect(result.fonts.every((font) => font.status === "loaded")).toBe(true);
      expect(
        result.media.every(
          (media) =>
            media.duration >= 1.9 && media.ready >= 1 && media.error === null && media.paused,
        ),
      ).toBe(true);
      expect(result.sourceType).toBe("audio/mp4");
      expect(result.pictureType).toBe("image/svg+xml");
      expect(result.candidates).toMatch(/^\s*blob:[^ ]+ 2x,\s*$/);
      expect(result.background).toMatch(/^url\("blob:/);
      expect(result.unavailable).toBe(false);
      expect(result.objectTag).toBe("img");
      expect(result.blockedObject).toBe(false);
      expect(result.alternative).toBe("Document object alternative");
      expect(result.policy).toContain("default-src 'none'");
      expect(result.policy).not.toContain("object-src");
      expect(result.sandbox).toBe("allow-same-origin");

      await page
        .getByRole("region", { name: "Narration controls" })
        .getByRole("button", { name: "Play narration", exact: true })
        .click();
      await expect
        .poll(() =>
          page.locator("audio[data-ambra-narration-audio]").evaluate((element) => {
            const audio = element as HTMLAudioElement;
            return !audio.paused && audio.currentTime > 0 && !audio.error;
          }),
        )
        .toBe(true);
      const narration = await page
        .locator("audio[data-ambra-narration-audio]")
        .evaluate(
          async (element) =>
            (await (await fetch((element as HTMLAudioElement).currentSrc)).blob()).type,
        );
      expect(narration).toBe("audio/mp4");
      await info.attach("native-capabilities.json", {
        body: JSON.stringify(result.nativeTypes),
        contentType: "application/json",
      });
    } finally {
      await context.close();
    }
  });
}
