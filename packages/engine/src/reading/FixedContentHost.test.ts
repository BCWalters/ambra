// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContentLoader } from "../content/ContentLoader.js";
import type { ResourceUrlResolver } from "../rendering/ResourceUrlResolver.js";
import { SandboxedContentHost } from "../rendering/SandboxedContentHost.js";
import { FixedContentHost } from "./FixedContentHost.js";
import * as SpineItemAssembler from "./SpineItemAssembler.js";

afterEach(() => vi.restoreAllMocks());

async function open(markup: string, fallback?: { width: number; height: number }) {
  const host = new FixedContentHost(1200, 900);
  const doc = new DOMParser().parseFromString(markup, "application/xhtml+xml");
  Object.defineProperty(host.element, "contentDocument", { value: doc });
  vi.spyOn(SpineItemAssembler, "loadAssembledSpineItem").mockResolvedValue(markup);
  vi.spyOn(SandboxedContentHost.prototype, "render").mockResolvedValue();
  await host.open({} as ContentLoader, {} as ResourceUrlResolver, 0, fallback);
  return { host, doc };
}

describe("fixed SVG content", () => {
  it.each([
    ['viewBox="0 0 600 800" width="100%" height="100%"', 600, 800],
    ['viewBox="-20, -10, 750, 900"', 750, 900],
    ['viewBox="0 0 6e2 8e2"', 600, 800],
    ['width="600px" height="800"', 600, 800],
    ['width="600.5" height="800.25px"', 600.5, 800.25],
  ])("uses SVG intrinsic dimensions: %s", async (attributes, width, height) => {
    const { host, doc } = await open(`<svg xmlns="http://www.w3.org/2000/svg" ${attributes}><title>Page</title></svg>`);
    expect(doc.body).toBeNull();
    expect(host.naturalSize).toEqual({ width, height });
    expect(host.currentPosition()).toEqual({ node: doc.documentElement, offset: 0 });
    expect(host.element.style.width).toBe(`${width}px`);
    expect(host.element.style.height).toBe(`${height}px`);
    expect(host.element.style.transform).toBe(`scale(${Math.min(1200 / width, 900 / height)})`);
    host.resize(600, 400);
    expect(host.element.style.transform).toBe(`scale(${Math.min(600 / width, 400 / height)})`);
    host.dispose();
  });

  it.each([
    'viewBox="0 0 0 800"', 'viewBox="0 0 -600 800"', 'viewBox="0 0 NaN 800"',
    'viewBox="0 0 1e999 800"', 'viewBox="0 0 600"', 'width="100%" height="100%"',
    'width="0" height="800"', 'width="600em" height="800em"',
  ])("uses package fallback for invalid or relative dimensions: %s", async attributes => {
    const { host } = await open(`<svg xmlns="http://www.w3.org/2000/svg" ${attributes}/>`, { width: 700, height: 950 });
    expect(host.naturalSize).toEqual({ width: 700, height: 950 });
    host.dispose();
  });

  it("retains XHTML viewport/body behavior, even with an inline SVG", async () => {
    const { host, doc } = await open('<html xmlns="http://www.w3.org/1999/xhtml"><head><meta name="viewport" content="width=700,height=900"/></head><body><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 60"/></body></html>');
    expect(host.naturalSize).toEqual({ width: 700, height: 900 });
    expect(host.currentPosition()?.node).toBe(doc.body);
    host.dispose();
  });
});
