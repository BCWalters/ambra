import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, FC, MutableRefObject } from "react";
import { Body1, Button, Caption1, Divider, Title2, Title3 } from "@fluentui/react-components";
import {
  ContentDocumentAssembler,
  ContentLoader,
  EpubContainer,
  Locator,
  LocatorResolver,
  NavigationDocument,
  PaginationEngine,
  ResourceUrlResolver,
  SandboxedContentHost,
  ScrollViewEngine,
  type NavPoint,
  type PackageDocument,
  type Page,
} from "@pagina/engine";

interface ParsedBookSummary {
  fileName: string;
  identifier: string;
  title: string;
  language: string;
  renditionLayout: PackageDocument["metadata"]["renditionLayout"];
  manifest: { id: string; path: string; mediaType: string; properties: string[] }[];
  spine: { id: string; linear: boolean; effectiveLayout: string }[];
  navigation: NavigationDocument;
  firstSpineResourceRefs: { attributeName: string; path: string }[];
  cfiDemo: { cfi: string; matchedAfterRoundTrip: boolean; resolvedText: string } | undefined;
}

/** Finds the first non-blank text node under `root`, walking depth-first. */
function findFirstNonBlankTextNode(root: Node): Text | undefined {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if (node.textContent && node.textContent.trim().length > 0) {
      return node as Text;
    }
    node = walker.nextNode();
  }
  return undefined;
}

async function buildBookSummary(
  container: EpubContainer,
  fileName: string,
): Promise<ParsedBookSummary> {
  const pkg = await container.getPackageDocument();
  const navigation = await NavigationDocument.load(container);
  const contentLoader = await ContentLoader.create(container);

  let firstSpineResourceRefs: { attributeName: string; path: string }[] = [];
  let cfiDemo: ParsedBookSummary["cfiDemo"];
  if (pkg.spine.length > 0) {
    const firstSpineDoc = await contentLoader.loadSpineDocument(0);
    firstSpineResourceRefs = contentLoader
      .findResourceReferences(firstSpineDoc)
      .map((ref) => ({ attributeName: ref.attributeName, path: ref.path }));

    const textNode = findFirstNonBlankTextNode(firstSpineDoc.document.body);
    if (textNode) {
      const resolver = new LocatorResolver(pkg, contentLoader);
      const locator = resolver.generate(0, textNode, 0);
      // Resolve against a *freshly reloaded* parse (not the same document
      // instance) to prove the CFI is a real, portable position — this is
      // the actual resume-reading scenario, not just an in-memory echo.
      const resolved = await resolver.resolve(locator);
      cfiDemo = {
        cfi: locator.cfi,
        matchedAfterRoundTrip: resolved.node.textContent === textNode.textContent,
        resolvedText: (resolved.node.textContent ?? "").slice(0, 60),
      };
    }
  }

  return {
    fileName,
    identifier: pkg.metadata.identifier,
    title: pkg.metadata.title,
    language: pkg.metadata.language,
    renditionLayout: pkg.metadata.renditionLayout,
    manifest: pkg.manifest.map((item) => ({
      id: item.id,
      path: item.path,
      mediaType: item.mediaType,
      properties: [...item.properties],
    })),
    spine: pkg.spine.map((ref) => ({
      id: ref.manifestItem.id,
      linear: ref.linear,
      effectiveLayout: ref.resolveRenditionLayout(pkg.metadata.renditionLayout),
    })),
    navigation,
    firstSpineResourceRefs,
    cfiDemo,
  };
}

interface ActiveRender {
  host: SandboxedContentHost;
  resolver: ResourceUrlResolver;
  pages: Page[];
}

const PAGINATION_DEMO_WIDTH = 400;
const PAGINATION_DEMO_HEIGHT = 300;

/** Loads spine item 0, resolves its resources to blob URLs, and assembles
 * the final renderable XHTML — the load pipeline shared by both the
 * paginated and scroll-view render demos below (`ContentLoader` ->
 * `ResourceUrlResolver` -> `ContentDocumentAssembler`). Each caller gets
 * its own fresh `ResourceUrlResolver` (and therefore its own blob URLs)
 * since the two demos are disposed independently. */
