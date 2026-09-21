import { useEffect, useMemo, useRef, useState } from "react";
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
  Tooltip,
} from "@fluentui/react-components";
import {
  ArchiveRegular,
  ArrowLeftRegular,
  BracesRegular,
  CodeRegular,
  DismissRegular,
  DocumentCssRegular,
  DocumentRegular,
  DocumentSettingsRegular,
  FullScreenMaximizeRegular,
  FullScreenMinimizeRegular,
  ImageRegular,
  MusicNote2Regular,
  TextBulletListRegular,
  TextFontRegular,
  TextWrapOffRegular,
  TextWrapRegular,
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
import { useChromeTheme } from "../ChromeThemeContext.js";
import { useTranslation } from "../../i18n/LocaleContext.js";
import type { InspectorFileCategory, SpecialFileKind } from "./inspectorFileKind.js";
import { classifyInspectionFile, guessMediaType, identifySpecialFiles } from "./inspectorFileKind.js";
import { isNavigableLinkAttribute, resolveNavigableLinkTarget } from "./inspectorContentLinks.js";


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

/** Icon + accent color for each of the handful of files that establish
 * an EPUB's own structure (issue #95) — takes over from
 * `CATEGORY_STYLE`'s generic per-category choice for exactly these
 * paths (see `identifySpecialFiles`), so they stand out from the dozens
 * of otherwise-identical-looking XHTML/XML entries in a real book's
 * file list. */
const SPECIAL_FILE_STYLE: Readonly<Record<SpecialFileKind, { icon: FluentIcon; color: string }>> = {
  container: { icon: ArchiveRegular, color: "#64748b" },
  opf: { icon: DocumentSettingsRegular, color: "#0891b2" },
  toc: { icon: TextBulletListRegular, color: "#7c3aed" },
  cover: { icon: ImageRegular, color: "#d97706" },
};

function specialFileLabel(special: SpecialFileKind, t: ReturnType<typeof useTranslation>): string {
  switch (special) {
    case "container":
      return t("inspector.specialFileContainer");
    case "opf":
      return t("inspector.specialFileOpf");
    case "toc":
      return t("toc.tableOfContents");
    case "cover":
      return t("inspector.specialFileCover");
  }
}

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
    /* Issue #95: an href/src attribute value that resolves to another
       file in this same archive — marked clickable by a DOM walk over
       this already-rendered markup (see FilePreview's own effect),
       rather than styled inline, so a plain (non-navigable, e.g.
       external) string keeps its ordinary hljs-string look. */
    .ambra-hljs .ambra-navlink { cursor: pointer; text-decoration: underline; text-decoration-style: dotted; }
    .ambra-hljs .ambra-navlink:hover { color: #0f766e; }
  `}</style>
);

const FileTypeIcon: FC<{ category: InspectorFileCategory; special?: SpecialFileKind }> = ({ category, special }) => {
  const { icon: Icon, color } = special ? SPECIAL_FILE_STYLE[special] : CATEGORY_STYLE[category];
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
  wrap: boolean;
  knownFilePaths: ReadonlySet<string>;
  onReadFile: (path: string) => Promise<string>;
  onGetPreviewUrl: (path: string, mediaType: string) => Promise<string>;
  onNavigateToFile: (path: string) => void;
}> = ({ path, size, manifestMediaType, wrap, knownFilePaths, onReadFile, onGetPreviewUrl, onNavigateToFile }) => {
  const t = useTranslation();
  const classification = useMemo(() => classifyInspectionFile(path, manifestMediaType), [path, manifestMediaType]);
  const resolvedMediaType = guessMediaType(path, manifestMediaType);
  const preRef = useRef<HTMLPreElement>(null);

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
          setError(t("inspector.previewLoadError"));
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
  }, [path, classification, onReadFile, onGetPreviewUrl, resolvedMediaType, t]);

  // Issue #95: marks every `href`/`src` attribute value in the just-
  // rendered markup that resolves to another file *this same archive
  // actually has* as clickable — a plain DOM walk over the already-
  // highlighted output (see `HighlightTheme`'s own doc comment on why
  // this happens here, not as part of the highlighted HTML string
  // itself). Re-runs whenever a new file's markup is rendered
  // (`textHtml` change) — nothing to do for a file with no highlighted
  // markup at all (images, binaries, non-XML text).
  useEffect(() => {
    const container = preRef.current;
    if (!container || textHtml === undefined) {
      return;
    }
    const stringSpans = container.querySelectorAll<HTMLElement>(".hljs-string");
    for (const stringSpan of stringSpans) {
      const attrSpan = stringSpan.previousElementSibling;
      if (!attrSpan || !attrSpan.classList.contains("hljs-attr")) {
        continue;
      }
      const attrName = attrSpan.textContent ?? "";
      if (!isNavigableLinkAttribute(attrName)) {
        continue;
      }
      // hljs's xml grammar always includes the quote characters
      // themselves as part of the string token (e.g. `"chapter2.xhtml"`,
      // quotes included) — strip one matching pair, if present, to get
      // the raw attribute value underneath.
      const raw = stringSpan.textContent ?? "";
      const quote = raw.length >= 2 && (raw[0] === '"' || raw[0] === "'") && raw[0] === raw[raw.length - 1];
      const rawHref = quote ? raw.slice(1, -1) : raw;
      const target = resolveNavigableLinkTarget(path, rawHref, knownFilePaths);
      if (!target) {
        continue;
      }
      stringSpan.classList.add("ambra-navlink");
      stringSpan.dataset.navPath = target;
      stringSpan.setAttribute("role", "link");
      stringSpan.setAttribute("tabindex", "0");
      stringSpan.title = t("inspector.openFile", { path: target });
    }
  }, [textHtml, path, knownFilePaths, t]);

  function handleContentLinkActivate(target: EventTarget | null): void {
    const el = target instanceof Element ? target.closest<HTMLElement>("[data-nav-path]") : null;
    const navPath = el?.dataset.navPath;
    if (navPath) {
      onNavigateToFile(navPath);
    }
  }

  if (isLoading) {
    return <Spinner label={t("reader.loading")} />;
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
          {classification.category === "font" ? t("inspector.fontFile") : t("inspector.binaryFile")} — {formatSize(size)}
          {resolvedMediaType ? ` — ${resolvedMediaType}` : ""}
        </Caption1>
        <Caption1 style={{ opacity: 0.6 }}>{t("inspector.binaryPreviewHint")}</Caption1>
      </div>
    );
  }

  return textHtml !== undefined ? (
    <>
      <HighlightTheme />
      <pre
        ref={preRef}
        className="ambra-hljs"
        style={{
          margin: 0,
          fontFamily: "ui-monospace, Menlo, Consolas, monospace",
          fontSize: 12,
          whiteSpace: wrap ? "pre-wrap" : "pre",
          wordBreak: wrap ? "break-word" : "normal",
        }}
        // Lets a keyboard user Tab to a linkified `href`/`src` span (see
        // the effect above, which gives each one `tabindex="0"`) and
        // activate it with Enter/Space — the same expectation a real
        // `<a>` would set.
        onClick={(event) => handleContentLinkActivate(event.target)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            handleContentLinkActivate(event.target);
          }
        }}
        // Safe: highlight.js escapes the source text itself and only
        // wraps recognized tokens in `<span class="hljs-...">` — it
        // never interprets the file's own content as markup. The effect
        // above only ever *adds* attributes/classes to elements hljs
        // already produced; it never introduces new markup of its own.
        dangerouslySetInnerHTML={{ __html: textHtml }}
      />
    </>
  ) : (
    <pre
      style={{
        margin: 0,
        fontFamily: "ui-monospace, Menlo, Consolas, monospace",
        fontSize: 12,
        whiteSpace: wrap ? "pre-wrap" : "pre",
        wordBreak: wrap ? "break-word" : "normal",
      }}
    >
      {plainText}
    </pre>
  );
};

const FilesTab: FC<{
  data: EpubInspectionData;
  selectedPath: string | undefined;
  onSelectPath: (path: string) => void;
  onNavigateToFile: (path: string) => void;
  isFullScreen: boolean;
  onToggleFullScreen: () => void;
  onReadFile: (path: string) => Promise<string>;
  onGetPreviewUrl: (path: string, mediaType: string) => Promise<string>;
}> = ({
  data,
  selectedPath,
  onSelectPath,
  onNavigateToFile,
  isFullScreen,
  onToggleFullScreen,
  onReadFile,
  onGetPreviewUrl,
}) => {
  const t = useTranslation();
  // Defaults to off (issue #70) — spine item/markup source reads more
  // naturally with each line as its own row (indentation stays legible)
  // rather than wrapped, and a reader can always switch it back on for a
  // narrower file.
  const [wrap, setWrap] = useState(false);
  const selectedFile = data.files.find((file) => file.path === selectedPath);
  const selectedClassification = selectedFile
    ? classifyInspectionFile(selectedFile.path, selectedFile.mediaType)
    : undefined;
  const specialFiles = useMemo(() => identifySpecialFiles(data), [data]);
  const knownFilePaths = useMemo(() => new Set(data.files.map((file) => file.path)), [data]);

  const sidebarRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!selectedPath) {
      return;
    }
    // Scrolls the sidebar's own already-selected entry into view — matters
    // most for a cross-reference jump (a spine/manifest link, or an
    // in-content href/src, see `onNavigateToFile`) landing on a file far
    // down a long list, where "selected" would otherwise mean nothing
    // visible actually changed. A plain sidebar click never needs this
    // (the clicked entry is already on screen), but running it
    // unconditionally on every selection change is a harmless no-op then.
    sidebarRef.current
      ?.querySelector<HTMLElement>(`[data-file-path="${CSS.escape(selectedPath)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedPath]);

  return (
    <div style={{ display: "flex", height: "100%", minHeight: 0 }}>
      <div
        ref={sidebarRef}
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
          const special = specialFiles.get(file.path);
          const specialLabel = special ? specialFileLabel(special, t) : "";
          return (
            <button
              key={file.path}
              type="button"
              data-file-path={file.path}
              onClick={() => onSelectPath(file.path)}
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
              <Tooltip content={specialLabel} relationship="label" withArrow>
                <span style={{ display: "flex" }}>
                  <FileTypeIcon category={classification.category} special={special} />
                </span>
              </Tooltip>
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
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 4,
            padding: "4px 8px",
            borderBottom: `1px solid ${CHROME_BORDER}`,
          }}
        >
          {selectedClassification?.isText && (
            <Tooltip content={wrap ? t("inspector.turnOffLineWrapping") : t("inspector.turnOnLineWrapping")} relationship="label">
              <Button
                appearance="subtle"
                size="small"
                icon={wrap ? <TextWrapRegular /> : <TextWrapOffRegular />}
                aria-label={wrap ? t("inspector.turnOffLineWrapping") : t("inspector.turnOnLineWrapping")}
                onClick={() => setWrap((value) => !value)}
              />
            </Tooltip>
          )}
          {/* Issue #95: not on by default — a reader browsing a couple of
              small files never needs it, but an author poking through a
              large minified script or a long chapter benefits from
              every extra pixel of width/height this can free up. */}
          <Tooltip content={isFullScreen ? t("inspector.exitFullScreen") : t("inspector.fullScreen")} relationship="label">
            <Button
              appearance="subtle"
              size="small"
              icon={isFullScreen ? <FullScreenMinimizeRegular /> : <FullScreenMaximizeRegular />}
              aria-label={isFullScreen ? t("inspector.exitFullScreen") : t("inspector.fullScreen")}
              onClick={onToggleFullScreen}
            />
          </Tooltip>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 12 }}>
          {!selectedFile ? (
            <Caption1 style={{ opacity: 0.6 }}>{t("inspector.selectFileToPreview")}</Caption1>
          ) : (
            <FilePreview
              key={selectedFile.path}
              path={selectedFile.path}
              size={selectedFile.size}
              manifestMediaType={selectedFile.mediaType}
              wrap={wrap}
              knownFilePaths={knownFilePaths}
              onReadFile={onReadFile}
              onGetPreviewUrl={onGetPreviewUrl}
              onNavigateToFile={onNavigateToFile}
            />
          )}
        </div>
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
  const t = useTranslation();
  const creators = data.creators.length > 0 ? data.creators : data.creator ? [data.creator] : [];

  return (
    <div style={{ overflowY: "auto", padding: 16, fontSize: 13 }}>
      <table style={{ borderCollapse: "collapse", marginBottom: 20 }}>
        <tbody>
          {fileName && (
            <tr>
              <td style={metadataRowStyle}>{t("inspector.fileName")}</td>
              <td>{fileName}</td>
            </tr>
          )}
          <tr>
            <td style={metadataRowStyle}>{t("inspector.titleLabel")}</td>
            <td>{data.title}</td>
          </tr>
          {creators.length > 0 && (
            <tr>
              <td style={metadataRowStyle}>{creators.length > 1 ? t("inspector.creators") : t("inspector.creator")}</td>
              <td>{creators.join(", ")}</td>
            </tr>
          )}
          {data.contributors.length > 0 && (
            <tr>
              <td style={metadataRowStyle}>{t("inspector.contributors")}</td>
              <td>{data.contributors.join(", ")}</td>
            </tr>
          )}
          {data.publisher && (
            <tr>
              <td style={metadataRowStyle}>{t("inspector.publisher")}</td>
              <td>{data.publisher}</td>
            </tr>
          )}
          {data.date && (
            <tr>
              <td style={metadataRowStyle}>{t("inspector.date")}</td>
              <td>{data.date}</td>
            </tr>
          )}
          {data.rights && (
            <tr>
              <td style={metadataRowStyle}>{t("inspector.rights")}</td>
              <td>{data.rights}</td>
            </tr>
          )}
          <tr>
            <td style={metadataRowStyle}>{t("inspector.language")}</td>
            <td>{data.language}</td>
          </tr>
          <tr>
            <td style={metadataRowStyle}>{t("inspector.renditionLayout")}</td>
            <td>{data.renditionLayout}</td>
          </tr>
          <tr>
            <td style={metadataRowStyle}>{t("inspector.rootFile")}</td>
            <td>{data.rootFilePath}</td>
          </tr>
          {data.identifiers.map((id, index) => (
            <tr key={index}>
              <td style={metadataRowStyle}>{id.scheme ?? t("inspector.identifier")}</td>
              <td>{id.value}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {data.subjects.length > 0 && (
        <>
          <Body1 as="p" block style={{ fontWeight: 600, margin: "0 0 6px" }}>
            {t("inspector.subjects")}
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
            {t("inspector.description")}
          </Body1>
          <Body1 as="p" block style={{ margin: "0 0 20px", whiteSpace: "pre-wrap" }}>
            {data.description}
          </Body1>
        </>
      )}

      {data.metaEntries.length > 0 && (
        <>
          <Body1 as="p" block style={{ fontWeight: 600, margin: "0 0 4px" }}>
            {t("inspector.allOpfMetaEntries", { count: data.metaEntries.length })}
          </Body1>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr style={{ textAlign: "left", opacity: 0.6 }}>
                <th style={{ fontWeight: 400, padding: "2px 12px 2px 0" }}>{t("inspector.propertyOrName")}</th>
                <th style={{ fontWeight: 400, padding: "2px 12px 2px 0" }}>{t("inspector.value")}</th>
                <th style={{ fontWeight: 400 }}>{t("inspector.refines")}</th>
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

/** A plain-looking inline link — used everywhere this panel offers "jump
 * to this archive file in the Files tab" (issue #95): the OPF link atop
 * the Spine/Manifest tabs, and each Spine row's own path. */
const FileLink: FC<{ path: string; onNavigateToFile: (path: string) => void; children: ReactNode }> = ({
  path,
  onNavigateToFile,
  children,
}) => (
  <button
    type="button"
    onClick={() => onNavigateToFile(path)}
    style={{
      background: "none",
      border: "none",
      padding: 0,
      margin: 0,
      font: "inherit",
      color: "#0f766e",
      textDecoration: "underline",
      textDecorationStyle: "dotted",
      cursor: "pointer",
    }}
  >
    {children}
  </button>
);

function renderPathTemplate(
  template: string,
  path: string,
  onNavigateToFile: (path: string) => void,
): ReactNode {
  const marker = "{path}";
  const markerIndex = template.indexOf(marker);
  if (markerIndex < 0) {
    return template;
  }
  return (
    <>
      {template.slice(0, markerIndex)}
      <FileLink path={path} onNavigateToFile={onNavigateToFile}>
        {path}
      </FileLink>
      {template.slice(markerIndex + marker.length)}
    </>
  );
}

const SpineTab: FC<{ data: EpubInspectionData; onNavigateToFile: (path: string) => void }> = ({
  data,
  onNavigateToFile,
}) => {
  const t = useTranslation();

  return (
    <div style={{ overflowY: "auto", padding: 16, fontSize: 13 }}>
      <Caption1 as="p" style={{ margin: "0 0 12px", opacity: 0.8 }}>
        {renderPathTemplate(t("inspector.spineDescription"), data.rootFilePath, onNavigateToFile)}
      </Caption1>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr style={{ textAlign: "left", opacity: 0.6 }}>
            <th style={{ fontWeight: 400, padding: "2px 12px 2px 0" }}>#</th>
            <th style={{ fontWeight: 400, padding: "2px 12px 2px 0" }}>{t("inspector.path")}</th>
            <th style={{ fontWeight: 400, padding: "2px 12px 2px 0" }}>{t("inspector.linear")}</th>
            <th style={{ fontWeight: 400, padding: "2px 12px 2px 0" }}>{t("inspector.mediaType")}</th>
            <th style={{ fontWeight: 400 }}>{t("inspector.properties")}</th>
          </tr>
        </thead>
        <tbody>
          {data.spine.map((item, index) => (
            <tr key={index}>
              <td style={{ padding: "2px 12px 2px 0" }}>{index + 1}</td>
              <td style={{ padding: "2px 12px 2px 0" }}>
                <FileLink path={item.path} onNavigateToFile={onNavigateToFile}>
                  {item.path}
                </FileLink>
              </td>
              <td style={{ padding: "2px 12px 2px 0" }}>{item.linear ? t("inspector.yes") : t("inspector.no")}</td>
              <td style={{ padding: "2px 12px 2px 0" }}>{item.mediaType}</td>
              <td>{item.properties.join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const ManifestTab: FC<{ data: EpubInspectionData; onNavigateToFile: (path: string) => void }> = ({
  data,
  onNavigateToFile,
}) => {
  const t = useTranslation();

  return (
    <div style={{ overflowY: "auto", padding: 16, fontSize: 13 }}>
      <Caption1 as="p" style={{ margin: "0 0 12px", opacity: 0.8 }}>
        {renderPathTemplate(t("inspector.manifestDescription"), data.rootFilePath, onNavigateToFile)}
      </Caption1>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr style={{ textAlign: "left", opacity: 0.6 }}>
            <th style={{ fontWeight: 400, padding: "2px 12px 2px 0" }}>{t("inspector.id")}</th>
            <th style={{ fontWeight: 400, padding: "2px 12px 2px 0" }}>{t("inspector.path")}</th>
            <th style={{ fontWeight: 400, padding: "2px 12px 2px 0" }}>{t("inspector.mediaType")}</th>
            <th style={{ fontWeight: 400 }}>{t("inspector.properties")}</th>
          </tr>
        </thead>
        <tbody>
          {data.manifest.map((item) => (
            <tr key={item.id}>
              <td style={{ padding: "2px 12px 2px 0" }}>{item.id}</td>
              <td style={{ padding: "2px 12px 2px 0" }}>
                <FileLink path={item.path} onNavigateToFile={onNavigateToFile}>
                  {item.path}
                </FileLink>
              </td>
              <td style={{ padding: "2px 12px 2px 0" }}>{item.mediaType}</td>
              <td>{item.properties.join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

type InspectorTab = "files" | "metadata" | "spine" | "manifest";

/** One entry on the "Back" history stack (issue #95) — a full snapshot
 * of which tab was showing and which file was selected, not just the
 * file path alone, so "Back" correctly returns to the Spine/Manifest
 * tab a jump *started* from, not just the previously-viewed file within
 * the Files tab. */
interface InspectorHistoryEntry {
  readonly tab: InspectorTab;
  readonly selectedFilePath: string | undefined;
}

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
 *
 * Issue #95 added cross-referencing between tabs: the Spine/Manifest
 * tabs' own OPF link, each Spine row's own path, and (inside the Files
 * tab's own markup preview) any `href`/`src` that resolves to another
 * file this same archive actually has are all clickable, jumping the
 * Files tab straight to that file — everywhere a jump can originate
 * from is tracked on a small "Back" history stack (`history` below) so
 * a reader who followed a chain of such links can retrace their steps.
 */
export const EpubInspectorPanel: FC<EpubInspectorPanelProps> = ({
  open,
  onOpenChange,
  data,
  fileName,
  onReadFile,
  onGetPreviewUrl,
}) => {
  const t = useTranslation();
  const chromeTheme = useChromeTheme();
  const [activeTab, setActiveTab] = useState<InspectorTab>("files");
  const [selectedFilePath, setSelectedFilePath] = useState<string | undefined>(undefined);
  const [history, setHistory] = useState<readonly InspectorHistoryEntry[]>([]);
  const [isFullScreen, setIsFullScreen] = useState(false);

  // Issue #95: a cross-reference jump (unlike an ordinary Files-tab
  // sidebar click, or manually switching tabs — neither pushes history,
  // both are already trivial to undo by hand) — records exactly where
  // the jump came from, then lands on `path` in the Files tab.
  function navigateToFile(path: string): void {
    setHistory((entries) => [...entries, { tab: activeTab, selectedFilePath }]);
    setSelectedFilePath(path);
    setActiveTab("files");
  }

  function goBack(): void {
    setHistory((entries) => {
      const previous = entries[entries.length - 1];
      if (!previous) {
        return entries;
      }
      setActiveTab(previous.tab);
      setSelectedFilePath(previous.selectedFilePath);
      return entries.slice(0, -1);
    });
  }

  return (
    <Dialog open={open} onOpenChange={(_event, dialogData) => onOpenChange(dialogData.open)}>
      <DialogSurface
        style={
          isFullScreen
            ? { maxWidth: "100vw", width: "100vw", height: "100vh", borderRadius: 0, background: chromeTheme.backgroundSolid }
            : { maxWidth: 900, width: "90vw", height: "80vh", background: chromeTheme.backgroundSolid }
        }
      >
        <DialogBody style={{ height: "100%" }}>
          <DialogTitle
            action={
              <div style={{ display: "flex", gap: 4 }}>
                {history.length > 0 && (
                  <Tooltip content={t("inspector.back")} relationship="label">
                    <Button
                      appearance="subtle"
                      icon={<ArrowLeftRegular />}
                      aria-label={t("inspector.back")}
                      onClick={goBack}
                    />
                  </Tooltip>
                )}
                <Tooltip content={t("inspector.closeInspector")} relationship="label">
                  <Button
                    appearance="subtle"
                    icon={<DismissRegular />}
                    onClick={() => onOpenChange(false)}
                  />
                </Tooltip>
              </div>
            }
          >
            {t("inspector.title")}
          </DialogTitle>
          <DialogContent style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            {!data ? (
              <Spinner label={t("reader.loading")} />
            ) : (
              <>
                <TabList
                  selectedValue={activeTab}
                  onTabSelect={(_event, tabData) => setActiveTab(tabData.value as InspectorTab)}
                >
                  <Tab value="files">
                    {t("inspector.filesTab")}
                    {` (${data.files.length})`}
                  </Tab>
                  <Tab value="metadata">{t("inspector.metadataTab")}</Tab>
                  <Tab value="spine">
                    {t("inspector.spineTab")}
                    {` (${data.spine.length})`}
                  </Tab>
                  <Tab value="manifest">
                    {t("inspector.manifestTab")}
                    {` (${data.manifest.length})`}
                  </Tab>
                </TabList>
                <div style={{ flex: 1, minHeight: 0, marginTop: 8 }}>
                  {activeTab === "files" && (
                    <FilesTab
                      data={data}
                      selectedPath={selectedFilePath}
                      onSelectPath={setSelectedFilePath}
                      onNavigateToFile={navigateToFile}
                      isFullScreen={isFullScreen}
                      onToggleFullScreen={() => setIsFullScreen((value) => !value)}
                      onReadFile={onReadFile}
                      onGetPreviewUrl={onGetPreviewUrl}
                    />
                  )}
                  {activeTab === "metadata" && <MetadataTab data={data} fileName={fileName} />}
                  {activeTab === "spine" && <SpineTab data={data} onNavigateToFile={navigateToFile} />}
                  {activeTab === "manifest" && <ManifestTab data={data} onNavigateToFile={navigateToFile} />}
                </div>
              </>
            )}
          </DialogContent>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
};
