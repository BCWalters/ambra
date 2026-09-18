import { useEffect, useMemo, useState } from "react";
import type { FC, ReactNode } from "react";
import {
  Body1,
  Button,
  Caption1,
  Dialog,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Spinner,
  Tab,
  TabList,
} from "@fluentui/react-components";
import {
  BracesRegular,
  CodeRegular,
  DismissRegular,
  DocumentCssRegular,
  DocumentRegular,
  ImageRegular,
  MusicNote2Regular,
  TextFontRegular,
  VideoRegular,
} from "@fluentui/react-icons";
import type { FluentIcon } from "@fluentui/react-icons";
import hljs from "highlight.js/lib/core";
import xmlLanguage from "highlight.js/lib/languages/xml";
import cssLanguage from "highlight.js/lib/languages/css";
import javascriptLanguage from "highlight.js/lib/languages/javascript";
import jsonLanguage from "highlight.js/lib/languages/json";
import xmlFormat from "xml-formatter";
import type { EpubInspectionData } from "../ReaderController.js";
import { CHROME_BORDER } from "../chromeTheme.js";
import type { InspectorFileCategory } from "./inspectorFileKind.js";
import { classifyInspectionFile, guessMediaType } from "./inspectorFileKind.js";

hljs.registerLanguage("xml", xmlLanguage);
hljs.registerLanguage("css", cssLanguage);
hljs.registerLanguage("javascript", javascriptLanguage);
hljs.registerLanguage("json", jsonLanguage);

export interface EpubInspectorPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `undefined` until `ReaderApp` fetches it the first time this opens
   * (see `ReaderController.getEpubInspectionData`) — cheap/synchronous
   * once loaded, so unlike `BookDetails` this never needs to be
   * re-fetched on a later open. */
  data: EpubInspectionData | undefined;
  /** The original imported file's own name (e.g. `moby-dick.epub`) —
   * sourced from `BookDetails` (an async `LibraryDatabase` read) rather
   * than threaded through the synchronous `EpubInspectionData`, since
   * this panel is only reachable via a button in `BookDetailsPanel`,
   * which has always already fetched it by the time a reader gets here. */
  fileName: string | undefined;
  /** Reads one archive file's raw text on demand — see
   * `ReaderController.readInspectionFileText`. Not pre-loaded for every
   * file up front (a book can have hundreds of resources). */
  onReadFile: (path: string) => Promise<string>;
  /** Builds an object URL for previewing an image/audio/video archive
   * member — see `ReaderController.getInspectionFilePreviewUrl`. */
  onGetPreviewUrl: (path: string, mediaType: string) => Promise<string>;
}

/** Formats a byte count the way a developer tool would — "1.2 KB", not
 * "1,234 B" — since this panel's whole audience is EPUB authors poking
 * at their own file sizes, not casual readers. */
function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Icon + accent color per file category, so the Files tab's list reads
 * at a glance (markup vs. styles vs. scripts vs. media) the way a code
 * editor's file tree does — rather than every entry looking identical
 * except for its name. */
const CATEGORY_STYLE: Readonly<Record<InspectorFileCategory, { icon: FluentIcon; color: string }>> = {
  markup: { icon: CodeRegular, color: "#2563eb" },
  css: { icon: DocumentCssRegular, color: "#a855f7" },
  script: { icon: BracesRegular, color: "#ca8a04" },
  json: { icon: BracesRegular, color: "#ca8a04" },
  text: { icon: DocumentRegular, color: "#6b7280" },
  image: { icon: ImageRegular, color: "#16a34a" },
  audio: { icon: MusicNote2Regular, color: "#0d9488" },
  video: { icon: VideoRegular, color: "#dc2626" },
  font: { icon: TextFontRegular, color: "#475569" },
  binary: { icon: DocumentRegular, color: "#94a3b8" },
};

/** A small custom highlight.js theme, defined inline (rather than
 * importing one of highlight.js's own bundled theme stylesheets) so the
 * palette matches the rest of this panel's plain, light styling instead
 * of pulling in a separately-designed theme's own background/contrast
 * choices — this project otherwise styles everything with inline
 * styles/Fluent tokens, and a handful of `.hljs-*` rules is the smallest
 * way to get real syntax coloring without a mismatched visual import. */
