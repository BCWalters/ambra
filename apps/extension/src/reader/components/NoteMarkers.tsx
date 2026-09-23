import type { FC } from "react";
import { Tooltip } from "@fluentui/react-components";
import { NoteFilled } from "@fluentui/react-icons";
import type { NoteMarkerState } from "../ReaderTypes.js";
import { CHROME_BORDER, CHROME_SHADOW } from "../chromeTheme.js";
import { useChromeTheme } from "../ChromeThemeContext.js";
import { useTranslation } from "../../i18n/LocaleContext.js";

export interface NoteMarkersProps {
  markers: readonly NoteMarkerState[];
  onSelect: (id: string) => void;
}

/**
 * A small round badge over every highlight that has a note attached
 * (issue #99) — otherwise a highlight with a note looks identical to
 * one without, with no way to tell "there's more here" short of
 * tapping every highlight on the page in turn to check. Purely a
 * visual indicator plus a convenience click target (tapping the badge
 * opens the exact same `HighlightActionPopup` tapping the highlighted
 * text itself already does — see `ReaderController.openHighlightPopup`)
 * rather than a second, competing way to interact with the highlight.
 *
 * Positioned the same way `SelectionToolbar`/`HighlightActionPopup`
 * already are — `position: fixed` at parent-viewport coordinates
 * `ReaderController.updateNoteMarkers` computes by combining the
 * highlight's own `Range` rect with the content iframe's position,
 * since a `Range` inside a cross-document iframe has no meaningful
 * coordinates in the parent document on its own.
 */
export const NoteMarkers: FC<NoteMarkersProps> = ({ markers, onSelect }) => {
  const chromeTheme = useChromeTheme();
  const t = useTranslation();

  return (
    <>
      {markers.map((marker) => (
        <Tooltip key={marker.id} content={t("highlight.hasNote")} relationship="label">
          <button
            type="button"
            onClick={() => onSelect(marker.id)}
            style={{
              position: "fixed",
              left: marker.left,
              top: marker.top,
              transform: "translate(-50%, -50%)",
              zIndex: 6,
              width: 18,
              height: 18,
              borderRadius: "50%",
              border: `1px solid ${CHROME_BORDER}`,
              boxShadow: CHROME_SHADOW,
              background: chromeTheme.backgroundSolid,
              color: chromeTheme.accent,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
              cursor: "pointer",
            }}
          >
            <NoteFilled style={{ fontSize: 11 }} />
          </button>
        </Tooltip>
      ))}
    </>
  );
};
