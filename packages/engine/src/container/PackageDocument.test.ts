// @vitest-environment happy-dom
import { readFile } from "node:fs/promises";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { EpubContainer } from "./EpubContainer.js";
import {
  ManifestItem,
  PackageDocument,
  PackageDocumentError,
  PackageMetadata,
  SpineItemRef,
  parseViewportDimensions,
} from "./PackageDocument.js";
import type { PackageMetadataOptions, RenditionSpread } from "./PackageDocument.js";
import { CfiStep } from "../locator/EpubCfi.js";

async function loadFixture(name: string): Promise<Uint8Array> {
  const buffer = await readFile(
    fileURLToPath(new NodeURL(`../../test/fixtures/${name}`, import.meta.url)),
  );
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

describe("PackageMetadata named options", () => {
  function options(): PackageMetadataOptions {
    return {
      identifier: "urn:uuid:publication",
      title: "Book title",
      language: "en",
      creator: "Author",
      renditionLayout: "pre-paginated",
      renditionViewport: { width: 800, height: 1200 },
      description: "Book description",
      publisher: "Publisher",
      identifiers: [{ value: "9780000000000", scheme: "ISBN" }],
      rights: "Copyright statement",
      date: "2026-09-23",
      subjects: ["Subject"],
      contributors: ["Translator"],
      metaEntries: [
        { key: "media:duration", value: "0:01:05", refines: undefined },
        { key: "media:duration", value: "2s", refines: "overlay" },
        { key: "media:narrator", value: "Narrator", refines: undefined },
        { key: "media:active-class", value: "reading", refines: undefined },
      ],
      creators: ["Author", "Co-author"],
      renditionSpread: "landscape",
      renditionOrientation: "portrait",
      accessibility: {
        accessModes: ["textual"],
        accessibilityFeatures: ["structuralNavigation"],
        accessibilityHazards: ["noFlashingHazard"],
        accessibilitySummary: "Accessibility summary",
      },
    };
  }

  it("retains all named public fields and the existing derived metadata getters", () => {
    const values = options();
    const metadata = new PackageMetadata(values);

    expect({ ...metadata }).toEqual(values);
    expect(metadata.metaEntries).toBe(values.metaEntries);
    expect(metadata.identifiers).toBe(values.identifiers);
    expect(metadata.mediaOverlayDurationSeconds).toBe(65);
    expect(metadata.mediaOverlayDurationForManifestId("overlay")).toBe(2);
    expect(metadata.mediaOverlayNarrator).toBe("Narrator");
    expect(metadata.mediaOverlayActiveClass).toBe("reading");
  });

  it("keeps absent optional values as undefined public fields", () => {
    const values: PackageMetadataOptions = {
      ...options(),
      creator: undefined,
      renditionViewport: undefined,
      description: undefined,
      publisher: undefined,
      rights: undefined,
      date: undefined,
    };

    expect({ ...new PackageMetadata(values) }).toEqual(values);
  });
});

describe("parseViewportDimensions", () => {
  it("parses width/height from a comma-separated string", () => {
    expect(parseViewportDimensions("width=1000, height=1400")).toEqual({ width: 1000, height: 1400 });
  });

  describe("PackageDocument metadata ASCII whitespace", () => {
    function parse(metadata: string) {
      return PackageDocument.parse(
        `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="chosen">
        <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">${metadata}</metadata>
        <manifest><item id="c" href="c.xhtml" media-type="application/xhtml+xml"/></manifest>
        <spine><itemref idref="c"/></spine></package>`,
        "EPUB/package.opf",
      ).metadata;
    }

    const required = '<dc:identifier id="chosen">urn:whitespace</dc:identifier><dc:title>Title</dc:title><dc:language>en</dc:language>';

    it("normalizes canonical Dublin Core fields while retaining identifier and source-order priority", () => {
      const metadata = parse(`
        <dc:identifier id="other"> Other&#x9; identifier </dc:identifier>
        <dc:identifier id="chosen"> Chosen&#xA; identifier </dc:identifier>
        <dc:title> Title&#x9;&#xA;  one&#xD; </dc:title><dc:title>Second title</dc:title>
        <dc:language> en </dc:language>
        <dc:creator> Author&#x9;  A </dc:creator><dc:creator> Author&#xA;B </dc:creator>
        <dc:contributor> Person&#xA; C </dc:contributor>
        <dc:subject> One&#x9; subject </dc:subject>
        <dc:description> Description&#xA;  words </dc:description>
        <dc:publisher> Publisher&#x9; name </dc:publisher>
        <dc:rights> Rights&#xD;&#xA; statement </dc:rights>
        <dc:date>Earlier date</dc:date><dc:date opf:event="publication"> Publication&#xA; date </dc:date>
      `);
      expect(metadata.identifier).toBe("Chosen identifier");
      expect(metadata.identifiers.map(({ value }) => value)).toEqual(["Other identifier", "Chosen identifier"]);
      expect(metadata.title).toBe("Title one");
      expect(metadata.language).toBe("en");
      expect(metadata.creator).toBe("Author A");
      expect(metadata.creators).toEqual(["Author A", "Author B"]);
      expect(metadata.contributors).toEqual(["Person C"]);
      expect(metadata.subjects).toEqual(["One subject"]);
      expect(metadata.description).toBe("Description words");
      expect(metadata.publisher).toBe("Publisher name");
      expect(metadata.rights).toBe("Rights statement");
      expect(metadata.date).toBe("Publication date");
    });

    it("normalizes current and legacy meta values before derived processing", () => {
      const metadata = parse(`${required}
        <meta property="media:narrator"> Narrator&#xA; name </meta>
        <meta property="custom:value" refines="#chosen"> Refined&#x9; value </meta>
        <meta name="legacy" content=" Legacy&#x9;&#xA; value "/>
        <meta property="schema:accessibilitySummary"> Accessible&#xA; summary </meta>
        <meta property="rendition:layout"> pre-paginated </meta>
        <meta property="rendition:viewport"> width=400,&#xA; height=600 </meta>
        <meta property="empty"> &#x9;&#xA; </meta>
      `);
      expect(metadata.mediaOverlayNarrator).toBe("Narrator name");
      expect(metadata.metaEntries).toContainEqual({ key: "custom:value", value: "Refined value", refines: "chosen" });
      expect(metadata.metaEntries).toContainEqual({ key: "legacy", value: "Legacy value", refines: undefined });
      expect(metadata.metaEntries.some(({ key }) => key === "empty")).toBe(false);
      expect(metadata.accessibility.accessibilitySummary).toBe("Accessible summary");
      expect(metadata.renditionLayout).toBe("pre-paginated");
      expect(metadata.renditionViewport).toEqual({ width: 400, height: 600 });
    });

    it("does not strip or collapse non-ASCII spaces", () => {
      const metadata = parse(`
        <dc:identifier id="chosen">&#xA0;chosen&#xA0;</dc:identifier>
        <dc:title> &#xA0;Title&#xA0;&#xA0;words&#xA0; </dc:title><dc:language>en</dc:language>
        <dc:creator>&#x2003;Author&#x2003;</dc:creator>
      `);
      expect(metadata.identifier).toBe("\u00A0chosen\u00A0");
      expect(metadata.title).toBe("\u00A0Title\u00A0\u00A0words\u00A0");
      expect(metadata.creator).toBe("\u2003Author\u2003");
    });

    it("omits empty optional values and still rejects an empty required title", () => {
      expect(parse(`${required}<dc:description> &#x9;&#xA; </dc:description>`).description).toBeUndefined();
      expect(() => parse(
        '<dc:identifier id="chosen">id</dc:identifier><dc:title> &#x9;&#xA; </dc:title><dc:language>en</dc:language>',
      )).toThrow(PackageDocumentError);
    });
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

  it("resolves URL-encoded manifest hrefs without losing filename delimiters", () => {
    const xml = `<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="id">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:identifier id="id">test</dc:identifier><dc:title>Test</dc:title><dc:language>en</dc:language>
      </metadata>
      <manifest><item id="chapter" href="ch%23one%25.xhtml" media-type="application/xhtml+xml"/></manifest>
      <spine><itemref idref="chapter"/></spine>
    </package>`;

    const parsed = PackageDocument.parse(xml, "OEBPS/part?one/content.opf");

    expect(parsed.spine[0]?.manifestItem.path).toBe("OEBPS/part?one/ch#one%.xhtml");
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

describe("PackageDocument (roll layout)", () => {
  const xml = `<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="id">
    <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
      <dc:identifier id="id">roll</dc:identifier>
      <dc:title>Roll</dc:title>
      <dc:language>en</dc:language>
      <meta property="rendition:layout">roll</meta>
    </metadata>
    <manifest>
      <item id="first" href="first.xhtml" media-type="application/xhtml+xml"/>
      <item id="second" href="second.xhtml" media-type="application/xhtml+xml"/>
    </manifest>
    <spine>
      <itemref idref="first" properties="rendition:layout-pre-paginated rendition:spread-none"/>
      <itemref idref="second" properties="rendition:layout-reflowable"/>
    </spine>
  </package>`;
  const pkg = PackageDocument.parse(xml, "EPUB/package.opf");

  it("preserves the publication-wide roll layout", () => {
    expect(pkg.metadata.renditionLayout).toBe("roll");
  });

  it("ignores item-level layout overrides in a roll publication", () => {
    expect(pkg.spine.map((item) => item.resolveRenditionLayout("roll"))).toEqual([
      "roll",
      "roll",
    ]);
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
      accessModeSufficient: [],
      conformsTo: [],
      certifiedBy: [],
      certificationDates: [],
      certifierCredentials: [],
      certifierReports: [],
      contactEmails: [],
      declarations: [],
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

  it("retains repeated, multilingual and refined Accessibility 1.2 publisher declarations", () => {
    const pkg = PackageDocument.parse(buildXml(`
      <meta property="schema:accessModeSufficient">textual</meta>
      <meta property="schema:accessModeSufficient">visual,textual</meta>
      <meta property="dcterms:conformsTo">EPUB Accessibility 1.2 - WCAG 2.2 Level AA</meta>
      <meta property="a11y:certifiedBy" id="certifier">Original publisher</meta>
      <meta property="a11y:certificationDate">not-a-date</meta>
      <meta property="a11y:certifierCredential" refines="#certifier">Declared credential</meta>
      <meta property="a11y:certifierReport">https://example.invalid/report</meta>
      <meta property="a11y:contactEmail">publisher@example.invalid</meta>
      <meta property="schema:accessibilitySummary" xml:lang="fr" dir="ltr">Résumé déclaré</meta>
      <meta property="schema:accessibilitySummary" xml:lang="ar" dir="rtl">ملخص الناشر</meta>
      <meta property="schema:accessibilityHazard" refines="#chapter">unknown</meta>
      <meta property="a11y:futureClaim">Retained extension</meta>
    `), "EPUB/package.opf").metadata.accessibility;
    expect(pkg.accessModeSufficient).toEqual(["textual", "visual,textual"]);
    expect(pkg.conformsTo).toEqual(["EPUB Accessibility 1.2 - WCAG 2.2 Level AA"]);
    expect(pkg.certifiedBy).toEqual(["Original publisher"]);
    expect(pkg.certificationDates).toEqual(["not-a-date"]);
    expect(pkg.certifierCredentials).toEqual([]);
    expect(pkg.certifierReports).toEqual(["https://example.invalid/report"]);
    expect(pkg.contactEmails).toEqual(["publisher@example.invalid"]);
    expect(pkg.accessibilityHazards).toEqual([]);
    expect(pkg.declarations).toContainEqual(expect.objectContaining({
      key: "a11y:certifierCredential", refines: "certifier", value: "Declared credential",
    }));
    expect(pkg.declarations?.filter(meta => meta.key === "schema:accessibilitySummary").map(meta => [meta.language, meta.direction]))
      .toEqual([["fr", "ltr"], ["ar", "rtl"]]);
    expect(pkg.declarations).toContainEqual(expect.objectContaining({ key: "a11y:futureClaim", value: "Retained extension" }));
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

  it("allows an explicit auto override to reset the package's fixed orientation", () => {
    const xml = buildXml(
      '<meta property="rendition:orientation">portrait</meta>',
      'properties="rendition:orientation-auto"',
    );
    const pkg = PackageDocument.parse(xml, "OEBPS/content.opf");

    expect(pkg.spine[0]!.resolveRenditionOrientation(pkg.metadata.renditionOrientation)).toBe("auto");
  });
});

describe("SpineItemRef source-ordered overrides", () => {
  function item(properties: string[]): SpineItemRef {
    return new SpineItemRef(
      new ManifestItem("page", "OEBPS/page.xhtml", "application/xhtml+xml", new Set()),
      true,
      new Set(properties),
      [],
    );
  }

  function orderedPairs(tokens: readonly string[]) {
    return tokens.flatMap((first) =>
      tokens.filter((second) => second !== first).map((second) => [first, second] as const),
    );
  }

  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(orderedPairs(["rendition:layout-pre-paginated", "rendition:layout-reflowable"]))(
    "uses layout %s before %s",
    (first, second) => {
      const ref = item(["rendition:layout-unknown", first, "unknown", second]);
      expect(ref.resolveRenditionLayout("reflowable")).toBe(first.replace("rendition:layout-", ""));
      expect(ref.resolveRenditionLayout("pre-paginated")).toBe(first.replace("rendition:layout-", ""));
      expect(ref.resolveRenditionLayout("roll")).toBe("roll");
      expect(console.warn).toHaveBeenCalledTimes(1);
    },
  );

  it.each(
    orderedPairs([
      "rendition:spread-none",
      "rendition:spread-landscape",
      "rendition:spread-both",
      "rendition:spread-auto",
      "rendition:spread-portrait",
    ]),
  )("uses spread %s before %s", (first, second) => {
    const ref = item(["rendition:spread-unknown", first, "unknown", second]);
    const value = first.replace("rendition:spread-", "");
    expect(ref.resolveRenditionSpread("none")).toBe(value === "portrait" ? "both" : value);
  });

  it.each(
    orderedPairs([
      "page-spread-left",
      "page-spread-right",
      "page-spread-center",
      "rendition:page-spread-left",
      "rendition:page-spread-right",
      "rendition:page-spread-center",
    ]),
  )("uses page side %s before %s", (first, second) => {
    const ref = item(["page-spread-unknown", first, "unknown", second]);
    expect(ref.pageSpread).toBe(first.replace(/^(rendition:)?page-spread-/, ""));
  });

  it.each(
    orderedPairs([
      "rendition:orientation-portrait",
      "rendition:orientation-landscape",
      "rendition:orientation-auto",
    ]),
  )("uses orientation %s before %s", (first, second) => {
    const ref = item(["rendition:orientation-unknown", first, "unknown", second]);
    expect(ref.resolveRenditionOrientation("auto")).toBe(
      first.replace("rendition:orientation-", ""),
    );
  });

  it("reports each conflicting group once without conflating independent groups", () => {
    const ref = item([
      "rendition:orientation-auto",
      "rendition:spread-both",
      "page-spread-right",
      "rendition:layout-reflowable",
      "rendition:orientation-portrait",
      "rendition:spread-none",
      "rendition:page-spread-left",
      "rendition:layout-pre-paginated",
    ]);
    for (let i = 0; i < 3; i++) {
      expect(ref.resolveRenditionLayout("pre-paginated")).toBe("reflowable");
      expect(ref.resolveRenditionSpread("none")).toBe("both");
      expect(ref.pageSpread).toBe("right");
      expect(ref.resolveRenditionOrientation("portrait")).toBe("auto");
    }
    expect(console.warn).toHaveBeenCalledTimes(4);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('OEBPS/page.xhtml: using first token "rendition:layout-reflowable"'),
    );
  });

  it("does not diagnose equivalent aliases or unknown properties as conflicting", () => {
    const ref = item([
      "rendition:page-spread-left",
      "page-spread-left",
      "rendition:spread-portrait",
      "rendition:spread-both",
      "rendition:layout-unknown",
      "rendition:orientation-unknown",
    ]);
    expect(ref.pageSpread).toBe("left");
    expect(ref.resolveRenditionSpread("auto")).toBe("both");
    expect(ref.resolveRenditionLayout("pre-paginated")).toBe("pre-paginated");
    expect(ref.resolveRenditionOrientation("landscape")).toBe("landscape");
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("preserves manifest and spine token order from XML, deduplicating without reordering", () => {
    const xml = `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:identifier id="uid">urn:uuid:ordered</dc:identifier>
        <dc:title>Ordered properties</dc:title><dc:language>en</dc:language>
      </metadata>
      <manifest>
        <item id="page" href="page.xhtml" media-type="application/xhtml+xml"
          properties="unknown scripted svg scripted"/>
      </manifest>
      <spine><itemref idref="page"
        properties="rendition:layout-reflowable unknown rendition:layout-pre-paginated rendition:layout-reflowable"/>
      </spine>
    </package>`;
    const ref = PackageDocument.parse(xml, "OEBPS/content.opf").spine[0]!;
    expect([...ref.manifestItem.properties]).toEqual(["unknown", "scripted", "svg"]);
    expect([...ref.properties]).toEqual([
      "rendition:layout-reflowable",
      "unknown",
      "rendition:layout-pre-paginated",
    ]);
    expect(ref.resolveRenditionLayout("pre-paginated")).toBe("reflowable");
  });
});

describe("SpineItemRef rendition:spread overrides", () => {
  function item(properties: string[]): SpineItemRef {
    return new SpineItemRef(
      new ManifestItem("page", "OEBPS/page.xhtml", "application/xhtml+xml", new Set()),
      true,
      new Set(properties),
      [],
    );
  }

  const defaults: readonly RenditionSpread[] = ["auto", "both", "landscape", "none"];

  it.each(defaults)("inherits the package's %s spread when no override is present", (value) => {
    expect(item([]).resolveRenditionSpread(value)).toBe(value);
  });

  it.each(defaults)("honors rendition:spread-%s independently of the package default", (value) => {
    const ref = item([`rendition:spread-${value}`]);

    for (const packageDefault of defaults) {
      expect(ref.resolveRenditionSpread(packageDefault)).toBe(value);
    }
  });

  it("normalizes the deprecated portrait override to both", () => {
    expect(item(["rendition:spread-portrait"]).resolveRenditionSpread("none")).toBe("both");
  });

  it("ignores unknown overrides without confusing page placement with spread eligibility", () => {
    const ref = item(["rendition:spread-unknown", "rendition:page-spread-center"]);

    expect(ref.resolveRenditionSpread("landscape")).toBe("landscape");
    expect(ref.pageSpread).toBe("center");
  });

  it("preserves the per-item override when parsing a package with a different global value", () => {
    const xml = `<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="id">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:identifier id="id">test</dc:identifier><dc:title>Test</dc:title><dc:language>en</dc:language>
        <meta property="rendition:spread">both</meta>
      </metadata>
      <manifest><item id="page" href="page.xhtml" media-type="application/xhtml+xml"/></manifest>
      <spine><itemref idref="page" properties="rendition:spread-none"/></spine>
    </package>`;
    const pkg = PackageDocument.parse(xml, "OEBPS/content.opf");

    expect(pkg.metadata.renditionSpread).toBe("both");
    expect(pkg.spine[0]!.resolveRenditionSpread(pkg.metadata.renditionSpread)).toBe("none");
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

describe("Media Overlays (issue #101)", () => {
  const xml = `<?xml version="1.0"?>
    <package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:identifier id="pub-id">urn:uuid:test</dc:identifier>
        <dc:title>Test</dc:title>
        <dc:language>en</dc:language>
        <meta property="media:duration">0:20:37.12</meta>
        <meta property="media:duration" refines="#chapter1_overlay">0:02:04.00</meta>
        <meta property="media:narrator">Jane Narrator</meta>
        <meta property="media:active-class">-epub-media-overlay-active</meta>
      </metadata>
      <manifest>
        <item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml" media-overlay="chapter1_overlay"/>
        <item id="chapter1_overlay" href="chapter1_overlay.smil" media-type="application/smil+xml"/>
        <item id="chapter2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>
      </manifest>
      <spine><itemref idref="chapter1"/><itemref idref="chapter2"/></spine>
    </package>`;
  const pkg = PackageDocument.parse(xml, "OEBPS/content.opf");

  it("resolves a content document's media-overlay attribute to its SMIL manifest item", () => {
    const chapter1 = pkg.getManifestItem("chapter1")!;
    expect(pkg.findMediaOverlay(chapter1)?.id).toBe("chapter1_overlay");
  });

  it("returns undefined for a content document with no media-overlay attribute", () => {
    const chapter2 = pkg.getManifestItem("chapter2")!;
    expect(pkg.findMediaOverlay(chapter2)).toBeUndefined();
  });

  it("parses the book-wide total media:duration", () => {
    expect(pkg.metadata.mediaOverlayDurationSeconds).toBeCloseTo(20 * 60 + 37.12, 2);
  });

  it("parses a refined media:duration for a specific SMIL manifest item", () => {
    expect(pkg.metadata.mediaOverlayDurationForManifestId("chapter1_overlay")).toBeCloseTo(2 * 60 + 4, 2);
  });

  it("returns undefined for a manifest id with no matching refined duration", () => {
    expect(pkg.metadata.mediaOverlayDurationForManifestId("nonexistent")).toBeUndefined();
  });

  it("parses media:narrator", () => {
    expect(pkg.metadata.mediaOverlayNarrator).toBe("Jane Narrator");
  });

  it("parses media:active-class", () => {
    expect(pkg.metadata.mediaOverlayActiveClass).toBe("-epub-media-overlay-active");
  });

  it("returns undefined for every media overlay metadata field when a book has none", () => {
    const plainXml = `<?xml version="1.0"?>
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
    const plainPkg = PackageDocument.parse(plainXml, "OEBPS/content.opf");
    expect(plainPkg.metadata.mediaOverlayDurationSeconds).toBeUndefined();
    expect(plainPkg.metadata.mediaOverlayNarrator).toBeUndefined();
    expect(plainPkg.metadata.mediaOverlayActiveClass).toBeUndefined();
  });
});
