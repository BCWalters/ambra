import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { FC } from "react";
import { Button, Spinner } from "@fluentui/react-components";
import { DismissRegular, ZoomInRegular, ZoomOutRegular } from "@fluentui/react-icons";
import { makeOverflowingPreElementsFocusable, SandboxedContentHost } from "@ambra/engine";
import { useTranslation } from "../../i18n/LocaleContext.js";
import type { PreparedTable } from "../TableViewerContent.js";
import { useChromeTheme } from "../ChromeThemeContext.js";

export interface TableViewerProps {
  table: PreparedTable | undefined;
  onRequestClose: () => void;
  onError: (error: unknown) => void;
}

export const TableViewer: FC<TableViewerProps> = props =>
  props.table ? <OpenTableViewer key={props.table.xhtml} {...props} table={props.table} /> : null;

const OpenTableViewer: FC<TableViewerProps & { table: PreparedTable }> = ({
  table, onRequestClose, onError,
}) => {
  const t = useTranslation();
  const chromeTheme = useChromeTheme();
  const dialog = useRef<HTMLDivElement>(null);
  const mount = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const reset = useRef<HTMLButtonElement>(null);
  const host = useRef<SandboxedContentHost | undefined>(undefined);
  const [scale, setScale] = useState(1);
  const scaleRef = useRef(1);
  const [failure, setFailure] = useState(false);
  const [resourcesUnavailable, setResourcesUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [contentHeight, setContentHeight] = useState<number>();
  const [contentWidth, setContentWidth] = useState<number>();
  const [inlineOffset, setInlineOffset] = useState(0);
  const measureContent = useRef<(() => void) | undefined>(undefined);
  const description = useId();
  const title = t("tableViewer.dialogAriaLabel");

  useLayoutEffect(() => {
    // Tabster's modalizer moves focus before our cross-document key handler.
    // Own this dialog's scope instead: inert sibling subtrees, then restore
    // their original attributes on close. Publication documents stay untouched.
    const outside: Array<{ element: HTMLElement; inert: boolean; hidden: string | null }> = [];
    for (let branch: Element | null = dialog.current; branch?.parentElement && branch !== document.body;
      branch = branch.parentElement) {
      for (const sibling of Array.from(branch.parentElement.children)) {
        if (sibling === branch || !(sibling instanceof HTMLElement)) continue;
        outside.push({ element: sibling, inert: sibling.inert, hidden: sibling.getAttribute("aria-hidden") });
        sibling.inert = true;
        sibling.setAttribute("aria-hidden", "true");
      }
    }
    close.current?.focus();
    const surface = new SandboxedContentHost();
    host.current = surface;
    surface.element.title = title;
    surface.element.setAttribute("data-ambra-table-viewer", "");
    surface.element.tabIndex = -1;
    surface.element.style.pointerEvents = "none";
    surface.element.style.visibility = "hidden";
    mount.current!.append(surface.element);
    let disposed = false;
    let ready = false;
    let resourceErrorReported = false;
    const resourceFailure = (): void => {
      if (disposed || resourceErrorReported) return;
      resourceErrorReported = true;
      setResourcesUnavailable(true);
      onError(new Error("Some table resources could not be loaded."));
    };
    let removeFrameListeners: (() => void) | undefined;
    const frameControls = (): HTMLElement[] => {
      const doc = surface.element.contentDocument;
      if (!doc) return [];
      makeOverflowingPreElementsFocusable(doc);
      return Array.from(doc.querySelectorAll<HTMLElement>("summary, pre[tabindex='0']"))
        .filter(element => element.getClientRects().length > 0 &&
          (element.localName !== "pre" || element.scrollWidth > element.clientWidth));
    };
    const enterFrame = (reverse: boolean): void => {
      // The iframe element is the parent document's actual tab stop.
      surface.element.focus();
      const controls = frameControls();
      const target = reverse ? controls.at(-1) : controls[0];
      if (target) target.focus();
    };
    const keyboard = (event: KeyboardEvent, inFrame = false): void => {
      // Native browser zoom and other modified shortcuts remain native.
      if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onRequestClose();
      } else if (["+", "=", "-", "0"].includes(event.key)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setScale(previous => event.key === "0" ? 1 :
          Math.max(0.25, Math.min(4, previous + (event.key === "-" ? -0.25 : 0.25))));
      } else if (event.key === "Tab") {
        // A Fluent trap cannot see focus inside the publication frame.
        if (inFrame) {
          event.preventDefault();
          event.stopImmediatePropagation();
          const controls = frameControls();
          const active = surface.element.contentDocument?.activeElement;
          const index = controls.indexOf(active as HTMLElement);
          const next = index + (event.shiftKey ? -1 : 1);
          if (next >= 0 && next < controls.length) controls[next]?.focus();
          else (event.shiftKey ? reset.current : close.current)?.focus();
        } else {
          event.preventDefault();
          event.stopImmediatePropagation();
          const controls = Array.from(dialog.current!.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
          const index = controls.indexOf(document.activeElement as HTMLButtonElement);
          const next = index + (event.shiftKey ? -1 : 1);
          if (next < 0 || next >= controls.length) {
            if (ready) enterFrame(event.shiftKey);
            else controls[event.shiftKey ? controls.length - 1 : 0]?.focus();
          }
          else controls[next]?.focus();
        }
      }
    };
    const frameKeyboard = (event: KeyboardEvent): void => keyboard(event, true);
    const containFocus = (event: FocusEvent): void => {
      if (!dialog.current?.contains(event.target as Node)) close.current?.focus();
    };
    // Events in the viewer iframe are handled separately below.
    window.addEventListener("keydown", keyboard, true);
    document.addEventListener("focusin", containFocus);
    void surface.render(table.xhtml).then(() => {
      if (disposed) return;
      const doc = surface.element.contentDocument;
      if (!doc?.body || doc.querySelector("parsererror")) throw new Error("Failed to parse table content.");
      ready = true;
      surface.element.tabIndex = 0;
      surface.element.style.pointerEvents = "";
      surface.element.style.visibility = "";
      setLoading(false);
      doc.body.style.setProperty("zoom", String(scaleRef.current), "important");
      const content = doc.querySelector("table");
      const measure = (): void => {
        if (!content || disposed) return;
        const bounds = content.getBoundingClientRect();
        const horizontalScrollbar = (doc.defaultView?.innerHeight ?? 0) - doc.documentElement.clientHeight;
        // Reserve classic scrollbar width outside the table. When it fits,
        // offset the surface by half that width to center the table, not the bar.
        const verticalScrollbar = (doc.defaultView?.innerWidth ?? 0) - doc.documentElement.clientWidth;
        const width = Math.ceil(bounds.width + verticalScrollbar);
        const direction = doc.defaultView?.getComputedStyle(doc.documentElement).direction === "rtl" ? -1 : 1;
        setInlineOffset(width <= (dialog.current?.clientWidth ?? 0) * 0.9 ? direction * verticalScrollbar / 2 : 0);
        setContentWidth(width);
        setContentHeight(Math.ceil(bounds.height + Math.max(0, bounds.top + (doc.defaultView?.scrollY ?? 0)) + horizontalScrollbar));
      };
      measureContent.current = measure;
      const resize = new ResizeObserver(measure);
      if (content) resize.observe(content);
      resize.observe(doc.documentElement);
      measure();
      const preventNavigation = (event: Event): void => {
        const element = event.target as Element | null;
        if (element?.closest?.("a, area")) event.preventDefault();
      };
      const preventSubmit = (event: Event): void => event.preventDefault();
      doc.addEventListener("keydown", frameKeyboard, true);
      doc.addEventListener("click", preventNavigation);
      doc.addEventListener("submit", preventSubmit);
      doc.addEventListener("error", resourceFailure, true);
      doc.addEventListener("securitypolicyviolation", resourceFailure);
      doc.fonts?.addEventListener("loadingerror", resourceFailure);
      if (table.unavailableResources ||
        Array.from(doc.images).some(image => image.complete && !image.naturalWidth) ||
        Array.from(doc.querySelectorAll<HTMLLinkElement>("link[rel~='stylesheet'][href]"))
          .some(link => !link.disabled && !link.hasAttribute("disabled") &&
            (!link.media || doc.defaultView?.matchMedia(link.media).matches) && !link.sheet)) {
        resourceFailure();
      }
      removeFrameListeners = () => {
        resize.disconnect();
        measureContent.current = undefined;
        doc.removeEventListener("keydown", frameKeyboard, true);
        doc.removeEventListener("click", preventNavigation);
        doc.removeEventListener("submit", preventSubmit);
        doc.removeEventListener("error", resourceFailure, true);
        doc.removeEventListener("securitypolicyviolation", resourceFailure);
        doc.fonts?.removeEventListener("loadingerror", resourceFailure);
      };
    }).catch(error => {
      if (disposed) return;
      setLoading(false);
      setFailure(true);
      onError(error);
    });
    return () => {
      disposed = true;
      window.removeEventListener("keydown", keyboard, true);
      document.removeEventListener("focusin", containFocus);
      removeFrameListeners?.();
      host.current = undefined;
      surface.dispose();
      for (const { element, inert, hidden } of outside) {
        element.inert = inert;
        if (hidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", hidden);
      }
    };
  }, [table, title, onRequestClose, onError]);

  useEffect(() => {
    scaleRef.current = scale;
    host.current?.element.contentDocument?.body?.style.setProperty("zoom", String(scale), "important");
    measureContent.current?.();
  }, [scale]);

  return (
    <div ref={dialog} role="dialog" aria-modal="true"
      data-tabster='{"uncontrolled":{"completely":true}}'
      aria-label={title} aria-describedby={description} aria-busy={loading}
      onClick={event => { if (event.target === event.currentTarget) onRequestClose(); }}
      style={{ position: "absolute", inset: 0, zIndex: 20, display: "grid",
        gridTemplateRows: "64px minmax(0, 1fr) auto", paddingBottom: 16, boxSizing: "border-box",
        minWidth: 0, overflow: "hidden", background: "rgba(10, 8, 6, 0.82)" }}>
      <Button ref={close} appearance="secondary" size="large" icon={<DismissRegular />}
        aria-label={t("highlight.close")} onClick={onRequestClose}
        style={{ position: "absolute", top: 16, right: 16 }} />
      <div onClick={event => { if (event.target === event.currentTarget) onRequestClose(); }}
        style={{ gridRow: 2, minHeight: 0, minWidth: 0, marginBottom: 16,
          display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div data-ambra-table-surface=""
          style={{ width: contentWidth === undefined ? "90%" : Math.max(1, contentWidth),
            height: contentHeight === undefined ? "100%" : Math.max(1, contentHeight),
            maxWidth: "90%", maxHeight: "100%", minHeight: 0, position: "relative", overflow: "hidden",
            transform: `translateX(${inlineOffset}px)`,
            background: "#fff", borderRadius: 4, boxShadow: "0 8px 40px rgba(0, 0, 0, 0.5)" }}>
          <div ref={mount} style={{ width: "100%", height: "100%" }} />
          {loading && <Spinner label={t("reader.loading")} style={{ position: "absolute", inset: 0,
            background: chromeTheme.surface, color: chromeTheme.text }} />}
        </div>
      </div>
      <div style={{ gridRow: 3, justifySelf: "center", maxWidth: "calc(100% - 16px)",
        background: chromeTheme.surface, color: chromeTheme.text, borderRadius: 12 }}>
      {failure && <p role="alert">{t("tableViewer.error")}</p>}
      {resourcesUnavailable && <p role="alert">{t("tableViewer.resourcesUnavailable")}</p>}
      <div role="group" aria-label={t("tableViewer.controls")}
        style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", justifyContent: "center",
          padding: 8, borderRadius: 12, background: chromeTheme.surface,
          boxShadow: chromeTheme.shadow }}>
        <Button appearance="transparent" icon={<ZoomOutRegular />} aria-label={t("imageViewer.zoomOut")}
          disabled={scale <= 0.25} style={{ color: "inherit", opacity: scale <= 0.25 ? 0.4 : 1 }}
          onClick={() => setScale(value => Math.max(0.25, value - 0.25))} />
        <output aria-live="polite" style={{ minWidth: 48, textAlign: "center" }}>{Math.round(scale * 100)}%</output>
        <Button appearance="transparent" icon={<ZoomInRegular />} aria-label={t("imageViewer.zoomIn")}
          disabled={scale >= 4} style={{ color: "inherit", opacity: scale >= 4 ? 0.4 : 1 }}
          onClick={() => setScale(value => Math.min(4, value + 0.25))} />
        <Button ref={reset} appearance="transparent" style={{ color: "inherit", minWidth: 0,
          maxWidth: "100%", overflowWrap: "anywhere" }}
          onClick={() => setScale(1)}>{t("tableViewer.actualSize")}</Button>
      </div>
      </div>
      <p id={description} style={{ position: "absolute", width: 1, height: 1,
        overflow: "hidden", clipPath: "inset(50%)" }}>
        {table.caption && <span>{table.caption} — </span>}{t("tableViewer.instructions")}
      </p>
    </div>
  );
};
