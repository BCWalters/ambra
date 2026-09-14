import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, FC, MutableRefObject } from "react";
import { Body1, Caption1, Divider, Title2, Title3 } from "@fluentui/react-components";
import {
  ContentDocumentAssembler,
  ContentLoader,
  EpubContainer,
  LocatorResolver,
  NavigationDocument,
  ResourceUrlResolver,
  SandboxedContentHost,
  type NavPoint,
  type PackageDocument,
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
}

/** Renders the first spine item into a real `SandboxedContentHost`, and
 * appends its iframe into `containerEl`. Exercises the full rendering
 * pipeline: ContentLoader -> ResourceUrlResolver -> ContentDocumentAssembler
 * -> SandboxedContentHost. */
async function renderFirstSpineItem(
  container: EpubContainer,
  containerEl: HTMLDivElement,
  activeRenderRef: MutableRefObject<ActiveRender | null>,
): Promise<void> {
  const contentLoader = await ContentLoader.create(container);
  const spineDoc = await contentLoader.loadSpineDocument(0);
  const references = contentLoader.findResourceReferences(spineDoc);

  const resolver = new ResourceUrlResolver(contentLoader);
  const resourceUrls = await resolver.resolveAll(references.map((ref) => ref.path));

  const assembledXhtml = ContentDocumentAssembler.assemble(spineDoc, resourceUrls);

  const host = new SandboxedContentHost();
  containerEl.replaceChildren(host.element);
  await host.render(assembledXhtml);

  activeRenderRef.current = { host, resolver };
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

  const hostContainerRef = useRef<HTMLDivElement | null>(null);
  const activeRenderRef = useRef<ActiveRender | null>(null);

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
        await renderFirstSpineItem(renderableContainer, hostContainerRef.current!, activeRenderRef);
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

          <Title3>Sandboxed render of first spine item</Title3>
          {renderError && (
            <Body1 as="p" style={{ color: "var(--colorPaletteRedForeground1, crimson)" }}>
              Render error: {renderError}
            </Body1>
          )}
          <div
            ref={hostContainerRef}
            style={{
              height: 320,
              border: "1px solid var(--colorNeutralStroke1, #ccc)",
              marginTop: 8,
            }}
          />
        </div>
      )}
    </div>
  );
};
