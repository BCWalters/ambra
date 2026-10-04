import { useLayoutEffect, useState } from "react";
import type { RefObject } from "react";
import { useTranslation } from "../../i18n/LocaleContext.js";
import { ErrorDetails } from "../../components/ErrorDetails.js";
import type { InspectorPageMarker } from "../InspectorPageBoundaries.js";
import { sourceTextRange } from "./inspectorSourceSelection.js";

export function scrollInspectorPageMarker(pre: HTMLPreElement, offset: number): void {
  const marker = Array.from(pre.querySelectorAll<HTMLElement>("[data-page-boundary]"))
    .find(element => Number(element.dataset.sourceOffset) === offset);
  const viewport = pre.closest<HTMLElement>("[data-inspector-source-viewport]");
  if (!marker || !viewport) return;
  marker.scrollIntoView({ block: "start", inline: "center", behavior: "instant" });
}

export function InspectorPageMarkers({ preRef, markers }: {
  preRef: RefObject<HTMLPreElement | null>;
  markers: readonly InspectorPageMarker[];
}) {
  const t = useTranslation();
  const [error, setError] = useState<string>();
  useLayoutEffect(() => {
    const pre = preRef.current;
    if (!pre) return;
    const nodes: HTMLElement[] = [];
    const cleanup = () => {
      for (const node of nodes) node.remove();
      pre.normalize();
    };
    setError(undefined);
    // Generated labels reserve inline space but are not part of source text or copy offsets.
    for (const marker of [...markers].reverse().sort((a, b) => b.offset - a.offset)) {
      const range = sourceTextRange(pre, marker.offset, marker.offset);
      if (!range) {
        cleanup();
        setError(t("inspector.pageBoundariesError"));
        return;
      }
      const node = pre.ownerDocument.createElement("span");
      const label = marker.page.pageNumber === undefined
        ? t(marker.edge === "start" ? "inspector.pageStartUnnumbered" : "inspector.pageEndUnnumbered")
        : t(marker.edge === "start" ? "inspector.pageStart" : "inspector.pageEnd",
          { page: marker.page.pageNumber });
      node.className = "ambra-inspector-page-marker";
      node.dataset.pageBoundary = marker.edge;
      node.dataset.pageIndex = String(marker.page.pageIndex);
      node.dataset.sourceOffset = String(marker.offset);
      node.dataset.label = label;
      node.setAttribute("role", "note");
      node.setAttribute("aria-label", label);
      range.insertNode(node);
      nodes.push(node);
    }
    return cleanup;
  }, [preRef, markers, t]);
  return (
    <>
    {error && <ErrorDetails role="alert">{error}</ErrorDetails>}
    <style>{`
      .ambra-inspector-page-marker { color: #195b99; user-select: none; }
      .ambra-inspector-page-marker[data-page-boundary="end"] { color: #8a4700; }
      .ambra-inspector-page-marker::before {
        content: attr(data-label);
        display: inline-block;
        padding: 0 4px;
        margin: 0 3px;
        border: 1px solid currentColor;
        border-radius: 3px;
        background: #fff;
        font: 11px/1.5 ui-monospace, Menlo, Consolas, monospace;
        white-space: nowrap;
        vertical-align: baseline;
      }
    `}</style>
    </>
  );
}
