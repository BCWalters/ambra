import type { FC } from "react";
import type { NavPoint } from "@pagina/engine";

interface NavTreeProps {
  items: readonly NavPoint[];
  onSelect: (navPoint: NavPoint) => void;
}

const NavTree: FC<NavTreeProps> = ({ items, onSelect }) => {
  if (items.length === 0) {
    return null;
  }

  return (
    <ul style={{ listStyle: "none", margin: 0, paddingLeft: 12 }}>
      {items.map((item, index) => (
        <li key={index}>
          {item.isLinked ? (
            <button
              type="button"
              onClick={() => onSelect(item)}
              style={{
                background: "none",
                border: "none",
                color: "var(--colorBrandForegroundLink, #0f6cbd)",
                cursor: "pointer",
                padding: "4px 0",
                textAlign: "left",
                font: "inherit",
              }}
            >
              {item.label}
            </button>
          ) : (
            <span style={{ padding: "4px 0", display: "inline-block" }}>{item.label}</span>
          )}
          <NavTree items={item.children} onSelect={onSelect} />
        </li>
      ))}
    </ul>
  );
};

export interface TocPanelProps {
  items: readonly NavPoint[];
  onSelect: (navPoint: NavPoint) => void;
}

/** The reader's Table of Contents side panel: a simple, always-in-the-
 * layout-flow panel (not a Fluent `Drawer` overlay) toggled by the
 * toolbar's "Contents" button. Kept deliberately simple for this pass —
 * proper focus management when it opens/closes (moving focus into the
 * panel, returning it on close, trapping Tab within it) is the
 * `accessibility-layer` work item's job, not this one's. */
export const TocPanel: FC<TocPanelProps> = ({ items, onSelect }) => {
  return (
    <nav
      aria-label="Table of contents"
      style={{
        width: 260,
        flexShrink: 0,
        overflowY: "auto",
        borderRight: "1px solid var(--colorNeutralStroke1, #ccc)",
        padding: 12,
      }}
    >
      <NavTree items={items} onSelect={onSelect} />
    </nav>
  );
};
