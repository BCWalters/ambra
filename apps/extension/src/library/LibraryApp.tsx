import { useRef, useState } from "react";
import type { ChangeEvent, FC } from "react";
import {
  Body1,
  Button,
  Menu,
  MenuGroup,
  MenuGroupHeader,
  MenuItemRadio,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Spinner,
  Title2,
  Tooltip,
} from "@fluentui/react-components";
import {
  ArrowSortRegular,
  ArrowUploadRegular,
  DeleteRegular,
  StorageRegular,
  WindowNewRegular,
} from "@fluentui/react-icons";
import { useLibrary } from "./useLibrary.js";
import type { LibraryBookViewModel } from "./useLibrary.js";
import type { LibrarySortOption } from "./LibrarySortOption.js";
import { CHROME_BORDER, CHROME_SHADOW, CHROME_THEMES } from "../reader/chromeTheme.js";

const SORT_GROUP_NAME = "librarySort";

const SORT_LABELS: Readonly<Record<LibrarySortOption, string>> = {
  dateAddedDesc: "Date added (newest first)",
  dateAddedAsc: "Date added (oldest first)",
  titleAsc: "Title (A–Z)",
  authorAsc: "Author (A–Z)",
};

/** Formats a byte count as a short human-readable string (`"128 MB"`,
 * `"1.4 GB"`) for the storage-usage footer — plain binary (1024-based)
 * units, matching what Chrome's own `chrome://settings/storage`/dev
 * tools already show, rather than SI (1000-based) ones, which would
 * disagree with those by a confusing few percent for the same byte
 * count. */
function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  const precision = unitIndex === 0 || value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

