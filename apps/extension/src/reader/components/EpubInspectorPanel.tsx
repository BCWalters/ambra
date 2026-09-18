import { useEffect, useState } from "react";
import type { FC } from "react";
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
import { DismissRegular } from "@fluentui/react-icons";
import type { EpubInspectionData } from "../ReaderController.js";
import { CHROME_BORDER } from "../chromeTheme.js";

export interface EpubInspectorPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `undefined` until `ReaderApp` fetches it the first time this opens
   * (see `ReaderController.getEpubInspectionData`) — cheap/synchronous
   * once loaded, so unlike `BookDetails` this never needs to be
   * re-fetched on a later open. */
  data: EpubInspectionData | undefined;
  /** Reads one archive file's raw text on demand — see
   * `ReaderController.readInspectionFileText`. Not pre-loaded for every
   * file up front (a book can have hundreds of resources). */
  onReadFile: (path: string) => Promise<string>;
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

const FilesTab: FC<{ data: EpubInspectionData; onReadFile: (path: string) => Promise<string> }> = ({
  data,
  onReadFile,
}) => {
  const [selectedPath, setSelectedPath] = useState<string | undefined>(undefined);
  const [fileText, setFileText] = useState<string | undefined>(undefined);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [readError, setReadError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!selectedPath) {
      setFileText(undefined);
      return;
    }
    let cancelled = false;
    setIsLoadingFile(true);
    setReadError(undefined);
    onReadFile(selectedPath)
      .then((text) => {
        if (!cancelled) {
          setFileText(text);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setReadError("Couldn't read this file as text (it may be binary, e.g. an image or font).");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingFile(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPath, onReadFile]);

  return (
    <div style={{ display: "flex", height: "100%", minHeight: 0 }}>
      <div
        style={{
          width: 280,
          flexShrink: 0,
          overflowY: "auto",
          borderRight: `1px solid ${CHROME_BORDER}`,
          padding: "4px 0",
        }}
      >
        {data.files.map((file) => (
          <button
            key={file.path}
            type="button"
            onClick={() => setSelectedPath(file.path)}
            style={{
              display: "flex",
              justifyContent: "space-between",
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
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {file.path}
            </span>
            <Caption1 as="span" style={{ flexShrink: 0, opacity: 0.6 }}>
              {formatSize(file.size)}
            </Caption1>
          </button>
        ))}
      </div>
      <div style={{ flex: 1, minWidth: 0, overflow: "auto", padding: 12 }}>
        {!selectedPath ? (
          <Caption1 style={{ opacity: 0.6 }}>Select a file to view its raw contents.</Caption1>
        ) : isLoadingFile ? (
          <Spinner label="Loading…" />
        ) : readError ? (
          <Caption1 style={{ opacity: 0.6 }}>{readError}</Caption1>
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
            {fileText}
          </pre>
        )}
      </div>
    </div>
  );
};

const MetadataTab: FC<{ data: EpubInspectionData }> = ({ data }) => {
  return (
    <div style={{ overflowY: "auto", padding: 16, fontSize: 13 }}>
      <table style={{ borderCollapse: "collapse", marginBottom: 20 }}>
        <tbody>
          <tr>
            <td style={{ padding: "2px 12px 2px 0", opacity: 0.6 }}>Title</td>
            <td>{data.title}</td>
          </tr>
          {data.creator && (
            <tr>
              <td style={{ padding: "2px 12px 2px 0", opacity: 0.6 }}>Creator</td>
              <td>{data.creator}</td>
            </tr>
          )}
          {data.publisher && (
            <tr>
              <td style={{ padding: "2px 12px 2px 0", opacity: 0.6 }}>Publisher</td>
              <td>{data.publisher}</td>
            </tr>
          )}
          <tr>
            <td style={{ padding: "2px 12px 2px 0", opacity: 0.6 }}>Language</td>
            <td>{data.language}</td>
          </tr>
          <tr>
            <td style={{ padding: "2px 12px 2px 0", opacity: 0.6 }}>Rendition layout</td>
            <td>{data.renditionLayout}</td>
          </tr>
          <tr>
            <td style={{ padding: "2px 12px 2px 0", opacity: 0.6 }}>Root file</td>
            <td>{data.rootFilePath}</td>
          </tr>
          {data.identifiers.map((id, index) => (
            <tr key={index}>
              <td style={{ padding: "2px 12px 2px 0", opacity: 0.6 }}>{id.scheme ?? "Identifier"}</td>
              <td>{id.value}</td>
            </tr>
          ))}
        </tbody>
      </table>

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

      <Body1 as="p" block style={{ fontWeight: 600, margin: "0 0 4px" }}>
        Spine ({data.spine.length} item{data.spine.length === 1 ? "" : "s"})
      </Body1>
      <table style={{ borderCollapse: "collapse", marginBottom: 20, width: "100%" }}>
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

      <Body1 as="p" block style={{ fontWeight: 600, margin: "0 0 4px" }}>
        Manifest ({data.manifest.length} item{data.manifest.length === 1 ? "" : "s"})
      </Body1>
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
};

/**
 * An EPUB-author-facing tool (issue #46), reachable only via a button
 * tucked into the Book Details panel — deliberately not given its own
 * toolbar button, so an ordinary reader never notices it exists. Shows
 * the book's raw file structure (every entry in the underlying ZIP
 * archive, with a raw-text viewer for whichever one is selected) and a
 * parsed view of its metadata/manifest/spine. "Validate EPUB"/"check
 * accessibility"-style actions are explicitly out of scope for this
 * pass, per the issue — this is purely a read-only inspection view for
 * now.
 */
export const EpubInspectorPanel: FC<EpubInspectorPanelProps> = ({ open, onOpenChange, data, onReadFile }) => {
  const [activeTab, setActiveTab] = useState<"files" | "metadata">("files");

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
                  onTabSelect={(_event, tabData) => setActiveTab(tabData.value as "files" | "metadata")}
                >
                  <Tab value="files">Files ({data.files.length})</Tab>
                  <Tab value="metadata">Metadata</Tab>
                </TabList>
                <div style={{ flex: 1, minHeight: 0, marginTop: 8 }}>
                  {activeTab === "files" ? (
                    <FilesTab data={data} onReadFile={onReadFile} />
                  ) : (
                    <MetadataTab data={data} />
                  )}
                </div>
              </>
            )}
          </DialogContent>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
};
