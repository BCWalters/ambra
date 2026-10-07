import { expect, test, type TestInfo } from "@playwright/test";
import { strToU8, zipSync } from "fflate";
import fs from "node:fs";
import { launchReader } from "../harness.js";
import { exposeReaderController, isReaderElementPainted } from "../reader-controller.js";

type Profile = "epub2" | "missing-nav" | "malformed-nav" | "modern-nav";
function publication(info: TestInfo, profile: Profile): string {
  const legacy = profile === "epub2";
  const declaration = (property: string, value: string) =>
    legacy
      ? `<meta name="${property}" content="${value}"/>`
      : `<meta property="${property}">${value}</meta>`;
  const entries: Record<string, Uint8Array> = {
    mimetype: strToU8("application/epub+zip"),
    "META-INF/container.xml":
      strToU8(`<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles>
      <rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`),
    "EPUB/package.opf":
      strToU8(`<package xmlns="http://www.idpf.org/2007/opf" version="${legacy ? "2.0" : "3.0"}" unique-identifier="id">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:ambra:original-navigation:${profile}</dc:identifier>
      <dc:title>Original navigation and accessibility</dc:title><dc:language>en</dc:language>
      ${declaration("schema:accessMode", "textual")}
      ${declaration("schema:accessModeSufficient", "textual")}
      ${declaration("schema:accessibilityFeature", "readingOrder")}
      ${declaration("schema:accessibilityHazard", "unknown")}
      ${declaration("schema:accessibilitySummary", "Original publisher accessibility statement.")}
      ${declaration("dcterms:conformsTo", "EPUB Accessibility 1.2 - WCAG 2.2 Level AA")}
      ${declaration("a11y:certifiedBy", "Original publisher certifier")}
      ${declaration("a11y:certificationDate", "2026-10-06")}
      ${declaration("a11y:certifierCredential", "Original declared credential")}
      ${declaration("a11y:certifierReport", "https://claims.invalid/report")}
      ${declaration("a11y:contactEmail", "publisher@claims.invalid")}
      </metadata><manifest>${legacy ? "" : '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>'}
      <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
      <item id="one" href="one.xhtml" media-type="application/xhtml+xml"/>
      <item id="two" href="two.xhtml" media-type="application/xhtml+xml"/></manifest>
      <spine toc="ncx"><itemref idref="one"/><itemref idref="two"/></spine>
      <guide><reference type="text" title="Start" href="one.xhtml"/><reference type="loi" title="Figure" href="two.xhtml#figure"/></guide></package>`),
    "EPUB/toc.ncx": strToU8(`<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
      <navMap><navPoint id="one"><navLabel><text>Compatible chapter</text></navLabel><content src="one.xhtml"/></navPoint></navMap>
      <navList><navLabel><text>Illustrations</text></navLabel><navTarget id="figure"><navLabel><text>Figure one</text></navLabel><content src="two.xhtml#figure"/></navTarget>
      <navTarget id="blocked"><navLabel><text>Blocked file target</text></navLabel><content src="file:///tmp/ambra-never-opened"/></navTarget></navList></ncx>`),
    "EPUB/one.xhtml": strToU8(
      '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>One</title></head><body><h1>Original first chapter</h1><p>Original navigation fixture.</p></body></html>',
    ),
    "EPUB/two.xhtml": strToU8(
      '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Two</title></head><body><h1 id="figure">Original second chapter figure</h1><p>Original illustration alternative.</p></body></html>',
    ),
  };
  if (profile === "modern-nav")
    entries["EPUB/nav.xhtml"] = strToU8(
      '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol><li><a href="one.xhtml">Modern chapter</a></li></ol></nav></body></html>',
    );
  if (profile === "malformed-nav") entries["EPUB/nav.xhtml"] = strToU8("<html");
  const file = info.outputPath(`${profile}.epub`);
  fs.writeFileSync(file, zipSync(entries, { level: 0 }));
  return file;
}

