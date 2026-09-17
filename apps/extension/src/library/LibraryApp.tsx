import { useRef } from "react";
import type { ChangeEvent, FC } from "react";
import { Body1, Button, Spinner, Title2 } from "@fluentui/react-components";
import { useLibrary } from "./useLibrary.js";
import type { LibraryBookViewModel } from "./useLibrary.js";

const BookCard: FC<{ book: LibraryBookViewModel; onOpen: () => void; onDelete: () => void }> = ({
  book,
  onOpen,
  onDelete,
}) => {
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
        aria-label={`Open ${book.title}`}
        style={{
          width: 140,
          height: 200,
          padding: 0,
          border: "1px solid var(--colorNeutralStroke1, #ccc)",
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
 * (IndexedDB), all local-only in v1. */
export const LibraryApp: FC = () => {
  const { books, isLoading, error, importFiles, removeBook, openBook } = useLibrary();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const files = event.target.files;
    if (!files || files.length === 0) {
      return;
    }
    void importFiles(Array.from(files));
    event.target.value = "";
  };

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Title2>Ambra</Title2>
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
        <Body1 as="p">Your library is empty — import an .epub to get started.</Body1>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 16 }}>
          {books.map((book) => (
            <BookCard
              key={book.id}
              book={book}
              onOpen={() => openBook(book.id)}
              onDelete={() => void removeBook(book.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
};
