// @vitest-environment happy-dom
import { readFile } from "node:fs/promises";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { EpubContainer } from "./EpubContainer.js";
import { PackageDocument, PackageDocumentError, parseViewportDimensions } from "./PackageDocument.js";
import { CfiStep } from "../locator/EpubCfi.js";

async function loadFixture(name: string): Promise<Uint8Array> {
  const buffer = await readFile(
    fileURLToPath(new NodeURL(`../../test/fixtures/${name}`, import.meta.url)),
  );
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

describe("parseViewportDimensions", () => {
  it("parses width/height from a comma-separated string", () => {
    expect(parseViewportDimensions("width=1000, height=1400")).toEqual({ width: 1000, height: 1400 });
  });

  it("parses width/height regardless of spacing/order", () => {
    expect(parseViewportDimensions("height=800,width=600")).toEqual({ width: 600, height: 800 });
  });

  it("returns undefined when height is missing", () => {
    expect(parseViewportDimensions("width=1000")).toBeUndefined();
  });

  it("returns undefined for a non-positive dimension", () => {
    expect(parseViewportDimensions("width=0, height=1400")).toBeUndefined();
  });

  it("returns undefined for null/undefined/empty input", () => {
    expect(parseViewportDimensions(null)).toBeUndefined();
    expect(parseViewportDimensions(undefined)).toBeUndefined();
    expect(parseViewportDimensions("")).toBeUndefined();
  });
});

describe("PackageDocument (reflowable fixture)", () => {
  let pkg: PackageDocument;

  beforeAll(async () => {
    const container = await EpubContainer.open(await loadFixture("minimal.epub"));
    pkg = await container.getPackageDocument();
  });

  it("parses core dc metadata", () => {
    expect(pkg.metadata.identifier).toBe("urn:uuid:8f8a2c1e-2f1a-4a3b-9c1d-000000000001");
    expect(pkg.metadata.title).toBe("Ambra Minimal Test Fixture");
    expect(pkg.metadata.language).toBe("en");
  });

  it("leaves creator undefined when no dc:creator is present", () => {
    expect(pkg.metadata.creator).toBeUndefined();
  });

  it("parses dc:creator when present (long-content fixture)", async () => {
    const container = await EpubContainer.open(await loadFixture("long-content.epub"));
    const withCreator = await container.getPackageDocument();
    expect(withCreator.metadata.creator).toBe("Ada Lovelace");
  });

  it("defaults rendition layout to reflowable when no rendition:layout meta is present", () => {
    expect(pkg.metadata.renditionLayout).toBe("reflowable");
  });

  it("defaults rendition:spread to auto and page-progression-direction to default when neither is declared", () => {
    expect(pkg.metadata.renditionSpread).toBe("auto");
    expect(pkg.pageProgressionDirection).toBe("default");
  });

  it("resolves manifest item hrefs to archive-relative paths", () => {
    const nav = pkg.getManifestItem("nav");
    const chapter1 = pkg.getManifestItem("chapter1");

    expect(nav?.path).toBe("OEBPS/nav.xhtml");
    expect(chapter1?.path).toBe("OEBPS/chapter1.xhtml");
  });

  it("identifies the nav document via its nav property", () => {
    expect(pkg.findNavDocument()?.id).toBe("nav");
  });

  it("parses spine order and defaults itemref linear to true", () => {
    expect(pkg.spine).toHaveLength(1);
    expect(pkg.spine[0]?.manifestItem.id).toBe("chapter1");
    expect(pkg.spine[0]?.linear).toBe(true);
  });

  it("computes the CFI package-steps path for each spine item from the raw OPF DOM", () => {
    // <package>'s element children are metadata (1st, step 2), manifest
    // (2nd, step 4), spine (3rd, step 6); <spine>'s only child is the
    // single itemref (1st, step 2).
    const steps = pkg.spine[0]?.packageCfiSteps;
    expect(steps?.map((s) => s.index)).toEqual([6, 2]);
    expect(steps?.every((s) => s.idAssertion === undefined)).toBe(true);
  });

  it("finds a spine index by matching package CFI steps", () => {
    const steps = pkg.spine[0]!.packageCfiSteps;
    expect(pkg.findSpineIndexByPackageCfiSteps(steps)).toBe(0);
    expect(pkg.findSpineIndexByPackageCfiSteps([new CfiStep(6)])).toBeUndefined();
  });
});

describe("PackageDocument (fixed-layout fixture)", () => {
  let pkg: PackageDocument;

  beforeAll(async () => {
    const container = await EpubContainer.open(await loadFixture("fixed-layout.epub"));
    pkg = await container.getPackageDocument();
  });

  it("reads a publication-wide pre-paginated rendition:layout", () => {
    expect(pkg.metadata.renditionLayout).toBe("pre-paginated");
  });

  it("reads the package-level rendition:spread (folded from the fixture's own 'both')", () => {
    expect(pkg.metadata.renditionSpread).toBe("both");
  });

  it("reads the package-level rendition:viewport", () => {
    expect(pkg.metadata.renditionViewport).toEqual({ width: 1200, height: 1600 });
  });

  it("resolves manifest item hrefs nested in subdirectories", () => {
    expect(pkg.getManifestItem("cover-image")?.path).toBe("OEBPS/images/cover.png");
  });

  it("parses manifest item properties (e.g. cover-image)", () => {
    expect(pkg.getManifestItem("cover-image")?.hasProperty("cover-image")).toBe(true);
  });

  it("applies the package-wide rendition layout to a spine item with no override", () => {
    const page1 = pkg.spine.find((ref) => ref.manifestItem.id === "page1");
    expect(page1?.resolveRenditionLayout(pkg.metadata.renditionLayout)).toBe("pre-paginated");
  });

  it("applies a per-spine-item rendition:layout-reflowable override", () => {
    const page2 = pkg.spine.find((ref) => ref.manifestItem.id === "page2");
    expect(page2?.hasProperty("rendition:layout-reflowable")).toBe(true);
    expect(page2?.resolveRenditionLayout(pkg.metadata.renditionLayout)).toBe("reflowable");
  });

  it("computes distinct package CFI steps for each of several spine items", () => {
    const page1Steps = pkg.spine[0]!.packageCfiSteps;
    const page2Steps = pkg.spine[1]!.packageCfiSteps;

    expect(page1Steps.map((s) => s.index)).not.toEqual(page2Steps.map((s) => s.index));
    expect(pkg.findSpineIndexByPackageCfiSteps(page1Steps)).toBe(0);
    expect(pkg.findSpineIndexByPackageCfiSteps(page2Steps)).toBe(1);
  });

  it("matches package CFI steps by index only, ignoring a mismatched id assertion", () => {
    // findSpineIndexByPackageCfiSteps deliberately compares step indices
    // only, not id assertions — those are a supplementary check performed
    // separately, only for *content* steps, during LocatorResolver's
    // resolution (see Locator.ts's verifyIdAssertion). A wrong id
    // assertion on a package step must not prevent finding the spine item.
    const realSteps = pkg.spine[1]!.packageCfiSteps;
    const tamperedSteps = realSteps.map((s) => new CfiStep(s.index, "not-the-real-id"));

    expect(pkg.findSpineIndexByPackageCfiSteps(tamperedSteps)).toBe(1);
  });

  it("defaults page-progression-direction to default when the spine doesn't declare one", () => {
    expect(pkg.pageProgressionDirection).toBe("default");
  });

  it("leaves pageSpread undefined for a spine item with no page-spread-* property", () => {
    expect(pkg.spine[0]?.pageSpread).toBeUndefined();
  });
});

describe("PackageDocument (fixed-layout-spread fixture)", () => {
  let pkg: PackageDocument;

  beforeAll(async () => {
    const container = await EpubContainer.open(await loadFixture("fixed-layout-spread.epub"));
    pkg = await container.getPackageDocument();
  });

  it("reads the package-level rendition:spread", () => {
    expect(pkg.metadata.renditionSpread).toBe("landscape");
  });

  it("reads the spine's page-progression-direction", () => {
    expect(pkg.pageProgressionDirection).toBe("rtl");
  });

  it("resolves page-spread-right/left/center properties to the matching PageSpreadSide", () => {
    const page1 = pkg.spine.find((ref) => ref.manifestItem.id === "page1");
    const page2 = pkg.spine.find((ref) => ref.manifestItem.id === "page2");
    const page3 = pkg.spine.find((ref) => ref.manifestItem.id === "page3");
    const page4 = pkg.spine.find((ref) => ref.manifestItem.id === "page4");

    expect(page1?.pageSpread).toBe("right");
    expect(page2?.pageSpread).toBe("left");
    expect(page3?.pageSpread).toBe("center");
    expect(page4?.pageSpread).toBeUndefined();
  });
});

describe("PackageDocument error handling", () => {
  it("throws PackageDocumentError when a spine itemref references an unknown manifest id", () => {
    const xml = `<?xml version="1.0"?>
      <package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">
        <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
          <dc:identifier id="pub-id">urn:uuid:test</dc:identifier>
          <dc:title>Test</dc:title>
          <dc:language>en</dc:language>
        </metadata>
        <manifest>
          <item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>
        </manifest>
        <spine>
          <itemref idref="does-not-exist"/>
        </spine>
      </package>`;

    expect(() => PackageDocument.parse(xml, "OEBPS/content.opf")).toThrow(PackageDocumentError);
  });

  it("throws PackageDocumentError when required dc:metadata is missing", () => {
    const xml = `<?xml version="1.0"?>
      <package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">
        <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
          <dc:title>Test</dc:title>
        </metadata>
        <manifest></manifest>
        <spine></spine>
      </package>`;

    expect(() => PackageDocument.parse(xml, "OEBPS/content.opf")).toThrow(PackageDocumentError);
  });

  it("throws PackageDocumentError when the <manifest> element is missing entirely", () => {
    const xml = `<?xml version="1.0"?>
      <package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">
        <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
          <dc:identifier id="pub-id">urn:uuid:test</dc:identifier>
          <dc:title>Test</dc:title>
          <dc:language>en</dc:language>
        </metadata>
        <spine></spine>
      </package>`;

    expect(() => PackageDocument.parse(xml, "OEBPS/content.opf")).toThrow(PackageDocumentError);
  });
});

describe("PackageDocument unique-identifier resolution", () => {
  const buildXml = (
    metadataInner: string,
    uniqueIdentifier = "pub-id",
  ): string => `<?xml version="1.0"?>
    <package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="${uniqueIdentifier}">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
        ${metadataInner}
        <dc:title>Test</dc:title>
        <dc:language>en</dc:language>
      </metadata>
      <manifest></manifest>
      <spine></spine>
    </package>`;

  it("resolves the dc:identifier matching <package unique-identifier>, not just the first one", () => {
    const xml = buildXml(`
      <dc:identifier id="isbn-id">urn:isbn:9780000000000</dc:identifier>
      <dc:identifier id="pub-id">urn:uuid:the-real-one</dc:identifier>
    `);

    const pkg = PackageDocument.parse(xml, "OEBPS/content.opf");

    expect(pkg.metadata.identifier).toBe("urn:uuid:the-real-one");
  });

  it("falls back to the first dc:identifier when unique-identifier doesn't match any id", () => {
    const xml = buildXml(
      `<dc:identifier id="some-other-id">urn:uuid:fallback</dc:identifier>`,
      "does-not-match-anything",
    );

    const pkg = PackageDocument.parse(xml, "OEBPS/content.opf");

    expect(pkg.metadata.identifier).toBe("urn:uuid:fallback");
  });
});

describe("PackageDocument additional metadata (description/publisher/identifiers)", () => {
  const buildXml = (metadataInner: string): string => `<?xml version="1.0"?>
    <package xmlns="http://www.idpf.org/2007/opf" xmlns:opf="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:identifier id="pub-id">urn:uuid:test</dc:identifier>
        <dc:title>Test</dc:title>
        <dc:language>en</dc:language>
        ${metadataInner}
      </metadata>
      <manifest></manifest>
      <spine></spine>
    </package>`;

  it("parses dc:description and dc:publisher when present", () => {
    const xml = buildXml(`
      <dc:description>A short blurb about the book.</dc:description>
      <dc:publisher>Test Publishing House</dc:publisher>
    `);

    const pkg = PackageDocument.parse(xml, "OEBPS/content.opf");

    expect(pkg.metadata.description).toBe("A short blurb about the book.");
    expect(pkg.metadata.publisher).toBe("Test Publishing House");
  });

  it("leaves description and publisher undefined when absent", () => {
    const pkg = PackageDocument.parse(buildXml(""), "OEBPS/content.opf");

    expect(pkg.metadata.description).toBeUndefined();
    expect(pkg.metadata.publisher).toBeUndefined();
  });

  it("collects every dc:identifier, pairing each with its opf:scheme if present", () => {
    const xml = buildXml(`
      <dc:identifier id="isbn-id" opf:scheme="ISBN">9780000000000</dc:identifier>
      <dc:identifier id="other-id">some-other-catalog-id</dc:identifier>
    `);

    const pkg = PackageDocument.parse(xml, "OEBPS/content.opf");

    expect(pkg.metadata.identifiers).toEqual([
      { value: "urn:uuid:test", scheme: undefined },
      { value: "9780000000000", scheme: "ISBN" },
      { value: "some-other-catalog-id", scheme: undefined },
    ]);
  });
});

describe("PackageDocument accessibility metadata (EPUB Accessibility 1.1)", () => {
  const buildXml = (metadataInner: string): string => `<?xml version="1.0"?>
    <package xmlns="http://www.idpf.org/2007/opf" xmlns:opf="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:identifier id="pub-id">urn:uuid:test</dc:identifier>
        <dc:title>Test</dc:title>
        <dc:language>en</dc:language>
        ${metadataInner}
      </metadata>
      <manifest></manifest>
      <spine></spine>
    </package>`;

  it("defaults to empty/undefined when no accessibility metadata is declared", () => {
    const pkg = PackageDocument.parse(buildXml(""), "OEBPS/content.opf");

    expect(pkg.metadata.accessibility).toEqual({
      accessModes: [],
      accessibilityFeatures: [],
      accessibilityHazards: [],
      accessibilitySummary: undefined,
    });
  });

  it("collects every repeated accessMode/accessibilityFeature/accessibilityHazard meta", () => {
    const xml = buildXml(`
      <meta property="schema:accessMode">textual</meta>
      <meta property="schema:accessMode">visual</meta>
      <meta property="schema:accessibilityFeature">structuralNavigation</meta>
      <meta property="schema:accessibilityFeature">alternativeText</meta>
      <meta property="schema:accessibilityHazard">noFlashingHazard</meta>
    `);

    const pkg = PackageDocument.parse(xml, "OEBPS/content.opf");

    expect(pkg.metadata.accessibility.accessModes).toEqual(["textual", "visual"]);
    expect(pkg.metadata.accessibility.accessibilityFeatures).toEqual([
      "structuralNavigation",
      "alternativeText",
    ]);
    expect(pkg.metadata.accessibility.accessibilityHazards).toEqual(["noFlashingHazard"]);
  });

  it("parses a single accessibilitySummary", () => {
    const xml = buildXml(`
      <meta property="schema:accessibilitySummary">This publication conforms to WCAG 2.1 Level AA.</meta>
    `);

    const pkg = PackageDocument.parse(xml, "OEBPS/content.opf");

    expect(pkg.metadata.accessibility.accessibilitySummary).toBe(
      "This publication conforms to WCAG 2.1 Level AA.",
    );
  });
});

describe("PackageDocument rendition:orientation", () => {
  const buildXml = (metadataInner: string, itemrefProperties = ""): string => `<?xml version="1.0"?>
    <package xmlns="http://www.idpf.org/2007/opf" xmlns:opf="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:identifier id="pub-id">urn:uuid:test</dc:identifier>
        <dc:title>Test</dc:title>
        <dc:language>en</dc:language>
        ${metadataInner}
      </metadata>
      <manifest>
        <item id="page1" href="page1.xhtml" media-type="application/xhtml+xml"/>
      </manifest>
      <spine>
        <itemref idref="page1" ${itemrefProperties} />
      </spine>
    </package>`;

  it("defaults to auto when no rendition:orientation meta is present", () => {
    const pkg = PackageDocument.parse(buildXml(""), "OEBPS/content.opf");
    expect(pkg.metadata.renditionOrientation).toBe("auto");
  });

  it("reads a declared package-level rendition:orientation", () => {
    const xml = buildXml(`<meta property="rendition:orientation">landscape</meta>`);
    const pkg = PackageDocument.parse(xml, "OEBPS/content.opf");
    expect(pkg.metadata.renditionOrientation).toBe("landscape");
  });

  it("falls back to auto for an unrecognized rendition:orientation value", () => {
    const xml = buildXml(`<meta property="rendition:orientation">sideways</meta>`);
    const pkg = PackageDocument.parse(xml, "OEBPS/content.opf");
    expect(pkg.metadata.renditionOrientation).toBe("auto");
  });

  it("resolves a per-spine-item orientation override, else the package default", () => {
    const xml = buildXml(
      `<meta property="rendition:orientation">portrait</meta>`,
      `properties="rendition:orientation-landscape"`,
    );
    const pkg = PackageDocument.parse(xml, "OEBPS/content.opf");
    const item = pkg.spine[0]!;
    expect(item.resolveRenditionOrientation(pkg.metadata.renditionOrientation)).toBe("landscape");
  });

  it("with no override, resolves to the package default", () => {
    const xml = buildXml(`<meta property="rendition:orientation">portrait</meta>`);
    const pkg = PackageDocument.parse(xml, "OEBPS/content.opf");
    const item = pkg.spine[0]!;
    expect(item.resolveRenditionOrientation(pkg.metadata.renditionOrientation)).toBe("portrait");
  });
});

describe("PackageDocument manifest fallback chains", () => {
  it("parses the fallback attribute on a manifest item", async () => {
    const container = await EpubContainer.open(await loadFixture("manifest-fallback.epub"));
    const pkg = await container.getPackageDocument();

    expect(pkg.getManifestItem("ch1-pdf")?.fallback).toBe("ch1-html");
    expect(pkg.getManifestItem("ch1-html")?.fallback).toBeUndefined();
  });

  it("resolves the fallback chain starting with the item itself", async () => {
    const container = await EpubContainer.open(await loadFixture("manifest-fallback.epub"));
    const pkg = await container.getPackageDocument();

    const chain = pkg.resolveManifestItemChain(pkg.getManifestItem("ch1-pdf")!);

    expect(chain.map((item) => item.id)).toEqual(["ch1-pdf", "ch1-html"]);
  });

  it("returns just the item itself when it has no fallback", async () => {
    const container = await EpubContainer.open(await loadFixture("manifest-fallback.epub"));
    const pkg = await container.getPackageDocument();

    const chain = pkg.resolveManifestItemChain(pkg.getManifestItem("ch1-html")!);

    expect(chain.map((item) => item.id)).toEqual(["ch1-html"]);
  });

  it("stops at a fallback id that doesn't resolve to a real manifest item", () => {
    const xml = `<?xml version="1.0"?>
      <package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">
        <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
          <dc:identifier id="pub-id">urn:uuid:test</dc:identifier>
          <dc:title>Test</dc:title>
          <dc:language>en</dc:language>
        </metadata>
        <manifest>
          <item id="a" href="a.xhtml" media-type="application/pdf" fallback="does-not-exist"/>
        </manifest>
        <spine></spine>
      </package>`;
    const pkg = PackageDocument.parse(xml, "OEBPS/content.opf");

    const chain = pkg.resolveManifestItemChain(pkg.getManifestItem("a")!);

    expect(chain.map((item) => item.id)).toEqual(["a"]);
  });

  it("stops at a cyclic fallback chain rather than looping forever", () => {
    const xml = `<?xml version="1.0"?>
      <package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">
        <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
          <dc:identifier id="pub-id">urn:uuid:test</dc:identifier>
          <dc:title>Test</dc:title>
          <dc:language>en</dc:language>
        </metadata>
        <manifest>
          <item id="a" href="a.xhtml" media-type="application/pdf" fallback="b"/>
          <item id="b" href="b.xhtml" media-type="application/pdf" fallback="a"/>
        </manifest>
        <spine></spine>
      </package>`;
    const pkg = PackageDocument.parse(xml, "OEBPS/content.opf");

    const chain = pkg.resolveManifestItemChain(pkg.getManifestItem("a")!);

    expect(chain.map((item) => item.id)).toEqual(["a", "b"]);
  });
});

describe("PackageDocument.findAnnotationsDocument", () => {
  it("finds the manifest item marked properties=\"annotations\"", () => {
    const xml = `<?xml version="1.0"?>
      <package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">
        <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
          <dc:identifier id="pub-id">urn:uuid:test</dc:identifier>
          <dc:title>Test</dc:title>
          <dc:language>en</dc:language>
        </metadata>
        <manifest>
          <item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
          <item id="anno" href="annotations.json" media-type="application/ld+json" properties="annotations"/>
        </manifest>
        <spine><itemref idref="chapter1"/></spine>
      </package>`;
    const pkg = PackageDocument.parse(xml, "OEBPS/content.opf");

    expect(pkg.findAnnotationsDocument()?.id).toBe("anno");
  });

  it("returns undefined for the overwhelming majority of books that don't have one", () => {
    const xml = `<?xml version="1.0"?>
      <package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">
        <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
          <dc:identifier id="pub-id">urn:uuid:test</dc:identifier>
          <dc:title>Test</dc:title>
          <dc:language>en</dc:language>
        </metadata>
        <manifest>
          <item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
        </manifest>
        <spine><itemref idref="chapter1"/></spine>
      </package>`;
    const pkg = PackageDocument.parse(xml, "OEBPS/content.opf");

    expect(pkg.findAnnotationsDocument()).toBeUndefined();
  });
});
