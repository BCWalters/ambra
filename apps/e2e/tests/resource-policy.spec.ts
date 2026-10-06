import { expect, test, type TestInfo } from "@playwright/test";
import { zipSync, strToU8 } from "fflate";
import fs from "node:fs";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

function fixture(info: TestInfo, svg: boolean): string {
  const links = [
    ["file", " fi&#10;le:///tmp/ambra-policy-never-opened"],
    ["data", "data:text/html,original-test-data"],
    ["unsupported", "java&#10;script:void(0)"],
    ["https", "https://resource-policy.invalid/link"],
    ["protocol", "//resource-policy.invalid/link"],
  ];
  const anchors = links
    .map(([id, href], index) =>
      svg
        ? `<a id="${id}" href="${href}"><text x="10" y="${100 + index * 30}">${id}</text></a>`
        : `<p><a id="${id}" href="${href}">${id}</a></p>`,
    )
    .join("");
  const images = `<img id="local" src="image.svg" alt="Local"/><img id="remote-fallback" src="https://resource-policy.invalid/image.svg" alt="Local fallback"/>
    <img id="blocked-file" src="file:///tmp/ambra-policy-never-read" alt="Unavailable"/>
    <img id="blocked-data" src="data:image/png;base64,AAAA" alt="Unavailable"/>
    <img id="blocked-protocol" src="//resource-policy.invalid/image.svg" alt="Unavailable"/>
    <iframe id="blocked-frame" src="document.xhtml" srcdoc="&lt;img src='https://resource-policy.invalid/nested'/&gt;"/>
    <embed id="embed" src="image.svg" type="image/svg+xml"/><object id="object" data="image.svg" width="32" height="24">Object alternative</object>`;
  const use =
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="24"><use id="use" href="symbols.svg#square" width="32" height="24"/></svg>';
  const style =
    '<style>#background{background:url("https://resource-policy.invalid/css");color:green}</style>';
  const content = svg
    ? `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800" id="policy-content">${style}<text x="10" y="45">Resource policy</text>${anchors}
      <foreignObject x="10" y="300" width="500" height="300"><div xmlns="http://www.w3.org/1999/xhtml">${images}${use}<div id="background">CSS</div></div></foreignObject></svg>`
    : `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Resource policy</title>${style}</head><body id="policy-content"><h1>Resource policy</h1>${images}${use}${anchors}<div id="background">CSS</div></body></html>`;
  const name = svg ? "chapter.svg" : "chapter.xhtml";
  const entries: Record<string, Uint8Array> = {
    mimetype: strToU8("application/epub+zip"),
    "META-INF/container.xml": strToU8(
      '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    ),
    "EPUB/package.opf":
      strToU8(`<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:ambra:resource-policy:${svg}</dc:identifier><dc:title>Resource policy</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2026-10-06T00:00:00Z</meta>${svg ? '<meta property="rendition:layout">pre-paginated</meta>' : ""}<meta property="rendition:spread">none</meta></metadata><manifest>
      <item id="chapter" href="${name}" media-type="${svg ? "image/svg+xml" : "application/xhtml+xml"}" properties="remote-resources"/>
      <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
      <item id="image" href="image.svg" media-type="image/svg+xml"/>
      <item id="symbols" href="symbols.svg" media-type="image/svg+xml"/>
      <item id="remote" href="https://resource-policy.invalid/image.svg" media-type="image/svg+xml" fallback="image"/>
      <item id="document" href="document.xhtml" media-type="application/xhtml+xml"/>
    </manifest><spine><itemref idref="chapter"/></spine></package>`),
    "EPUB/nav.xhtml": strToU8(
      `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol><li><a href="${name}">Resource policy</a></li><li><a href="file:///tmp/ambra-policy-never-opened">Blocked TOC file</a></li><li><a href="https://resource-policy.invalid/toc">External TOC</a></li></ol></nav></body></html>`,
    ),
    [`EPUB/${name}`]: strToU8(content),
    "EPUB/image.svg": strToU8(
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="24"><rect width="32" height="24" fill="green"/></svg>',
    ),
    "EPUB/symbols.svg": strToU8(
      '<svg xmlns="http://www.w3.org/2000/svg"><symbol id="square" viewBox="0 0 32 24"><rect width="32" height="24" fill="green"/></symbol></svg>',
    ),
    "EPUB/document.xhtml": strToU8(
      '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Nested</title></head><body>Unsupported nested document</body></html>',
    ),
  };
  const file = info.outputPath("resource-policy.epub");
  fs.writeFileSync(file, zipSync(entries, { level: 0 }));
  return file;
}

for (const svg of [false, true]) {
  test(`${svg ? "SVG" : "XHTML"}: native frame policy blocks resources outside assembler rewriting`, async ({
    browserName: _browserName,
  }, info) => {
    const requests: string[] = [];
    const dispatched: string[] = [];
    const { context, readerPage: page } = await launchReader(fixture(info, svg), {
      beforeBookImport: async (library) => {
        library.context().on("request", request => {
          if (request.url().includes("resource-policy.invalid")) requests.push(request.url());
        });
        await library.context().route("**/resource-policy.invalid/**", route => {
          dispatched.push(route.request().url());
          return route.abort();
        });
      },
    });
    try {
      const probeUrl = "https://resource-policy.invalid/unrewritten.svg";
      const session = await context.newCDPSession(page);
      const probeRequests = new Set<string>();
      const failures: { errorText: string; blockedReason?: string }[] = [];
      const responses: string[] = [];
      session.on("Network.requestWillBeSent", (event: { requestId: string; request: { url: string } }) => {
        if (event.request.url === probeUrl) probeRequests.add(event.requestId);
      });
      session.on("Network.loadingFailed", (event: { requestId: string; errorText: string; blockedReason?: string }) => {
        if (probeRequests.has(event.requestId)) failures.push({
          errorText: event.errorText, blockedReason: event.blockedReason,
        });
      });
      session.on("Network.responseReceived", (event: { requestId: string; response: { url: string } }) => {
        if (probeRequests.has(event.requestId)) responses.push(event.response.url);
      });
      await session.send("Network.enable");
      await exposeReaderController(page);
      await expect.poll(() => page.evaluate(() => {
        const controller = Reflect.get(window, "__readerController");
        const doc: Document | undefined = controller.contentDocumentViews()[0]?.document;
        return !controller.isLoadInFlight &&
          (doc?.getElementById("local") as HTMLImageElement | null)?.naturalWidth === 32;
      })).toBe(true);
      const state = await page.evaluate(({ svgRoot, url }) => {
        const controller = Reflect.get(window, "__readerController");
        const doc: Document = controller.contentDocumentViews()[0].document;
        const policy = doc.defaultView?.frameElement?.getAttribute("csp");
        if (!policy) throw new Error("The rendering frame has no required CSP.");
        const violations: { directive: string; blockedURI: string; disposition: string; policy: string }[] = [];
        Reflect.set(window, "__nativePolicyViolations", violations);
        doc.addEventListener("securitypolicyviolation", event => {
          violations.push({
            directive: event.effectiveDirective,
            blockedURI: event.blockedURI,
            disposition: event.disposition,
            policy: event.originalPolicy,
          });
        });
        // The browser receives the original URL, not an assembler-sanitized
        // attribute. Observe a real CSP event rather than dispatching one.
        const image = svgRoot
          ? doc.createElementNS("http://www.w3.org/2000/svg", "image")
          : doc.createElement("img");
        image.setAttribute(svgRoot ? "href" : "src", url);
        image.setAttribute("width", "32");
        image.setAttribute("height", "24");
        (doc.body ?? doc.documentElement).append(image);
        return {
          root: doc.documentElement.localName,
          hasHead: doc.getElementsByTagName("head").length > 0,
          policy,
        };
      }, { svgRoot: svg, url: probeUrl });
      expect(state.root).toBe(svg ? "svg" : "html");
      expect(state.hasHead).toBe(!svg);
      expect(state.policy).toContain("img-src blob:");
      await expect.poll(() => page.evaluate(policy =>
        Reflect.get(window, "__nativePolicyViolations").some(
          (event: { directive: string; blockedURI: string; disposition: string; policy: string }) =>
            event.directive === "img-src" &&
            ["https://resource-policy.invalid", "https://resource-policy.invalid/unrewritten.svg"]
              .includes(event.blockedURI) &&
            event.disposition === "enforce" &&
            event.policy.trim().replace(/;$/, "") === policy.trim().replace(/;$/, ""),
        ), state.policy)).toBe(true);
      await expect.poll(() => failures.some(failure => failure.blockedReason === "csp")).toBe(true);
      expect(requests).toEqual([probeUrl]);
      expect(dispatched).toEqual([]);
      expect(responses).toEqual([]);
      await info.attach("native-frame-policy.json", {
        body: JSON.stringify({
          ...state,
          requests,
          dispatched,
          failures,
          responses,
          violations: await page.evaluate(() => Reflect.get(window, "__nativePolicyViolations")),
        }),
        contentType: "application/json",
      });
    } finally {
      await context.close();
    }
  });

  test(`${svg ? "SVG" : "XHTML"}: policy-blocked resources never become archive aliases or network loads`, async ({
    page: unusedPage,
  }, info) => {
    void unusedPage;
    const requests: string[] = [];
    const { context, readerPage: page } = await launchReader(fixture(info, svg), {
      beforeBookImport: async (library) => {
        const context = library.context();
        context.on("request", (request) => {
          if (request.url().includes("resource-policy.invalid")) requests.push(request.url());
        });
        await context.route("**/resource-policy.invalid/**", (route) => route.abort());
        await context.addInitScript(() => {
          const calls: { url: string; target?: string; features?: string }[] = [];
          Reflect.set(window, "__policyOpenCalls", calls);
          window.open = (url, target, features) => {
            calls.push({ url: String(url), target, features });
            return null;
          };
        });
      },
    });
    try {
      await exposeReaderController(page);
      await page.waitForFunction(() => {
        const controller = Reflect.get(window, "__readerController");
        return (
          !controller.isLoadInFlight &&
          controller.contentDocumentViews()[0]?.document.getElementById("policy-content")
        );
      });
      await expect
        .poll(() =>
          page.evaluate(() => {
            const doc: Document = Reflect.get(
              window,
              "__readerController",
            ).contentDocumentViews()[0].document;
            return ["local", "remote-fallback", "embed", "object"].every(
              (id) => (doc.getElementById(id) as HTMLImageElement).naturalWidth === 32,
            );
          }),
        )
        .toBe(true);
      const state = await page.evaluate(() => {
        const controller = Reflect.get(window, "__readerController");
        const doc: Document = controller.contentDocumentViews()[0].document;
        return {
          blocked: ["blocked-file", "blocked-data", "blocked-protocol", "blocked-frame"].map((id) =>
            doc.getElementById(id)?.getAttribute("src"),
          ),
          srcdoc: doc.getElementById("blocked-frame")?.getAttribute("srcdoc"),
          links: ["file", "data", "unsupported"].map((id) =>
            doc.getElementById(id)?.getAttribute("href"),
          ),
          background: doc.defaultView!.getComputedStyle(doc.getElementById("background")!)
            .backgroundImage,
          symbolWidth: doc.querySelector<SVGUseElement>("#use")!.getBBox().width,
        };
      });
      expect(state.blocked).toEqual([null, null, null, null]);
      expect(state.srcdoc).toBeNull();
      expect(state.links).toEqual(["#", "#", "#"]);
      expect(state.background).toBe("none");
      expect(state.symbolWidth).toBe(32);
      expect(requests).toEqual([]);
      const frame = page.frameLocator("iframe").first();
      for (const id of ["file", "data", "unsupported"]) {
        await frame.locator(`#${id}`).click();
        await expect(
          page.getByRole("status").filter({ hasText: "cannot open file, data" }),
        ).toBeVisible();
      }
      expect(await page.evaluate(() => Reflect.get(window, "__policyOpenCalls"))).toEqual([]);
      for (const id of ["https", "protocol"]) await frame.locator(`#${id}`).click();
      const calls = await page.evaluate(() => Reflect.get(window, "__policyOpenCalls"));
      expect(calls).toEqual([
        {
          url: "https://resource-policy.invalid/link",
          target: "_blank",
          features: "noopener,noreferrer",
        },
        {
          url: "https://resource-policy.invalid/link",
          target: "_blank",
          features: "noopener,noreferrer",
        },
      ]);
      await page.evaluate(async () => {
        const controller = Reflect.get(window, "__readerController");
        await controller.goToNavPoint(controller.navigation.toc.items[1]);
      });
      expect(await page.evaluate(() => Reflect.get(window, "__policyOpenCalls").length)).toBe(2);
      expect(requests).toEqual([]);
    } finally {
      await context.close();
    }
  });
}
