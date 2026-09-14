// @vitest-environment happy-dom
import { readFile } from "node:fs/promises";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { EpubContainer } from "../container/EpubContainer.js";
import { ContentLoader } from "../content/ContentLoader.js";
import { Locator, LocatorResolutionError, LocatorResolver } from "./Locator.js";

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
});
