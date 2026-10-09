// @vitest-environment happy-dom
import { readFile } from "node:fs/promises";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { EpubContainer } from "../container/EpubContainer.js";
import { ContentLoader } from "../content/ContentLoader.js";
import { Locator, LocatorResolver } from "../locator/Locator.js";
import { EpubCfi } from "../locator/EpubCfi.js";
import { AnnotationSelectorResolver, AnnotationSelectorResolutionError } from "./AnnotationSelectorResolver.js";

describe("AnnotationSelectorResolver", () => {
  let container: EpubContainer;
  beforeAll(async () => {
    container = await EpubContainer.open(new Uint8Array(await readFile(
      fileURLToPath(new NodeURL("../../test/fixtures/minimal.epub", import.meta.url)),
    )));
  });

  async function setup(body = '<p id="scope"> A&amp;<b>&#x1f600;B</b> C </p><!--ignored--><p>Z</p>') {
    const pkg = await container.getPackageDocument();
    const loader = await ContentLoader.create(container);
    const loaded = await loader.loadSpineDocument(0);
    // happy-dom ranges collapse in detached parsed documents; use its live DOM.
    const document = globalThis.document;
    document.head.innerHTML = "<title>Excluded head text</title>";
    document.body.innerHTML = body;
    vi.spyOn(loader, "loadContentDocument").mockResolvedValue({ ...loaded, document });
    const locators = new LocatorResolver(pkg, loader);
    const resolver = new AnnotationSelectorResolver(pkg, locators);
    return { pkg, loader, document, locators, resolver, source: pkg.spine[0]!.manifestItem.path };
  }

  it("resolves one CSS element and round-trips both live DOM boundaries", async () => {
    const { resolver, source, locators, document } = await setup();
    const selection = await resolver.resolve(source, { type: "CssSelector", value: "#scope" });
    expect(selection.text).toBe(" A&\u{1f600}B C ");
    const locator = new Locator(EpubCfi.joinRange(
      EpubCfi.parse(selection.startCfi), EpubCfi.parse(selection.endCfi!),
    ));
    expect(locators.resolveRangeInDocument(locator, 0, document).range.toString()).toBe(selection.text);
  });

  it.each(["#missing", "p", "", "[", "p".repeat(16_385)])(
    "rejects missing, ambiguous, empty, invalid or excessive CSS: %s", async value => {
      const { resolver, source } = await setup();
      await expect(resolver.resolve(source, { type: "CssSelector", value }))
        .rejects.toBeInstanceOf(AnnotationSelectorResolutionError);
    },
  );

  it("uses body textContent, decoded entities and tree-order cross-node code points", async () => {
    const { resolver, source } = await setup();
    const result = await resolver.resolve(source, { type: "TextPositionSelector", start: 2, end: 7 });
    expect(result.text).toBe("&\u{1f600}B C");
  });

  it("maps Unicode code points back to UTF-16 boundaries without cutting a surrogate pair", async () => {
    const { resolver, source } = await setup("<p>A&#x1f600;B</p>");
    const result = await resolver.resolve(source, { type: "TextPositionSelector", start: 1, end: 2 });
    expect(result.text).toBe("\u{1f600}");
    expect(result.startCfi).toMatch(/:1\)$/);
    expect(result.endCfi).toMatch(/:3\)$/);
  });

  it("uses the parent element's textContent for CSS/text refinements", async () => {
    const { resolver, source } = await setup();
    const result = await resolver.resolve(source, {
      type: "CssSelector", value: "#scope",
      refinedBy: { type: "TextPositionSelector", start: 3, end: 5 },
    });
    expect(result.text).toBe("\u{1f600}B");
  });

  it("allows nested CSS refinements including their own scope element", async () => {
    const { resolver, source } = await setup();
    const result = await resolver.resolve(source, {
      type: "CssSelector", value: "#scope",
      refinedBy: { type: "CssSelector", value: "#scope", refinedBy: { type: "CssSelector", value: "b" } },
    });
    expect(result.text).toBe("\u{1f600}B");
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN])(
    "rejects invalid text positions: %s", async start => {
      const { resolver, source } = await setup();
      await expect(resolver.resolve(source, { type: "TextPositionSelector", start, end: 10 }))
        .rejects.toBeInstanceOf(AnnotationSelectorResolutionError);
    },
  );

  it.each([[4, 3], [0, 1000], [10, 10]])("rejects reversed or out-of-bounds ranges: %j", async (start, end) => {
    const { resolver, source } = await setup();
    await expect(resolver.resolve(source, { type: "TextPositionSelector", start, end }))
      .rejects.toBeInstanceOf(AnnotationSelectorResolutionError);
  });

  it.each(["", "<p>abc</p>"])("supports collapsed positions, including empty bodies: %s", async body => {
    const { resolver, source } = await setup(body);
    const selection = await resolver.resolve(source, { type: "TextPositionSelector", start: 0, end: 0 });
    expect(selection.endCfi).toBeUndefined();
    expect(selection.text).toBeUndefined();
  });

  it.each([null, [], { type: "UnknownSelector" }, { type: "CssSelector", value: "#missing" }])(
    "does not silently ignore unsupported refinements: %j", async refinedBy => {
      const { resolver, source } = await setup();
      await expect(resolver.resolve(source, { type: "CssSelector", value: "#scope", refinedBy }))
        .rejects.toBeInstanceOf(AnnotationSelectorResolutionError);
    },
  );

  it("bounds refinement depth", async () => {
    const { resolver, source } = await setup();
    let refinedBy: unknown = { type: "CssSelector", value: "#scope" };
    for (let index = 0; index < 16; index++) refinedBy = { type: "CssSelector", value: "#scope", refinedBy };
    await expect(resolver.resolve(source, { type: "CssSelector", value: "#scope", refinedBy }))
      .rejects.toBeInstanceOf(AnnotationSelectorResolutionError);
  });

  it("resolves OPF-relative sources using the actual retained OPF path", async () => {
    const { resolver, source, pkg } = await setup();
    expect(pkg.path).toContain(".opf");
    const relative = source.slice(pkg.path.lastIndexOf("/") + 1);
    expect((await resolver.resolve(relative, { type: "CssSelector", value: "#scope" })).text)
      .toBe(" A&\u{1f600}B C ");
  });

  it("only allows missing local source fallback for imported CFIs, not publisher notes", async () => {
    const { resolver, pkg, locators } = await setup();
    const selector = { type: "FragmentSelector", value: "epubcfi(/6/2!/4/2/1:1)" };
    expect(resolver.fragmentSelection("missing.xhtml", selector).spineIndex).toBe(0);
    const strict = new AnnotationSelectorResolver(pkg, locators, false);
    await expect(strict.resolve("missing.xhtml", selector)).rejects.toBeInstanceOf(AnnotationSelectorResolutionError);
  });

  it("loads a publisher source document only once across repeated CFI validations", async () => {
    const { pkg, loader, locators, source, document } = await setup();
    const strict = new AnnotationSelectorResolver(pkg, locators, false);
    const value = locators.generateBoundary(0, document.querySelector("#scope")!.firstChild!, 1).cfi;
    for (let index = 0; index < 100; index++)
      await strict.resolve(source, { type: "FragmentSelector", value });
    expect(loader.loadContentDocument).toHaveBeenCalledOnce();
  });

  it.each(["https://example.invalid/chapter.xhtml", "file:///chapter.xhtml", "//example.invalid/chapter.xhtml"])(
    "never aliases an external source to package CFI steps: %s", async source => {
      const { resolver } = await setup();
      await expect(resolver.resolve(source, { type: "FragmentSelector", value: "epubcfi(/6/2!/4/2/1:1)" }))
        .rejects.toBeInstanceOf(AnnotationSelectorResolutionError);
    },
  );
});