async function loadAssembledFirstSpineItem(
  container: EpubContainer,
): Promise<{ assembledXhtml: string; resolver: ResourceUrlResolver; pkg: PackageDocument; contentLoader: ContentLoader }> {
  const pkg = await container.getPackageDocument();
  const contentLoader = await ContentLoader.create(container);
  const spineDoc = await contentLoader.loadSpineDocument(0);
  const references = contentLoader.findResourceReferences(spineDoc);

  const resolver = new ResourceUrlResolver(contentLoader);
  const resourceUrls = await resolver.resolveAll(references.map((ref) => ref.path));

  const assembledXhtml = ContentDocumentAssembler.assemble(spineDoc, resourceUrls);
  return { assembledXhtml, resolver, pkg, contentLoader };
}

/** Renders the first spine item into a real `SandboxedContentHost`, and
 * appends its iframe into `containerEl`. Exercises the full rendering
 * pipeline: ContentLoader -> ResourceUrlResolver -> ContentDocumentAssembler
 * -> SandboxedContentHost -> PaginationEngine. */
async function renderFirstSpineItem(
  container: EpubContainer,
  containerEl: HTMLDivElement,
  activeRenderRef: MutableRefObject<ActiveRender | null>,
): Promise<Page[]> {
  const { assembledXhtml, resolver } = await loadAssembledFirstSpineItem(container);

  const host = new SandboxedContentHost();
  host.element.style.width = `${PAGINATION_DEMO_WIDTH}px`;
  host.element.style.height = `${PAGINATION_DEMO_HEIGHT}px`;
  containerEl.replaceChildren(host.element);
  await host.render(assembledXhtml);

  const iframeDocument = host.element.contentDocument;
  if (!iframeDocument) {
    throw new Error("Sandboxed iframe has no contentDocument after loading (unexpected).");
  }

  // A real PaginatedContentHost (future work, alongside reader-shell-ui)
  // would own this display mechanism properly; for this dev-tool demo we
  // apply it directly. Prevent the iframe's own scrollbar from appearing
  // for content taller than one page — display is purely the transform
  // PaginationEngine computes per page, clipped by resizing the iframe's
  // own box to that page's exact height in `showPage()` below.
  iframeDocument.documentElement.style.overflow = "hidden";
  iframeDocument.body.style.overflow = "hidden";

  const pages = PaginationEngine.paginate(iframeDocument.body, PAGINATION_DEMO_HEIGHT);

  activeRenderRef.current = { host, resolver, pages };
  if (pages.length > 0) {
    showPage(host, pages[0]!);
  }
  return pages;
}

/** Displays `page` by translating the content up so its first line sits at
 * the top of the iframe, *and* shrinking the iframe's own box to exactly
 * `page.height`. The latter is essential, not cosmetic: a page's content
 * frequently doesn't fill the full `pageHeight` budget it was measured
 * against (e.g. the next chunk didn't fit and started a new page instead),
 * and the underlying DOM keeps flowing normally past the end of the
 * current page. Clipping to a *fixed* `pageHeight`-tall window would let
 * the next page's content visually "bleed through" into the unused space
 * at the bottom of the current one instead of showing a clean edge — this
 * exact bug was caught via real-Chromium verification. Sizing the iframe
 * itself to `page.height` makes the browser's own viewport clipping do the
 * right thing with no extra bookkeeping. */
function showPage(host: SandboxedContentHost, page: Page): void {
  const body = host.element.contentDocument?.body;
  if (body) {
    body.style.transform = `translateY(${page.displayTranslateY}px)`;
  }
  host.element.style.height = `${page.height}px`;
}

interface ActiveScrollRender {
  host: SandboxedContentHost;
  resolver: ResourceUrlResolver;
  engine: ScrollViewEngine;
  locatorResolver: LocatorResolver;
  refreshPosition: () => void;
  removeScrollListener: () => void;
}

const SCROLL_DEMO_WIDTH = 400;
const SCROLL_DEMO_HEIGHT = 300;

/** Renders the same first spine item a second time, into a *separate*
 * `SandboxedContentHost`, in continuous-scroll mode instead of paginated
 * mode: deliberately does *not* touch `overflow` (unlike the paginated
 * demo above), letting the iframe scroll natively, and uses
 * `ScrollViewEngine` to track/restore position as the reader scrolls
 * instead of `PaginationEngine`'s page breaks. */
