import { describe, expect, it, vi } from "vitest";
import { rewriteCssResources } from "./CssResourceRewriter.js";

describe("publisher CSS resource rewriting", () => {
  it("rewrites URLs, including escaped filenames, without touching strings and comments", async () => {
    const resolve = vi.fn(async (href: string) => `blob:${href}`);
    const css = await rewriteCssResources(String.raw`
      /* url(ignore.png) */
      p { content: "url(ignore-too.png)"; background: url("images/a\20 b.png"); }
      li { list-style-image: URL(icon.png); filter: url("filters.svg#shadow"); }
    `, resolve);
    expect(resolve.mock.calls.map(call => call[0])).toEqual([
      "images/a b.png", "icon.png", "filters.svg#shadow",
    ]);
    expect(css).toContain('url("blob:images/a b.png")');
    expect(css).toContain('url("blob:filters.svg#shadow")');
    expect(css).toContain('content: "url(ignore-too.png)"');
    expect(css).toContain("/* url(ignore.png) */");
  });

  it("preserves import media, layer and supports clauses for both import syntaxes", async () => {
    const resolve = vi.fn(async (href: string) => `blob:${href}`);
    const css = await rewriteCssResources(
      '@import "nested.css" layer(publisher) supports(display:grid) screen; @import url(other.css) print;',
      resolve,
    );
    expect(css).toContain('@import "blob:nested.css" layer(publisher) supports(display:grid) screen;');
    expect(css).toContain('@import url("blob:other.css") print;');
    expect(resolve).toHaveBeenCalledWith("nested.css", true);
    expect(resolve).toHaveBeenCalledWith("other.css", true);
  });

  it("removes unresolved imports but retains unrelated declarations", async () => {
    const css = await rewriteCssResources(
      '@import "cycle.css"; p { color: red; background: url(missing.png) }',
      async () => undefined,
    );
    expect(css).not.toContain("@import");
    expect(css).toContain("color: red");
  });

  it("does not rewrite import condition values as stylesheet imports", async () => {
    const resolve = vi.fn(async () => "blob:sheet");
    const css = await rewriteCssResources(
      '@import url(sheet.css) supports(background: url(test.png)) screen;',
      resolve,
    );
    expect(css).toContain('url("blob:sheet") supports(background: url(test.png)) screen;');
    expect(resolve).toHaveBeenCalledExactlyOnceWith("sheet.css", true);
  });

  it("rewrites inline declarations and keeps custom properties", async () => {
    const css = await rewriteCssResources(
      '--image: url(a.png); background-image: var(--image); color: red;',
      async () => "blob:image", true,
    );
    expect(css).toContain('--image: url("blob:image")');
    expect(css).toContain("background-image: var(--image)");
    expect(css).not.toContain("ambra-inline");
  });

  it("preserves local fragments and data URIs supplied by policy", async () => {
    const css = await rewriteCssResources(
      'p{filter:url(#shadow);background:url("data:image/png;base64,AAAA")}',
      async href => href,
    );
    expect(css).toContain('url("#shadow")');
    expect(css).toContain('url("data:image/png;base64,AAAA")');
  });

  it("propagates syntax errors and unexpected resolver failures", async () => {
    await expect(rewriteCssResources("p { color: red", async href => href)).rejects.toThrow();
    await expect(rewriteCssResources("p { background: url(a.png) }", async () => {
      throw new Error("Unexpected graph error");
    })).rejects.toThrow("Unexpected graph error");
  });
});
