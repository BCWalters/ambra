import { useEffect } from "react";
import type { FC } from "react";
import { Body1, Button, Caption1 } from "@fluentui/react-components";
import { DismissRegular, PinOffRegular, PinRegular } from "@fluentui/react-icons";
import type { NavPoint } from "@pagina/engine";
import {
  CHROME_BACKGROUND_SOLID,
  CHROME_BORDER,
  CHROME_HOVER_BACKGROUND,
  CHROME_SELECTED_BACKGROUND,
  CHROME_SHADOW,
} from "../chromeTheme.js";

interface NavTreeProps {
  items: readonly NavPoint[];
  currentPath: string | undefined;
  onSelect: (navPoint: NavPoint) => void;
  depth: number;
}

const NavTree: FC<NavTreeProps> = ({ items, currentPath, onSelect, depth }) => {
  if (items.length === 0) {
    return null;
  }

  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {items.map((item, index) => {
        const isCurrent = item.isLinked && item.path === currentPath;
        return (
          <li key={index}>
            {item.isLinked ? (
              <button
                type="button"
                onClick={() => onSelect(item)}
                aria-current={isCurrent ? "location" : undefined}
                style={{
                  display: "block",
                  width: "100%",
                  background: isCurrent ? CHROME_SELECTED_BACKGROUND : "none",
                  border: "none",
                  borderRadius: 6,
                  color: isCurrent ? "var(--colorNeutralForeground1, #1a1a1a)" : "var(--colorNeutralForeground2, #333)",
                  fontWeight: isCurrent ? 600 : 400,
                  cursor: "pointer",
                  padding: "7px 10px",
                  paddingLeft: 10 + depth * 16,
                  textAlign: "left",
                  font: "inherit",
                  lineHeight: 1.35,
                }}
                onMouseEnter={(e) => {
                  if (!isCurrent) {
                    e.currentTarget.style.background = CHROME_HOVER_BACKGROUND;
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isCurrent) {
                    e.currentTarget.style.background = "none";
                  }
                }}
              >
                {item.label}
              </button>
            ) : (
              <Caption1
                as="span"
                style={{
                  display: "block",
                  padding: "7px 10px",
                  paddingLeft: 10 + depth * 16,
                  color: "var(--colorNeutralForeground3, #666)",
                  textTransform: "uppercase",
                  letterSpacing: "0.02em",
                }}
              >
                {item.label}
              </Caption1>
            )}
            <NavTree items={item.children} currentPath={currentPath} onSelect={onSelect} depth={depth + 1} />
          </li>
        );
      })}
    </ul>
  );
};

export interface TocPanelProps {
  items: readonly NavPoint[];
  /** Archive-relative path of the currently-open spine item (see
   * `ReaderSnapshot.currentSpinePath`) — highlights whichever entry
   * points at it. */
  currentPath: string | undefined;
  onSelect: (navPoint: NavPoint) => void;
  /** Whether the panel should currently be shown at all. Always rendered
   * (never conditionally unmounted) so it can animate closed instead of
   * simply vanishing — see the `transform`/`opacity` transition below. */
  open: boolean;
  /** `true` docks the panel in the normal layout flow, pushing the
   * content pane over (like the very first version of this panel);
   * `false` (the default) makes it fly out as a translucent overlay on
   * top of the content pane instead, auto-dismissing on selection, an
   * outside click, or Escape. */
  pinned: boolean;
  onTogglePin: () => void;
  onRequestClose: () => void;
}

/** The reader's Table of Contents: by default a flyout that slides in
 * over the content pane and dismisses itself once its job is done
 * (selecting a chapter, clicking outside it, or pressing Escape) — the
 * "reference material," not a permanent part of the reading layout. A
 * reader who wants it to stay put can pin it via the header's pin
 * button, which switches it to a normal, in-flow docked panel (resizing
 * the content pane instead of overlaying it) and disables the
 * auto-dismiss behaviors.
 *
 * The entry matching `currentPath` is highlighted, so the reader always
 * has a sense of "where am I" when they open it. */
export const TocPanel: FC<TocPanelProps> = ({ items, currentPath, onSelect, open, pinned, onTogglePin, onRequestClose }) => {
  useEffect(() => {
    if (!open || pinned) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        onRequestClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, pinned, onRequestClose]);

  return (
    <>
      {!pinned && (
        <div
          aria-hidden="true"
          onClick={onRequestClose}
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 7,
            background: "rgba(15, 23, 42, 0.18)",
            opacity: open ? 1 : 0,
            pointerEvents: open ? "auto" : "none",
            transition: "opacity 260ms ease",
          }}
        />
      )}

      <nav
        aria-label="Table of contents"
        style={{
          position: pinned ? "relative" : "absolute",
          // In flyout (unpinned) mode the panel spans the full app row
          // width, which would otherwise put its own header (Contents/
          // pin/close) directly underneath the toolbar's identical top:0
          // row and out of view — starting it below the toolbar's height
          // instead keeps both fully visible and clickable at once. The
          // toolbar itself never needs this treatment: it lives inside
          // the content pane, which already starts to the right of a
          // *pinned* panel's reserved width, so the two never overlap
          // there in the first place.
          top: pinned ? 0 : 44,
          left: 0,
          bottom: pinned ? 0 : 8,
          zIndex: 8,
          width: 300,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          background: CHROME_BACKGROUND_SOLID,
          backdropFilter: pinned ? undefined : "blur(16px)",
          borderRight: `1px solid ${CHROME_BORDER}`,
          borderRadius: pinned ? 0 : "0 12px 12px 0",
          boxShadow: pinned ? "none" : CHROME_SHADOW,
          transform: pinned ? "none" : `translateX(${open ? "0" : "-100%"})`,
          opacity: pinned || open ? 1 : 0,
          pointerEvents: pinned || open ? "auto" : "none",
          visibility: pinned || open ? "visible" : "hidden",
          transition: "transform 280ms cubic-bezier(0.4, 0, 0.2, 1), opacity 200ms ease, visibility 280ms",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: "10px 8px 10px 14px",
            borderBottom: `1px solid ${CHROME_BORDER}`,
          }}
        >
          <Body1 as="span" style={{ flex: 1, fontWeight: 600 }}>
            Contents
          </Body1>
          <Button
            appearance="subtle"
            size="small"
            icon={pinned ? <PinOffRegular /> : <PinRegular />}
            aria-label={pinned ? "Unpin contents panel" : "Pin contents panel"}
            title={pinned ? "Unpin" : "Pin open"}
            onClick={onTogglePin}
          />
          {!pinned && (
            <Button
              appearance="subtle"
              size="small"
              icon={<DismissRegular />}
              aria-label="Close contents panel"
              onClick={onRequestClose}
            />
          )}
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 6px" }}>
          <NavTree items={items} currentPath={currentPath} onSelect={onSelect} depth={0} />
        </div>
      </nav>
    </>
  );
};