async function renderScrollViewDemo(
  container: EpubContainer,
  containerEl: HTMLDivElement,
  activeScrollRenderRef: MutableRefObject<ActiveScrollRender | null>,
  onPositionChange: (cfi: string | undefined) => void,
): Promise<void> {
  const { assembledXhtml, resolver, pkg, contentLoader } = await loadAssembledFirstSpineItem(container);

  const host = new SandboxedContentHost();
  host.element.style.width = `${SCROLL_DEMO_WIDTH}px`;
  host.element.style.height = `${SCROLL_DEMO_HEIGHT}px`;
  containerEl.replaceChildren(host.element);
  await host.render(assembledXhtml);

  const iframeDocument = host.element.contentDocument;
  const iframeWindow = host.element.contentWindow;
  if (!iframeDocument || !iframeWindow) {
    throw new Error("Sandboxed iframe has no contentDocument/contentWindow after loading (unexpected).");
  }

  const engine = ScrollViewEngine.prepare(iframeDocument.body);
  const locatorResolver = new LocatorResolver(pkg, contentLoader);

  const reportCurrentPosition = (): void => {
    const position = engine.currentPosition();
    if (!position) {
      onPositionChange(undefined);
      return;
    }
    const locator = locatorResolver.generate(0, position.node, position.offset);
    onPositionChange(locator.cfi);
  };

  // A real reading surface would debounce this (per the scroll-view-mode
  // design: position tracking shouldn't regenerate a CFI on every single
  // scroll event), but for this demo we report immediately so it's
  // trivial to verify live in a real browser. The "Refresh position"
  // button in the UI calls `reportCurrentPosition` directly too, since
  // some automated test harnesses run pages without an active rendering
  // loop, where native `scroll` events never fire at all (a harness
  // limitation, not something a real user's browser does) — the button
  // gives a reliable way to exercise the same position-tracking logic
  // regardless.
  const handleScroll = (): void => reportCurrentPosition();
  iframeWindow.addEventListener("scroll", handleScroll);
  reportCurrentPosition();

  activeScrollRenderRef.current = {
    host,
    resolver,
    engine,
    locatorResolver,
    refreshPosition: reportCurrentPosition,
    removeScrollListener: () => iframeWindow.removeEventListener("scroll", handleScroll),
  };
}