const BookCard: FC<{ book: LibraryBookViewModel; accent: string; onOpen: () => void; onDelete: () => void }> = ({
  book,
  accent,
  onOpen,
  onDelete,
}) => {
  // Hovering/focusing a cover picks up the reader's own accent color
  // (issue #86 follow-up — the same idea as the TOC's current-chapter
  // border and the scrubber fill, extended here) instead of a plain
  // generic neutral highlight, so the library page reads as the same
  // themed app as the reader rather than a totally separate, undecorated
  // one, and the same state also reveals the remove button (kept hidden
  // the rest of the time, matching a reader's usual "hover to reveal a
  // destructive action" expectation rather than a permanently-visible
  // icon competing for attention on every single card).
  //
  // Hover and focus are tracked as two *separate* booleans (rather than
  // one shared flag both write to directly) and combined via `||` — a
  // real, confirmed bug with a single shared flag: clicking the remove
  // button shifts keyboard focus away from the cover (to the remove
  // button itself), firing the cover's own `onBlur` and flipping the
  // shared flag straight back to `false` mid-click — which, since the
  // remove button's visibility/`pointer-events` depend on that same
  // flag, could make it disappear (and stop accepting the pointer
  // event) between mousedown and mouseup, silently swallowing the very
  // click that was supposed to remove the book. Tracking the remove
  // button's own focus too (so focus moving *between* the cover and the
  // remove button never dips through "neither" for the combined value)
  // closes that gap.
  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const isActive = isHovered || isFocused;

  return (
    <div
      style={{
        width: 140,
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div style={{ position: "relative", width: 140, height: 200 }}>
        <button
          type="button"
          onClick={onOpen}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          aria-label={`Open ${book.title}`}
          style={{
            width: 140,
            height: 200,
            padding: 0,
            border: `2px solid ${isActive ? accent : CHROME_BORDER}`,
            borderRadius: 4,
            background: book.coverUrl
              ? `center / cover no-repeat url(${book.coverUrl})`
              : "var(--colorNeutralBackground3, #eee)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            font: "inherit",
            boxShadow: isActive ? `0 2px 10px ${accent}66` : "none",
            transition: "border-color 120ms ease, box-shadow 120ms ease",
          }}
        >
          {!book.coverUrl && <Body1 style={{ padding: 8 }}>{book.title}</Body1>}
        </button>
        {/* A themed icon-only trash can (issue: library styling should
            align with the reader's own chrome instead of a plain generic
            text button) — only ever revealed on hover/focus of this card
            (see `isActive`), a click target big enough for touch/mouse
            but unobtrusive the rest of the time. This button is a
            sibling of the cover button in the DOM, not nested inside it
            (buttons can't nest), so a click here never reaches `onOpen`
            at all. */}
        <Tooltip content={`Remove ${book.title} from library`} relationship="label">
          <Button
            appearance="secondary"
            size="small"
            icon={<DeleteRegular />}
            onClick={onDelete}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            aria-label={`Remove ${book.title} from library`}
            style={{
              position: "absolute",
              top: 6,
              right: 6,
              minWidth: 0,
              width: 28,
              height: 28,
              padding: 0,
              borderRadius: "50%",
              border: `1px solid ${CHROME_BORDER}`,
              boxShadow: CHROME_SHADOW,
              opacity: isActive ? 1 : 0,
              pointerEvents: isActive ? "auto" : "none",
              transition: "opacity 120ms ease",
            }}
          />
        </Tooltip>
      </div>
      <Body1
        as="p"
        style={{ margin: 0, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
      >
        {book.title}
      </Body1>
      {book.creator && (
        <Body1 as="p" style={{ margin: 0, color: "var(--colorNeutralForeground3, #666)" }}>
          {book.creator}
        </Body1>
      )}
    </div>
  );
};

/** Library page: a grid of imported books (cover, title, author), import
 * via file picker, delete, sort, and "open" (launches the full-tab
 * reader for that book — see `navigation.ts`). Backed by
 * `LibraryDatabase` (IndexedDB), all local-only in v1.
 *
 * Also the extension's own toolbar popup (`manifest.json`'s
 * `default_popup`) — small and fixed-size there, which is fine for a
 * handful of books but cramped for a real library, so this same page
 * can also open as its own full browser tab (`openInFullTab`/
 * `isFullTab`, see `navigation.ts`'s `openLibraryTab`).
 *
 * Themed with the same "Reader Theme" chosen in the reader's own
 * Settings menu (issue #86 follow-up — `useLibrary`'s `chromeTheme`,
 * read from the same shared `LibraryDatabase` preference the reader
 * itself reads on open) — this page previously had no theme awareness
 * at all, so picking any reader theme besides the default still left
 * the library reading as a second, totally undecorated app the instant
 * a reader left the book itself. The page background, cover hover/focus
 * accent, and every action button now share the reader chrome's own
 * visual language (`CHROME_BORDER`/`CHROME_SHADOW`, the same subtle-
 * icon-button-with-tooltip idiom the toolbar uses) rather than a full
 * re-skin of every Fluent control — enough for the choice to feel like
 * a whole-app identity without needing to fight Fluent's own default
 * component styling. */
export const LibraryApp: FC = () => {
  const {
    books,
    isLoading,
    error,
    importFiles,
    removeBook,
    openBook,
    chromeTheme,
    sort,
    setSort,
    isFullTab,
    openInFullTab,
    storageUsage,
  } = useLibrary();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const palette = CHROME_THEMES[chromeTheme];

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const files = event.target.files;
    if (!files || files.length === 0) {
      return;
    }
    void importFiles(Array.from(files));
    event.target.value = "";
  };

  return (
    <div style={{ minHeight: "100vh", background: palette.backgroundSolid, display: "flex", flexDirection: "column" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 16px",
          borderBottom: `1px solid ${CHROME_BORDER}`,
          boxShadow: CHROME_SHADOW,
        }}
      >
        <Title2 style={{ color: palette.accent }}>Ambra</Title2>
        <div style={{ flex: 1 }} />

        <Menu
          checkedValues={{ [SORT_GROUP_NAME]: [sort] }}
          onCheckedValueChange={(_event, data) => {
            if (data.name === SORT_GROUP_NAME) {
              setSort(data.checkedItems[0] as LibrarySortOption);
            }
          }}
        >
          <MenuTrigger disableButtonEnhancement>
            <Tooltip content="Sort library" relationship="label">
              <Button appearance="subtle" size="small" icon={<ArrowSortRegular />} aria-label="Sort library" />
            </Tooltip>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              <MenuGroup>
                <MenuGroupHeader>Sort by</MenuGroupHeader>
                {(Object.keys(SORT_LABELS) as LibrarySortOption[]).map((option) => (
                  <MenuItemRadio key={option} name={SORT_GROUP_NAME} value={option}>
                    {SORT_LABELS[option]}
                  </MenuItemRadio>
                ))}
              </MenuGroup>
            </MenuList>
          </MenuPopover>
        </Menu>

        {!isFullTab && (
          <Tooltip content="Expand library into a full browser tab" relationship="label">
            <Button
              appearance="subtle"
              size="small"
              icon={<WindowNewRegular />}
              onClick={openInFullTab}
              aria-label="Expand library into a full browser tab"
            />
          </Tooltip>
        )}

        <Button
          appearance="primary"
          size="small"
          icon={<ArrowUploadRegular />}
          onClick={() => fileInputRef.current?.click()}
        >
          Import EPUB
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".epub"
          multiple
          style={{ display: "none" }}
          onChange={handleFileChange}
        />
      </div>

      <div style={{ padding: 16, flex: 1 }}>
        {error && (
          <Body1 as="p" style={{ color: "var(--colorPaletteRedForeground1, crimson)" }}>
            Error: {error}
          </Body1>
        )}

        {isLoading ? (
          <Spinner label="Loading your library…" style={{ marginTop: 16 }} />
        ) : books.length === 0 ? (
          <Body1 as="p" style={{ marginTop: 16 }}>
            Your library is empty — import an .epub to get started.
          </Body1>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
            {books.map((book) => (
              <BookCard
                key={book.id}
                book={book}
                accent={palette.accent}
                onOpen={() => openBook(book.id)}
                onDelete={() => void removeBook(book.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Purely informational (see `LibraryDatabase.estimateStorageUsage`'s
          doc comment on why this is never an enforced limit) — lets a
          reader with a very large library at least see roughly how much
          disk their book collection is using, the same way Chrome's own
          storage settings page would show it. */}
      {storageUsage && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 16px",
            borderTop: `1px solid ${CHROME_BORDER}`,
            color: "var(--colorNeutralForeground3, #666)",
            fontSize: 12,
          }}
        >
          <StorageRegular fontSize={14} />
          <span>
            {books.length} {books.length === 1 ? "book" : "books"} · {formatBytes(storageUsage.usageBytes)} used
            {storageUsage.quotaBytes !== undefined ? ` of ${formatBytes(storageUsage.quotaBytes)} available` : ""}
          </span>
        </div>
      )}
    </div>
  );
};