const HighlightTheme: FC = () => (
  <style>{`
    .ambra-hljs .hljs-comment, .ambra-hljs .hljs-quote { color: #6b7280; font-style: italic; }
    .ambra-hljs .hljs-tag, .ambra-hljs .hljs-name, .ambra-hljs .hljs-selector-tag { color: #1d4ed8; }
    .ambra-hljs .hljs-attr, .ambra-hljs .hljs-attribute { color: #b45309; }
    .ambra-hljs .hljs-string, .ambra-hljs .hljs-doctag { color: #15803d; }
    .ambra-hljs .hljs-number, .ambra-hljs .hljs-literal { color: #b91c1c; }
    .ambra-hljs .hljs-keyword, .ambra-hljs .hljs-meta { color: #7c3aed; }
    .ambra-hljs .hljs-title, .ambra-hljs .hljs-function { color: #0f766e; }
  `}</style>
);

const FileTypeIcon: FC<{ category: InspectorFileCategory }> = ({ category }) => {
  const { icon: Icon, color } = CATEGORY_STYLE[category];
  return <Icon style={{ color, flexShrink: 0 }} fontSize={16} />;
};

/** Shows one selected file's contents in whatever form its category
 * calls for — pretty-printed/highlighted text, an image/audio/video
 * preview, or (for fonts and other binary formats) a plain "here's what
 * this is" indicator. Never decodes binary bytes as text (see
 * `classifyInspectionFile`'s doc comment for why that used to happen). */