const NavTree: FC<{ items: readonly NavPoint[] }> = ({ items }) => {
  if (items.length === 0) {
    return null;
  }

  return (
    <ul>
      {items.map((item, index) => (
        <li key={index}>
          {item.isLinked ? (
            <>
              {item.label} — <code>{item.path}</code>
              {item.fragment ? <code>#{item.fragment}</code> : null}
            </>
          ) : (
            <em>{item.label} (heading only, no link)</em>
          )}
          <NavTree items={item.children} />
        </li>
      ))}
    </ul>
  );
};

/**
 * Temporary developer tool for manually exercising the engine end-to-end
 * while the real reading surface (`pagination-engine`, `reader-shell-ui`,
 * etc.) doesn't exist yet: pick any .epub file, parse it with
 * `@pagina/engine`, and show what the container/OPF parser found. Remove
 * once the real reader UI supersedes it.
 */
export const EpubInspector: FC = () => {
  const [summary, setSummary] = useState<ParsedBookSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [renderableContainer, setRenderableContainer] = useState<EpubContainer | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [scrollCurrentCfi, setScrollCurrentCfi] = useState<string | undefined>(undefined);
  const [scrollSavedCfi, setScrollSavedCfi] = useState<string | undefined>(undefined);

  const hostContainerRef = useRef<HTMLDivElement | null>(null);
  const activeRenderRef = useRef<ActiveRender | null>(null);
  const scrollHostContainerRef = useRef<HTMLDivElement | null>(null);
  const activeScrollRenderRef = useRef<ActiveScrollRender | null>(null);

  useEffect(() => {
    // Only runs once React has committed the DOM for the current
    // `summary`/`renderableContainer` state, so `hostContainerRef.current`
    // is guaranteed to already point at the (now-mounted) container div —
    // unlike reading the ref synchronously inside handleFileChange right
    // after calling setSummary, which would still see the *previous*
    // render's DOM (React state updates aren't reflected synchronously).
    if (!renderableContainer || !hostContainerRef.current) {
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const pages = await renderFirstSpineItem(
          renderableContainer,
          hostContainerRef.current!,
          activeRenderRef,
        );
        if (!cancelled) {
          setPageCount(pages.length);
          setCurrentPageIndex(0);
        }
      } catch (renderErr) {
        if (!cancelled) {
          setRenderError(renderErr instanceof Error ? renderErr.message : String(renderErr));
        }
      }
    })();

    return () => {
      cancelled = true;
      activeRenderRef.current?.host.dispose();
      activeRenderRef.current?.resolver.dispose();
      activeRenderRef.current = null;
    };
  }, [renderableContainer]);

  useEffect(() => {
    if (!renderableContainer || !scrollHostContainerRef.current) {
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        await renderScrollViewDemo(
          renderableContainer,
          scrollHostContainerRef.current!,
          activeScrollRenderRef,
          (cfi) => {
            if (!cancelled) {
              setScrollCurrentCfi(cfi);
            }
          },
        );
      } catch (renderErr) {
        if (!cancelled) {
          setRenderError(renderErr instanceof Error ? renderErr.message : String(renderErr));
        }
      }
    })();

    return () => {
      cancelled = true;
      activeScrollRenderRef.current?.removeScrollListener();
      activeScrollRenderRef.current?.host.dispose();
      activeScrollRenderRef.current?.resolver.dispose();
      activeScrollRenderRef.current = null;
      setScrollCurrentCfi(undefined);
      setScrollSavedCfi(undefined);
    };
  }, [renderableContainer]);

  const goToPage = (index: number): void => {
    const active = activeRenderRef.current;
    if (!active || index < 0 || index >= active.pages.length) {
      return;
    }
    showPage(active.host, active.pages[index]!);
    setCurrentPageIndex(index);
  };

  const saveScrollPosition = (): void => {
    setScrollSavedCfi(scrollCurrentCfi);
  };

  const refreshScrollPosition = (): void => {
    activeScrollRenderRef.current?.refreshPosition();
  };

  const scrollToBottom = (): void => {
    const active = activeScrollRenderRef.current;
    const scrollingElement = active?.host.element.contentDocument?.scrollingElement;
    if (scrollingElement) {
      scrollingElement.scrollTop = scrollingElement.scrollHeight;
      active?.refreshPosition();
    }
  };

  const restoreSavedScrollPosition = (): void => {
    const active = activeScrollRenderRef.current;
    const iframeDocument = active?.host.element.contentDocument;
    if (!active || !iframeDocument || !scrollSavedCfi) {
      return;
    }
    const locator = new Locator(scrollSavedCfi);
    const resolved = active.locatorResolver.resolveInDocument(locator, 0, iframeDocument);
    active.engine.restorePosition(resolved.node, resolved.characterOffset ?? 0);
    active.refreshPosition();
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setIsLoading(true);
    setError(null);
    setSummary(null);
    setRenderError(null);
    setRenderableContainer(null);
    setPageCount(null);
    setCurrentPageIndex(0);

    try {
      const buffer = await file.arrayBuffer();
      const container = await EpubContainer.open(buffer);
      const parsedSummary = await buildBookSummary(container, file.name);
      setSummary(parsedSummary);

      if (parsedSummary.spine.length > 0) {
        setRenderableContainer(container);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{ padding: 16, maxWidth: 720 }}>
      <Title2>Pagina Reader — engine inspector (dev tool)</Title2>
      <Body1 as="p">
        Pick an .epub file to parse it with the real engine (ZipArchive → EpubContainer →
        PackageDocument) and see what it found. This is a temporary stand-in for the actual reading
        surface.
      </Body1>

      <input type="file" accept=".epub" onChange={(event) => void handleFileChange(event)} />

      {isLoading && <Body1 as="p">Parsing…</Body1>}
      {error && (
        <Body1 as="p" style={{ color: "var(--colorPaletteRedForeground1, crimson)" }}>
          Error: {error}
        </Body1>
      )}

      {summary && (
        <div style={{ marginTop: 16 }}>
          <Title3>{summary.title}</Title3>
          <Caption1 as="p">{summary.fileName}</Caption1>
          <Body1 as="p">
            Identifier: <code>{summary.identifier}</code>
            <br />
            Language: <code>{summary.language}</code>
            <br />
            Rendition layout (default): <code>{summary.renditionLayout}</code>
          </Body1>

          <Divider style={{ margin: "12px 0" }} />

          <Title3>Spine ({summary.spine.length})</Title3>
          <ol>
            {summary.spine.map((ref) => (
              <li key={ref.id}>
                <code>{ref.id}</code> — linear: {String(ref.linear)}, layout: {ref.effectiveLayout}
              </li>
            ))}
          </ol>

          <Divider style={{ margin: "12px 0" }} />

          <Title3>Manifest ({summary.manifest.length})</Title3>
          <ul>
            {summary.manifest.map((item) => (
              <li key={item.id}>
                <code>{item.id}</code> → {item.path} ({item.mediaType})
                {item.properties.length > 0 ? ` [${item.properties.join(", ")}]` : ""}
              </li>
            ))}
          </ul>

          <Divider style={{ margin: "12px 0" }} />

          <Title3>Table of contents</Title3>
          <NavTree items={summary.navigation.toc.items} />

          {summary.navigation.landmarks && (
            <>
              <Title3>Landmarks</Title3>
              <NavTree items={summary.navigation.landmarks.items} />
            </>
          )}

          {summary.navigation.pageList && (
            <>
              <Title3>Page list</Title3>
              <NavTree items={summary.navigation.pageList.items} />
            </>
          )}

          <Divider style={{ margin: "12px 0" }} />

          <Title3>
            Resource references in first spine item ({summary.firstSpineResourceRefs.length})
          </Title3>
          <ul>
            {summary.firstSpineResourceRefs.map((ref, index) => (
              <li key={index}>
                <code>{ref.attributeName}</code> → {ref.path}
              </li>
            ))}
          </ul>

          <Divider style={{ margin: "12px 0" }} />

          <Title3>CFI engine demo (first text position)</Title3>
          {summary.cfiDemo ? (
            <Body1 as="p">
              CFI: <code>{summary.cfiDemo.cfi}</code>
              <br />
              Resolved (after a fresh reload/re-parse) text: "{summary.cfiDemo.resolvedText}"
              <br />
              Round-trip match:{" "}
              <strong
                style={{ color: summary.cfiDemo.matchedAfterRoundTrip ? "green" : "crimson" }}
              >
                {String(summary.cfiDemo.matchedAfterRoundTrip)}
              </strong>
            </Body1>
          ) : (
            <Body1 as="p">No text content found to demo.</Body1>
          )}

          <Divider style={{ margin: "12px 0" }} />

          <Title3>Sandboxed render of first spine item (paginated)</Title3>
          {renderError && (
            <Body1 as="p" style={{ color: "var(--colorPaletteRedForeground1, crimson)" }}>
              Render error: {renderError}
            </Body1>
          )}
          {pageCount !== null && (
            <Body1 as="p">
              Page {currentPageIndex + 1} of {pageCount} ({PAGINATION_DEMO_WIDTH}×
              {PAGINATION_DEMO_HEIGHT}px pages)
              <Button
                size="small"
                style={{ marginLeft: 12 }}
                disabled={currentPageIndex <= 0}
                onClick={() => goToPage(currentPageIndex - 1)}
              >
                ← Prev
              </Button>
              <Button
                size="small"
                style={{ marginLeft: 8 }}
                disabled={currentPageIndex >= pageCount - 1}
                onClick={() => goToPage(currentPageIndex + 1)}
              >
                Next →
              </Button>
            </Body1>
          )}
          <div
            ref={hostContainerRef}
            style={{
              height: PAGINATION_DEMO_HEIGHT,
              width: PAGINATION_DEMO_WIDTH,
              overflow: "hidden",
              border: "1px solid var(--colorNeutralStroke1, #ccc)",
              marginTop: 8,
            }}
          />

          <Divider style={{ margin: "12px 0" }} />

          <Title3>Sandboxed render of first spine item (continuous scroll)</Title3>
          <Body1 as="p">
            Current position: <code>{scrollCurrentCfi ?? "(none)"}</code>
            <br />
            <Button size="small" style={{ marginTop: 8 }} onClick={refreshScrollPosition}>
              Refresh position
            </Button>
            <Button size="small" style={{ marginLeft: 8 }} onClick={saveScrollPosition}>
              Save position
            </Button>
            <Button size="small" style={{ marginLeft: 8 }} onClick={scrollToBottom}>
              Scroll to bottom
            </Button>
            <Button
              size="small"
              style={{ marginLeft: 8 }}
              disabled={!scrollSavedCfi}
              onClick={restoreSavedScrollPosition}
            >
              Restore saved position
            </Button>
            {scrollSavedCfi && (
              <>
                <br />
                Saved: <code>{scrollSavedCfi}</code>
              </>
            )}
          </Body1>
          <div
            ref={scrollHostContainerRef}
            style={{
              height: SCROLL_DEMO_HEIGHT,
              width: SCROLL_DEMO_WIDTH,
              overflow: "hidden",
              border: "1px solid var(--colorNeutralStroke1, #ccc)",
              marginTop: 8,
            }}
          />
        </div>
      )}
    </div>
  );
};