for (const profile of ["epub2", "missing-nav", "malformed-nav", "modern-nav"] as const) {
  test(`${profile}: preferred navigation, surfaced recovery and legacy list activation`, async ({
    browserName: _browserName,
  }, info) => {
    const { context, readerPage: page } = await launchReader(publication(info, profile));
    try {
      await exposeReaderController(page);
      const state = await page.evaluate(() => {
        const controller = Reflect.get(window, "__readerController");
        return {
          toc: controller.navigation.toc.items.map((item: { label: string }) => item.label),
          lists: controller.navigation.additionalLists.map((list: { label: string }) => list.label),
          landmarks: controller.navigation.landmarks.items.map(
            (item: { epubTypes: string[] }) => item.epubTypes,
          ),
          diagnostics: controller.navigation.diagnostics,
        };
      });
      await info.attach("navigation-conformance-evidence.json", {
        body: JSON.stringify({ profile, state }),
        contentType: "application/json",
      });
      expect(state.toc).toEqual([
        profile === "modern-nav" ? "Modern chapter" : "Compatible chapter",
      ]);
      expect(state.landmarks).toEqual([["bodymatter"], ["loi"]]);
      expect(state.diagnostics).toHaveLength(
        profile === "missing-nav" || profile === "malformed-nav" ? 1 : 0,
      );
      if (profile === "missing-nav" || profile === "malformed-nav") {
        await expect(
          page.getByText(/Its compatible Table of Contents is being used instead/),
        ).toBeVisible();
      }
      await page.mouse.move(350, 2);
      await page.getByRole("button", { name: "Contents", exact: true }).click();
      const contents = page.getByRole("navigation", { name: "Table of contents" });
      if (profile === "modern-nav") {
        expect(state.lists).toEqual([]);
        await expect(contents.locator("summary")).toHaveCount(0);
      } else {
        expect(state.lists).toEqual(["Illustrations"]);
        await contents.locator("summary").filter({ hasText: "Illustrations" }).press("Enter");
        await contents.getByRole("button", { name: /Figure one/ }).click();
        await expect
          .poll(() =>
            page.evaluate(() => {
              const controller = Reflect.get(window, "__readerController");
              return (
                controller.snapshot().currentSpinePath === "EPUB/two.xhtml" &&
                !controller.isLoadInFlight
              );
            }),
          )
          .toBe(true);
        await expect.poll(() => isReaderElementPainted(page, "figure")).toBe(true);
        await page.evaluate(() => {
          const controller = Reflect.get(window, "__readerController");
          return controller.goToNavPoint(controller.navigation.additionalLists[0].items[1]);
        });
        await expect(
          page.getByText(
            "For your safety, this book cannot open file, data, or unsupported links.",
          ),
        ).toBeVisible();
      }
    } finally {
      await context.close();
    }
  });
}

test("Accessibility 1.2 declarations agree in Reader and Library, including old stored-copy refresh", async ({
  browserName: _browserName,
}, info) => {
  const requests: string[] = [];
  const { context, readerPage, libraryPage } = await launchReader(publication(info, "modern-nav"), {
    beforeBookImport: async (page) => {
      page.context().on("request", (request) => {
        if (request.url().includes("claims.invalid")) requests.push(request.url());
      });
      await page.context().route("**/claims.invalid/**", (route) => route.abort());
    },
  });
  try {
    await readerPage.mouse.move(350, 2);
    await readerPage.getByRole("button", { name: "Book details", exact: true }).click();
    const reader = readerPage.getByRole("complementary", { name: "Book details" });
    await reader.getByRole("button", { name: "Publication details", exact: true }).click();
    const readerClaims = reader.getByRole("region", { name: "Publisher-declared accessibility" });
    const expected = [
      "Original publisher certifier",
      "Original declared credential",
      "https://claims.invalid/report",
      "publisher@claims.invalid",
      "2026-10-06",
      "unknown",
      "EPUB Accessibility 1.2 - WCAG 2.2 Level AA",
    ];
    for (const value of expected)
      await expect(readerClaims.getByText(value, { exact: true })).toBeVisible();
    await expect(
      readerClaims.getByText(/has not independently verified or certified/),
    ).toBeVisible();
    await libraryPage.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const request = indexedDB.open("ambra-library");
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const database = request.result;
            const transaction = database.transaction("books", "readwrite");
            const store = transaction.objectStore("books");
            const records = store.getAll();
            records.onerror = () => reject(records.error);
            records.onsuccess = () => {
              const book = records.result[0];
              if (!book) {
                transaction.abort();
                reject(new Error("Original fixture record is missing"));
                return;
              }
              const {
                accessModes,
                accessibilityFeatures,
                accessibilityHazards,
                accessibilitySummary,
              } = book.accessibility;
              book.accessibility = {
                accessModes,
                accessibilityFeatures,
                accessibilityHazards,
                accessibilitySummary,
              };
              delete book.metadataLocalization;
              store.put(book);
            };
            transaction.oncomplete = () => {
              database.close();
              resolve();
            };
            transaction.onerror = () => {
              database.close();
              reject(transaction.error);
            };
            transaction.onabort = () => {
              database.close();
              reject(transaction.error ?? new Error("Metadata transaction aborted"));
            };
          };
        }),
    );
    await libraryPage.reload();
    await libraryPage
      .getByRole("button", { name: "Original navigation and accessibility details", exact: true })
      .click();
    const library = libraryPage.getByRole("dialog", { name: "Book details", exact: true });
    await library.getByRole("button", { name: "Publication details", exact: true }).click();
    const libraryClaims = library.getByRole("region", { name: "Publisher-declared accessibility" });
    for (const value of expected)
      await expect(libraryClaims.getByText(value, { exact: true })).toBeVisible();
    await expect(
      libraryClaims.getByText(/has not independently verified or certified/),
    ).toBeVisible();
    expect(await readerClaims.textContent()).toBe(await libraryClaims.textContent());
    await expect(libraryClaims.locator("a, img, iframe, script")).toHaveCount(0);
    expect(requests).toEqual([]);
    await info.attach("accessibility-conformance-evidence.json", {
      body: JSON.stringify({ publisherClaims: expected, oldCopyRefreshed: true, requests }),
      contentType: "application/json",
    });
  } finally {
    await context.close();
  }
});
