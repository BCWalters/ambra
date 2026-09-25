// @vitest-environment happy-dom
import { readFile } from "node:fs/promises";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { EpubContainer } from "../container/EpubContainer.js";
import { ContentLoader } from "../content/ContentLoader.js";
import { Locator, LocatorResolutionError, LocatorResolver } from "./Locator.js";
import { EpubCfi } from "./EpubCfi.js";
import { markReaderOwnedContent } from "../content/ReaderOwnedContent.js";

async function loadFixture(name: string): Promise<Uint8Array> {
  const buffer = await readFile(
    fileURLToPath(new NodeURL(`../../test/fixtures/${name}`, import.meta.url)),
  );
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

describe("LocatorResolver (minimal.epub, single spine item)", () => {
  let resolver: LocatorResolver;
  let contentLoader: ContentLoader;

  beforeAll(async () => {
    const container = await EpubContainer.open(await loadFixture("minimal.epub"));
    const pkg = await container.getPackageDocument();
    contentLoader = await ContentLoader.create(container);
    resolver = new LocatorResolver(pkg, contentLoader);
  });

  it("generates a Locator for an element position and resolves it back to that element", async () => {
    const doc = await contentLoader.loadSpineDocument(0);
    const h1 = doc.document.querySelector("h1")!;

    const locator = resolver.generate(0, h1);
    expect(locator.cfi).toMatch(/^epubcfi\(\/6\/2!\/4/); // spine 0's package steps are [6,2] from minimal fixture

    const resolved = await resolver.resolve(locator);
    expect(resolved.spineIndex).toBe(0);
    expect((resolved.node as Element).tagName.toLowerCase()).toBe("h1");
    expect(resolved.node.textContent).toBe("Chapter 1");
  });

  it("resolves canonical element starts and explicitly saved zero offsets to the exact same DOM boundary", async () => {
    const doc = (await contentLoader.loadSpineDocument(0)).document;
    const heading = doc.querySelector("h1")!;
    const canonical = resolver.generateBoundary(0, heading, 0);
    const saved = resolver.generate(0, heading, 0);
    expect(canonical.cfi).not.toBe(saved.cfi);
    const expected = resolver.resolveInDocument(canonical, 0, doc);
    const actual = resolver.resolveInDocument(saved, 0, doc);
    expect(actual.node).toBe(expected.node);
    expect(actual.characterOffset ?? 0).toBe(expected.characterOffset ?? 0);
    expect(resolver.generateBoundary(0, actual.node, actual.characterOffset).cfi).toBe(canonical.cfi);
  });

  it("orders image-page parent boundaries among descendants rather than before the entire chapter", () => {
    const doc = document.implementation.createHTMLDocument();
    doc.body.innerHTML = '<h2>First</h2>\n<img alt="First illustration"/>\n<h2>Second</h2>\n<img alt="Second illustration"/>\n<p>End</p>';
    const first = doc.querySelectorAll("h2")[0]!;
    const second = doc.querySelectorAll("h2")[1]!;
    const images = [...doc.querySelectorAll("img")];
    const boundaries = [
      resolver.generateBoundary(0, first),
      ...images.map(image => resolver.generateBoundary(
        0, doc.body, [...doc.body.childNodes].indexOf(image),
      )),
    ];
    const secondHeading = resolver.generateBoundary(0, second);
    expect(EpubCfi.compare(boundaries[0]!.cfi, boundaries[1]!.cfi)).toBeLessThan(0);
    expect(EpubCfi.compare(boundaries[1]!.cfi, secondHeading.cfi)).toBeLessThan(0);
    expect(EpubCfi.compare(secondHeading.cfi, boundaries[2]!.cfi)).toBeLessThan(0);
    expect(resolver.resolveInDocument(boundaries[1]!, 0, doc).node).toBe(images[0]);
    const text = doc.querySelector("p")!.firstChild!;
    expect(resolver.generateBoundary(0, text, 2).cfi).toBe(resolver.generate(0, text, 2).cfi);
  });

  it("canonicalizes container ends and skips comments and reader-owned content", () => {
    const doc = document.implementation.createHTMLDocument();
    doc.body.innerHTML = '<div><p>First</p></div><!-- ignored --><aside>Reader control</aside><h2>Second</h2><!-- ignored -->';
    const container = doc.querySelector("div")!;
    const heading = doc.querySelector("h2")!;
    markReaderOwnedContent(doc.querySelector("aside")!);
    const boundary = resolver.generateBoundary(0, container, container.childNodes.length);
    expect(resolver.resolveInDocument(boundary, 0, doc).node).toBe(heading);
    const end = resolver.generateBoundary(0, doc.body, doc.body.childNodes.length);
    const resolvedEnd = resolver.resolveInDocument(end, 0, doc);
    expect(resolvedEnd.node).toBe(heading.firstChild);
    expect(resolvedEnd.characterOffset).toBe(6);
    expect(EpubCfi.compare(boundary.cfi, end.cfi)).toBeLessThan(0);
  });

  it("generates a Locator for a text character position and resolves it back to the exact offset", async () => {
    const doc = await contentLoader.loadSpineDocument(0);
    const p = doc.document.querySelector("p")!;
    const textNode = p.firstChild!;
    const text = textNode.textContent!;
    const offset = text.indexOf("This is"); // somewhere mid-paragraph

    const locator = resolver.generate(0, textNode, offset);
    const resolved = await resolver.resolve(locator);

    expect(resolved.characterOffset).toBe(offset);
    expect(resolved.node.textContent).toBe(text);
    expect(resolved.node.textContent!.slice(resolved.characterOffset!)).toMatch(/^This is/);
  });

  it("round-trips through a freshly reloaded (re-parsed) document, not relying on node identity", async () => {
    // Simulates the real resume-reading scenario: generate a Locator now,
    // persist just the CFI string, then resolve it later against a
    // completely independent parse of the same content.
    const firstParse = await contentLoader.loadSpineDocument(0);
    const textNode = firstParse.document.querySelector("p")!.firstChild!;
    const locator = resolver.generate(0, textNode, 7);

    const resolved = await resolver.resolve(locator);
    const secondParse = await contentLoader.loadSpineDocument(0);

    expect(resolved.node).not.toBe(textNode); // genuinely a different parse
    expect(resolved.node.textContent).toBe(secondParse.document.querySelector("p")!.textContent);
  });

  it("resolveInDocument resolves against an already-parsed document without reloading", async () => {
    const doc = await contentLoader.loadSpineDocument(0);
    const h1 = doc.document.querySelector("h1")!;
    const locator = resolver.generate(0, h1);

    const resolved = resolver.resolveInDocument(locator, 0, doc.document);

    expect(resolved.node).toBe(h1); // same document instance, so same node identity
  });

  it("resolveInDocument throws when given the wrong spine index", async () => {
    const doc = await contentLoader.loadSpineDocument(0);
    const h1 = doc.document.querySelector("h1")!;
    const locator = resolver.generate(0, h1);

    expect(() => resolver.resolveInDocument(locator, 1, doc.document)).toThrow(
      LocatorResolutionError,
    );
  });

  it("resolvePair resolves both locators against the same parsed document — unlike two separate resolve() calls, which reparse independently (see the reload test above)", async () => {
    const doc = await contentLoader.loadSpineDocument(0);
    const p = doc.document.querySelector("p")!;
    const textNode = p.firstChild!;
    const startLocator = resolver.generate(0, textNode, 0);
    const endLocator = resolver.generate(0, textNode, 4);

    const { start, end, document } = await resolver.resolvePair(startLocator, endLocator);

    // The real regression this guards against: two independently-
    // `resolve()`d nodes belong to different parses (per the reload test
    // above), so a Range spanning them would silently collapse instead of
    // throwing. Asserted directly on node/offset identity rather than via
    // a Range, since happy-dom's Range implementation doesn't reliably
    // support this test package's DOMParser-produced documents (a test
    // -environment limitation, not a product bug — see the e2e coverage
    // in annotation-export-import.spec.ts for confirmation against a
    // real browser).
    expect(start.node).toBe(end.node);
    expect(start.node.ownerDocument).toBe(document);
    expect(start.node.textContent!.slice(start.characterOffset!, end.characterOffset!)).toBe(
      "Hell",
    );
  });


  it("resolvePair throws when the two locators resolve to different spine items", async () => {
    const doc = await contentLoader.loadSpineDocument(0);
    const h1 = doc.document.querySelector("h1")!;
    const sameSpineLocator = resolver.generate(0, h1);
    const outOfRangeLocator = new Locator("epubcfi(/6/4!/4/2/1:0)"); // no spine item at [6,4] in minimal.epub

    await expect(resolver.resolvePair(sameSpineLocator, outOfRangeLocator)).rejects.toThrow(
      LocatorResolutionError,
    );
  });

  it("resolve throws LocatorResolutionError for a syntactically invalid CFI", async () => {
    await expect(resolver.resolve(new Locator("not-a-cfi"))).rejects.toThrow(
      LocatorResolutionError,
    );
  });

  it("resolve throws LocatorResolutionError when package steps match no spine item", async () => {
    await expect(resolver.resolve(new Locator("epubcfi(/99/99!/4/2/1:0)"))).rejects.toThrow(
      LocatorResolutionError,
    );
  });

  it("resolve throws LocatorResolutionError when content steps don't resolve", async () => {
    await expect(resolver.resolve(new Locator("epubcfi(/6/2!/999999)"))).rejects.toThrow(
      LocatorResolutionError,
    );
  });

  it("generate throws for an out-of-range spine index", async () => {
    const doc = await contentLoader.loadSpineDocument(0);
    const h1 = doc.document.querySelector("h1")!;

    expect(() => resolver.generate(5, h1)).toThrow(LocatorResolutionError);
  });

  it("resolveInDocument throws when a step's id assertion doesn't match the resolved element's actual id", async () => {
    const doc = await contentLoader.loadSpineDocument(0);
    const h1 = doc.document.querySelector("h1")!;
    const locator = resolver.generate(0, h1);
    // h1 has no id in this fixture, so any asserted id is a mismatch —
    // fabricate one by injecting a bracketed assertion into the last
    // step, simulating a CFI generated against a differently-structured
    // version of the same document. Per the resolver's documented,
    // deliberate design, this must fail loudly rather than silently
    // resolving positionally (self-healing correction is a documented
    // future enhancement, not Wave 1 behavior).
    const tamperedCfi = locator.cfi.replace(/(\/\d+)\)$/, "$1[bogus-id])");

    expect(() => resolver.resolveInDocument(new Locator(tamperedCfi), 0, doc.document)).toThrow(
      LocatorResolutionError,
    );
  });

  it("rejects a text offset beyond the addressed run rather than clamping it", async () => {
    const doc = await contentLoader.loadSpineDocument(0);
    const textNode = doc.document.querySelector("p")!.firstChild!;
    const locator = resolver.generate(0, textNode, textNode.textContent!.length + 1);

    expect(() => resolver.resolveInDocument(locator, 0, doc.document)).toThrow(
      LocatorResolutionError,
    );
  });

  it("round-trips positions under IDs containing CFI delimiters", async () => {
    const doc = await contentLoader.loadSpineDocument(0);
    const paragraph = doc.document.querySelector("p")!;
    paragraph.setAttribute("id", "part]1;note^");
    const textNode = paragraph.firstChild!;
    const locator = resolver.generate(0, textNode, 4);

    const resolved = resolver.resolveInDocument(locator, 0, doc.document);

    expect(resolved.node).toBe(textNode);
    expect(resolved.characterOffset).toBe(4);
  });
});

describe("LocatorResolver (fixed-layout.epub, multiple spine items)", () => {
  let resolver: LocatorResolver;
  let contentLoader: ContentLoader;

  beforeAll(async () => {
    const container = await EpubContainer.open(await loadFixture("fixed-layout.epub"));
    const pkg = await container.getPackageDocument();
    contentLoader = await ContentLoader.create(container);
    resolver = new LocatorResolver(pkg, contentLoader);
  });

  it("generates and resolves a Locator for an element with no text content (an <img>)", async () => {
    const doc = await contentLoader.loadSpineDocument(0); // page1.xhtml: <body><img/></body>
    const img = doc.document.querySelector("img")!;

    const locator = resolver.generate(0, img);
    const resolved = await resolver.resolve(locator);

    expect(resolved.spineIndex).toBe(0);
    expect((resolved.node as Element).tagName.toLowerCase()).toBe("img");
    expect(resolved.characterOffset).toBeUndefined();
  });

  it("distinguishes between spine items when generating and resolving Locators", async () => {
    const page1Doc = await contentLoader.loadSpineDocument(0);
    const page2Doc = await contentLoader.loadSpineDocument(1); // page2.xhtml: <body><p>...</p></body>

    const imgLocator = resolver.generate(0, page1Doc.document.querySelector("img")!);
    const textNode = page2Doc.document.querySelector("p")!.firstChild!;
    const textLocator = resolver.generate(1, textNode, 5);

    // The two Locators' package-step prefixes must differ — otherwise
    // they'd be indistinguishable and resolution would be ambiguous.
    expect(imgLocator.cfi.split("!")[0]).not.toBe(textLocator.cfi.split("!")[0]);

    const resolvedImg = await resolver.resolve(imgLocator);
    const resolvedText = await resolver.resolve(textLocator);

    expect(resolvedImg.spineIndex).toBe(0);
    expect(resolvedText.spineIndex).toBe(1);
    expect(resolvedText.node.textContent).toBe(textNode.textContent);
    expect(resolvedText.characterOffset).toBe(5);
  });
});
