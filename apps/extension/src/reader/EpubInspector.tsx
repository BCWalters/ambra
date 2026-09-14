import { useState } from "react";
import type { ChangeEvent, FC } from "react";
import { Body1, Caption1, Divider, Title2, Title3 } from "@fluentui/react-components";
import {
  EpubContainer,
  NavigationDocument,
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
}

async function parseEpubFile(file: File): Promise<ParsedBookSummary> {
  const buffer = await file.arrayBuffer();
  const container = await EpubContainer.open(buffer);
  const pkg = await container.getPackageDocument();
  const navigation = await NavigationDocument.load(container);

  return {
    fileName: file.name,
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

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setIsLoading(true);
    setError(null);
    setSummary(null);

    try {
      setSummary(await parseEpubFile(file));
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
        </div>
      )}
    </div>
  );
};
