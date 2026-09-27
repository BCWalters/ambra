import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Window } from "happy-dom";
import { prepareTableViewer } from "./TableViewerContent.js";
import { rememberImageSemantics } from "./ImageViewerSemantics.js";

let originalSettings: Window["happyDOM"]["settings"];
beforeEach(() => {
  const browser = (window as unknown as Window).happyDOM;
  originalSettings = { ...browser.settings };
  Object.assign(browser.settings, { disableCSSFileLoading: true, disableJavaScriptEvaluation: true, disableIframePageLoading: true });
});
afterEach(() => {
  document.body.innerHTML = ""; document.head.innerHTML = "";
  Object.assign((window as unknown as Window).happyDOM.settings, originalSettings);
});

function table(markup = "<caption>Results</caption><tbody><tr><th id='h'>Heading</th><td headers='h'>Value</td></tr></tbody>") {
  document.head.innerHTML = `<style>.chapter table { border: 2px solid blue; }</style>
    <link rel="stylesheet" href="blob:publisher"/>`;
  document.body.innerHTML = `<section class="chapter" id="chapter" lang="fr" dir="rtl">
    <p>Unrelated publication prose</p><table style="width:1200px">${markup}</table>
    </section><p>Other content</p>`;
  return document.querySelector("table")!;
}

describe("isolated table document", () => {
  it("preserves publisher context, resources, IDs, caption and table semantics without copying the book", () => {
    const source = table();
    const original = document.documentElement.outerHTML;
    const result = prepareTableViewer(source);
    const doc = new DOMParser().parseFromString(result.xhtml, "application/xhtml+xml");
    expect(doc.querySelector("parsererror")).toBeNull();
    expect(result.caption).toBe("Results");
    expect(doc.querySelector("table")?.style.width).toBe("1200px");
    expect(doc.querySelector("table")?.style.getPropertyPriority("width")).toBe("important");
    expect(doc.querySelector("#chapter")?.getAttribute("dir")).toBe("rtl");
    expect(doc.querySelector("#chapter")?.getAttribute("lang")).toBe("fr");
    expect(doc.querySelector("td")?.getAttribute("headers")).toBe("h");
    expect(doc.querySelector("link")?.getAttribute("href")).toBe("blob:publisher");
    expect(doc.querySelector("style")?.textContent).toContain(".chapter table");
    expect(doc.querySelector("p")).toBeNull();
    expect(doc.querySelector("meta")?.getAttribute("content")).toContain("default-src 'none'");
    expect(document.documentElement.outerHTML).toBe(original);
  });

  it("removes active content and navigation, disables forms, and allows only prepared resource URLs", () => {
    const source = table(`<tbody><tr><td>
      <a href="https://example.com" onclick="bad()" target="_blank">Link text</a>
      <form action="https://example.com"><input value="Read only"/><button>Submit</button></form>
      <img src="blob:resource" srcset="https://example.com/image 2x"/>
      <img src="https://example.com/missing"/>
      <iframe srcdoc="bad"></iframe><script>bad()</script><object data="blob:bad"></object>
    </td></tr></tbody>`);
    const result = prepareTableViewer(source);
    const doc = new DOMParser().parseFromString(result.xhtml, "application/xhtml+xml");
    expect(doc.querySelector("a")?.textContent).toBe("Link text");
    expect(doc.querySelector("a")?.outerHTML).toBe("<a>Link text</a>");
    expect(doc.querySelector("form")?.hasAttribute("action")).toBe(false);
    expect(doc.querySelector("input")?.hasAttribute("disabled")).toBe(true);
    expect(doc.querySelector("button")?.hasAttribute("disabled")).toBe(true);
    expect(doc.querySelector("img")?.getAttribute("src")).toBe("blob:resource");
    expect(doc.querySelector("[srcset], script, iframe, object")).toBeNull();
    expect(result.xhtml).not.toContain("https://");
    expect(result.unavailableResources).toBe(true);
  });

  it("rejects detached source tables instead of silently displaying an empty viewer", () => {
    const source = table();
    source.remove();
    expect(() => prepareTableViewer(source)).toThrow("no longer available");
  });

  it("restores recorded publisher image semantics instead of deleting authored roles and labels", () => {
    const source = table("<tbody><tr><td><img src='blob:image' role='img' aria-label='Publisher description' style='cursor:help'/></td></tr></tbody>");
    const image = source.querySelector("img")!;
    rememberImageSemantics(image);
    image.setAttribute("data-ambra-image-zoom", "");
    image.setAttribute("role", "button");
    image.setAttribute("aria-label", "Zoom image");
    image.style.cursor = "zoom-in";
    const doc = new DOMParser().parseFromString(prepareTableViewer(source).xhtml, "application/xhtml+xml");
    const copy = doc.querySelector("img")!;
    expect(copy.getAttribute("role")).toBe("img");
    expect(copy.getAttribute("aria-label")).toBe("Publisher description");
    expect(copy.style.cursor).toBe("help");
    expect(copy.hasAttribute("data-ambra-image-zoom")).toBe(false);
    expect(image.getAttribute("role")).toBe("button");
  });

  it("does not treat an authored image-zoom-looking marker as permission to strip semantics", () => {
    const source = table("<tbody><tr><td><img src='blob:image' data-ambra-image-zoom='' role='img' aria-label='Authored name'/></td></tr></tbody>");
    const doc = new DOMParser().parseFromString(prepareTableViewer(source).xhtml, "application/xhtml+xml");
    expect(doc.querySelector("img")?.getAttribute("aria-label")).toBe("Authored name");
    expect(doc.querySelector("img")?.getAttribute("role")).toBe("img");
  });
});