const FilePreview: FC<{
  path: string;
  size: number;
  manifestMediaType: string | undefined;
  onReadFile: (path: string) => Promise<string>;
  onGetPreviewUrl: (path: string, mediaType: string) => Promise<string>;
}> = ({ path, size, manifestMediaType, onReadFile, onGetPreviewUrl }) => {
  const classification = useMemo(() => classifyInspectionFile(path, manifestMediaType), [path, manifestMediaType]);
  const resolvedMediaType = guessMediaType(path, manifestMediaType);

  const [textHtml, setTextHtml] = useState<string | undefined>(undefined);
  const [plainText, setPlainText] = useState<string | undefined>(undefined);
  const [previewUrl, setPreviewUrl] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    setTextHtml(undefined);
    setPlainText(undefined);
    setPreviewUrl(undefined);
    setError(undefined);
    setIsLoading(true);
    let cancelled = false;

    async function load(): Promise<void> {
      if (classification.isText) {
        let text = await onReadFile(path);
        if (classification.prettyPrintXml) {
          try {
            text = xmlFormat(text, { collapseContent: true, throwOnFailure: true });
          } catch {
            // Not well-formed enough to reformat (e.g. an HTML5 doctype
            // or an entity this strict-XML formatter doesn't accept) —
            // fall back to showing the original text as-is rather than
            // losing the file's contents entirely.
          }
        }
        if (cancelled) {
          return;
        }
        if (classification.highlightLanguage) {
          setTextHtml(hljs.highlight(text, { language: classification.highlightLanguage }).value);
        } else {
          setPlainText(text);
        }
        return;
      }
      if (classification.category === "image" || classification.category === "audio" || classification.category === "video") {
        const url = await onGetPreviewUrl(path, resolvedMediaType ?? "application/octet-stream");
        if (!cancelled) {
          setPreviewUrl(url);
        }
      }
      // "font"/"binary": nothing to load — just the indicator below.
    }

    load()
      .catch(() => {
        if (!cancelled) {
          setError("Couldn't load this file's preview.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [path, classification, onReadFile, onGetPreviewUrl, resolvedMediaType]);

  if (isLoading) {
    return <Spinner label="Loading…" />;
  }
  if (error) {
    return <Caption1 style={{ opacity: 0.6 }}>{error}</Caption1>;
  }

  if (classification.category === "image") {
    return (
      <img
        src={previewUrl}
        alt={path}
        style={{ maxWidth: "100%", maxHeight: "100%", display: "block", margin: "0 auto" }}
      />
    );
  }
  if (classification.category === "audio") {
    return <audio controls src={previewUrl} style={{ width: "100%", marginTop: 16 }} />;
  }
  if (classification.category === "video") {
    return <video controls src={previewUrl} style={{ maxWidth: "100%", display: "block", margin: "0 auto" }} />;
  }
  if (classification.category === "font" || classification.category === "binary") {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: 32 }}>
        <FileTypeIcon category={classification.category} />
        <Caption1 style={{ opacity: 0.6 }}>
          {classification.category === "font" ? "Font file" : "Binary file"} — {formatSize(size)}
          {resolvedMediaType ? ` — ${resolvedMediaType}` : ""}
        </Caption1>
        <Caption1 style={{ opacity: 0.6 }}>Not shown as text; use it as intended (font/embedded media).</Caption1>
      </div>
    );
  }

  return textHtml !== undefined ? (
    <>
      <HighlightTheme />
      <pre
        className="ambra-hljs"
        style={{
          margin: 0,
          fontFamily: "ui-monospace, Menlo, Consolas, monospace",
          fontSize: 12,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
        // Safe: highlight.js escapes the source text itself and only
        // wraps recognized tokens in `<span class="hljs-...">` — it
        // never interprets the file's own content as markup.
        dangerouslySetInnerHTML={{ __html: textHtml }}
      />
    </>
  ) : (
    <pre
      style={{
        margin: 0,
        fontFamily: "ui-monospace, Menlo, Consolas, monospace",
        fontSize: 12,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      {plainText}
    </pre>
  );
};

const FilesTab: FC<{
  data: EpubInspectionData;
  onReadFile: (path: string) => Promise<string>;
  onGetPreviewUrl: (path: string, mediaType: string) => Promise<string>;
}> = ({ data, onReadFile, onGetPreviewUrl }) => {
  const [selectedPath, setSelectedPath] = useState<string | undefined>(undefined);
  const selectedFile = data.files.find((file) => file.path === selectedPath);

  return (
    <div style={{ display: "flex", height: "100%", minHeight: 0 }}>
      <div
        style={{
          width: 300,
          flexShrink: 0,
          overflowY: "auto",
          borderRight: `1px solid ${CHROME_BORDER}`,
          padding: "4px 0",
        }}
      >
        {data.files.map((file) => {
          const classification = classifyInspectionFile(file.path, file.mediaType);
          return (
            <button
              key={file.path}
              type="button"
              onClick={() => setSelectedPath(file.path)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                width: "100%",
                background: selectedPath === file.path ? "var(--colorNeutralBackground1Selected, #e5e5e5)" : "none",
                border: "none",
                cursor: "pointer",
                padding: "6px 12px",
                textAlign: "left",
                font: "inherit",
                fontSize: 13,
              }}
            >
              <FileTypeIcon category={classification.category} />
              <span
                style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              >
                {file.path}
              </span>
              <Caption1 as="span" style={{ flexShrink: 0, opacity: 0.6 }}>
                {formatSize(file.size)}
              </Caption1>
            </button>
          );
        })}
      </div>
      <div style={{ flex: 1, minWidth: 0, overflow: "auto", padding: 12 }}>
        {!selectedFile ? (
          <Caption1 style={{ opacity: 0.6 }}>Select a file to view its contents.</Caption1>
        ) : (
          <FilePreview
            key={selectedFile.path}
            path={selectedFile.path}
            size={selectedFile.size}
            manifestMediaType={selectedFile.mediaType}
            onReadFile={onReadFile}
            onGetPreviewUrl={onGetPreviewUrl}
          />
        )}
      </div>
    </div>
  );
};

const metadataRowStyle = { padding: "2px 12px 2px 0", opacity: 0.6, verticalAlign: "top" } as const;

const Pill: FC<{ children: ReactNode }> = ({ children }) => (
  <span
    style={{
      display: "inline-block",
      padding: "2px 8px",
      margin: "0 4px 4px 0",
      borderRadius: 999,
      background: "var(--colorNeutralBackground3, #eee)",
      fontSize: 12,
    }}
  >
    {children}
  </span>
);

/** Everything the OPF `<metadata>` element declares — not just the
 * handful of fields (title/creator/description/publisher/language)
 * this engine specifically interprets for rendering, but every Dublin
 * Core element and every raw `<meta>` entry too, so an author can
 * confirm *exactly* what their book declares, including publisher- or
 * tool-specific extensions this app has no dedicated understanding of
 * (e.g. Calibre series metadata, EPUB3 `belongs-to-collection`). */
const MetadataTab: FC<{ data: EpubInspectionData; fileName: string | undefined }> = ({ data, fileName }) => {
  const creators = data.creators.length > 0 ? data.creators : data.creator ? [data.creator] : [];

  return (
    <div style={{ overflowY: "auto", padding: 16, fontSize: 13 }}>
      <table style={{ borderCollapse: "collapse", marginBottom: 20 }}>
        <tbody>
          {fileName && (
            <tr>
              <td style={metadataRowStyle}>File name</td>
              <td>{fileName}</td>
            </tr>
          )}
          <tr>
            <td style={metadataRowStyle}>Title</td>
            <td>{data.title}</td>
          </tr>
          {creators.length > 0 && (
            <tr>
              <td style={metadataRowStyle}>{creators.length > 1 ? "Creators" : "Creator"}</td>
              <td>{creators.join(", ")}</td>
            </tr>
          )}
          {data.contributors.length > 0 && (
            <tr>
              <td style={metadataRowStyle}>Contributors</td>
              <td>{data.contributors.join(", ")}</td>
            </tr>
          )}
          {data.publisher && (
            <tr>
              <td style={metadataRowStyle}>Publisher</td>
              <td>{data.publisher}</td>
            </tr>
          )}
          {data.date && (
            <tr>
              <td style={metadataRowStyle}>Date</td>
              <td>{data.date}</td>
            </tr>
          )}
          {data.rights && (
            <tr>
              <td style={metadataRowStyle}>Rights</td>
              <td>{data.rights}</td>
            </tr>
          )}
          <tr>
            <td style={metadataRowStyle}>Language</td>
            <td>{data.language}</td>
          </tr>
          <tr>
            <td style={metadataRowStyle}>Rendition layout</td>
            <td>{data.renditionLayout}</td>
          </tr>
          <tr>
            <td style={metadataRowStyle}>Root file</td>
            <td>{data.rootFilePath}</td>
          </tr>
          {data.identifiers.map((id, index) => (
            <tr key={index}>
              <td style={metadataRowStyle}>{id.scheme ?? "Identifier"}</td>
              <td>{id.value}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {data.subjects.length > 0 && (
        <>
          <Body1 as="p" block style={{ fontWeight: 600, margin: "0 0 6px" }}>
            Subjects
          </Body1>
          <div style={{ margin: "0 0 20px" }}>
            {data.subjects.map((subject, index) => (
              <Pill key={index}>{subject}</Pill>
            ))}
          </div>
        </>
      )}

      {data.description && (
        <>
          <Body1 as="p" block style={{ fontWeight: 600, margin: "0 0 4px" }}>
            Description
          </Body1>
          <Body1 as="p" block style={{ margin: "0 0 20px", whiteSpace: "pre-wrap" }}>
            {data.description}
          </Body1>
        </>
      )}

      {data.metaEntries.length > 0 && (
        <>
          <Body1 as="p" block style={{ fontWeight: 600, margin: "0 0 4px" }}>
            All OPF meta entries ({data.metaEntries.length})
          </Body1>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr style={{ textAlign: "left", opacity: 0.6 }}>
                <th style={{ fontWeight: 400, padding: "2px 12px 2px 0" }}>Property / name</th>
                <th style={{ fontWeight: 400, padding: "2px 12px 2px 0" }}>Value</th>
                <th style={{ fontWeight: 400 }}>Refines</th>
              </tr>
            </thead>
            <tbody>
              {data.metaEntries.map((entry, index) => (
                <tr key={index}>
                  <td style={{ padding: "2px 12px 2px 0" }}>{entry.key}</td>
                  <td style={{ padding: "2px 12px 2px 0", wordBreak: "break-word" }}>{entry.value}</td>
                  <td>{entry.refines ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
};

const SpineTab: FC<{ data: EpubInspectionData }> = ({ data }) => (
  <div style={{ overflowY: "auto", padding: 16, fontSize: 13 }}>
    <table style={{ borderCollapse: "collapse", width: "100%" }}>
      <thead>
        <tr style={{ textAlign: "left", opacity: 0.6 }}>
          <th style={{ fontWeight: 400, padding: "2px 12px 2px 0" }}>#</th>
          <th style={{ fontWeight: 400, padding: "2px 12px 2px 0" }}>Path</th>
          <th style={{ fontWeight: 400, padding: "2px 12px 2px 0" }}>Linear</th>
          <th style={{ fontWeight: 400 }}>Media type</th>
        </tr>
      </thead>
      <tbody>
        {data.spine.map((item, index) => (
          <tr key={index}>
            <td style={{ padding: "2px 12px 2px 0" }}>{index + 1}</td>
            <td style={{ padding: "2px 12px 2px 0" }}>{item.path}</td>
            <td style={{ padding: "2px 12px 2px 0" }}>{item.linear ? "yes" : "no"}</td>
            <td>{item.mediaType}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const ManifestTab: FC<{ data: EpubInspectionData }> = ({ data }) => (
  <div style={{ overflowY: "auto", padding: 16, fontSize: 13 }}>
    <table style={{ borderCollapse: "collapse", width: "100%" }}>
      <thead>
        <tr style={{ textAlign: "left", opacity: 0.6 }}>
          <th style={{ fontWeight: 400, padding: "2px 12px 2px 0" }}>ID</th>
          <th style={{ fontWeight: 400, padding: "2px 12px 2px 0" }}>Path</th>
          <th style={{ fontWeight: 400, padding: "2px 12px 2px 0" }}>Media type</th>
          <th style={{ fontWeight: 400 }}>Properties</th>
        </tr>
      </thead>
      <tbody>
        {data.manifest.map((item) => (
          <tr key={item.id}>
            <td style={{ padding: "2px 12px 2px 0" }}>{item.id}</td>
            <td style={{ padding: "2px 12px 2px 0" }}>{item.path}</td>
            <td style={{ padding: "2px 12px 2px 0" }}>{item.mediaType}</td>
            <td>{item.properties.join(", ")}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

type InspectorTab = "files" | "metadata" | "spine" | "manifest";

/**
 * An EPUB-author-facing tool (issue #46), reachable only via a button
 * tucked into the Book Details panel — deliberately not given its own
 * toolbar button, so an ordinary reader never notices it exists. Shows
 * the book's raw file structure (every entry in the underlying ZIP
 * archive, pretty-printed/syntax-highlighted for text, previewed for
 * images/audio/video, or plainly flagged as binary otherwise — see
 * `classifyInspectionFile`) plus a parsed view of its metadata/manifest/
 * spine, each in their own tab. "Validate EPUB"/"check accessibility"-
 * style actions are explicitly out of scope for this pass, per the
 * issue — this is purely a read-only inspection view for now.
 */
export const EpubInspectorPanel: FC<EpubInspectorPanelProps> = ({
  open,
  onOpenChange,
  data,
  fileName,
  onReadFile,
  onGetPreviewUrl,
}) => {
  const [activeTab, setActiveTab] = useState<InspectorTab>("files");

  return (
    <Dialog open={open} onOpenChange={(_event, dialogData) => onOpenChange(dialogData.open)}>
      <DialogSurface style={{ maxWidth: 900, width: "90vw", height: "80vh" }}>
        <DialogBody style={{ height: "100%", display: "flex", flexDirection: "column" }}>
          <DialogTitle
            action={
              <Button
                appearance="subtle"
                icon={<DismissRegular />}
                aria-label="Close EPUB Inspector"
                onClick={() => onOpenChange(false)}
              />
            }
          >
            EPUB Inspector
          </DialogTitle>
          <DialogContent style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            {!data ? (
              <Spinner label="Loading…" />
            ) : (
              <>
                <TabList
                  selectedValue={activeTab}
                  onTabSelect={(_event, tabData) => setActiveTab(tabData.value as InspectorTab)}
                >
                  <Tab value="files">Files ({data.files.length})</Tab>
                  <Tab value="metadata">Metadata</Tab>
                  <Tab value="spine">Spine ({data.spine.length})</Tab>
                  <Tab value="manifest">Manifest ({data.manifest.length})</Tab>
                </TabList>
                <div style={{ flex: 1, minHeight: 0, marginTop: 8 }}>
                  {activeTab === "files" && (
                    <FilesTab data={data} onReadFile={onReadFile} onGetPreviewUrl={onGetPreviewUrl} />
                  )}
                  {activeTab === "metadata" && <MetadataTab data={data} fileName={fileName} />}
                  {activeTab === "spine" && <SpineTab data={data} />}
                  {activeTab === "manifest" && <ManifestTab data={data} />}
                </div>
              </>
            )}
          </DialogContent>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
};
