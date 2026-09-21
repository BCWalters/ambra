import { useRef, useState } from "react";
import type { ChangeEvent, FC } from "react";
import { Body1, Button, Spinner, Title2 } from "@fluentui/react-components";
import { useLibrary } from "./useLibrary.js";
import type { LibraryBookViewModel } from "./useLibrary.js";
import { CHROME_BORDER, CHROME_THEMES } from "../reader/chromeTheme.js";

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
  // one. Uses local hover/focus state rather than a CSS `:hover`
  // pseudo-class since the border color itself (not just its presence)
  // needs to switch per theme.
  const [isActive, setIsActive] = useState(false);

  return (
    <div
      style={{
        width: 140,
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <button
        type="button"
        onClick={onOpen}
        onMouseEnter={() => setIsActive(true)}
        onMouseLeave={() => setIsActive(false)}
        onFocus={() => setIsActive(true)}
        onBlur={() => setIsActive(false)}
        aria-label={`Open ${book.title}`}
        style={{
          width: 140,
          height: 200,
          padding: 0,
          border: `2px solid ${isActive ? accent : "var(--colorNeutralStroke1, #ccc)"}`,
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
      <Button size="small" onClick={onDelete}>
        Remove
      </Button>
    </div>
  );
};

/** Library page: a grid of imported books (cover, title, author), import
 * via file picker, delete, and "open" (launches the full-tab reader for
 * that book — see `navigation.ts`). Backed by `LibraryDatabase`
 * (IndexedDB), all local-only in v1.
 *
 * Themed with the same "Reader Theme" chosen in the reader's own
 * Settings menu (issue #86 follow-up — `useLibrary`'s `chromeTheme`,
 * read from the same shared `LibraryDatabase` preference the reader
 * itself reads on open) — this page previously had no theme awareness
 * at all, so picking any reader theme besides the default still left
 * the library reading as a second, totally undecorated app the instant
 * a reader left the book itself. Only the page background and cover
 * hover/focus accent are themed, not a full re-skin of every Fluent
 * control — enough for the choice to feel like a whole-app identity
 * without needing to fight Fluent's own default component styling. */
export const LibraryApp: FC = () => {
  const { books, isLoading, error, importFiles, removeBook, openBook, chromeTheme } = useLibrary();
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
    <div style={{ minHeight: "100vh", background: palette.backgroundSolid }}>
      <div style={{ padding: 16 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            paddingBottom: 12,
            borderBottom: `1px solid ${CHROME_BORDER}`,
          }}
        >
          <Title2 style={{ color: palette.accent }}>Ambra</Title2>
          <Button size="small" onClick={() => fileInputRef.current?.click()}>
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
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 16 }}>
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
    </div>
  );
};
