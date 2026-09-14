import { useState } from "react";
import type { FC } from "react";
import { Title2, Body1 } from "@fluentui/react-components";
import { Locator } from "@pagina/engine";

/**
 * Reader page shell: hosts the toolbar/TOC panel (React + Fluent) wrapping
 * the vanilla-TS reading surface from `@pagina/engine`. See the
 * `reader-shell-ui`, `pagination-engine`, and `scroll-view-mode` work
 * items — this component currently only reads which book to open.
 */
export const ReaderApp: FC = () => {
  const bookId = new URLSearchParams(window.location.search).get("bookId");
  // TODO(resume-reading): replace with the persisted Locator for this book.
  const [currentLocator] = useState<Locator | null>(null);

  return (
    <div style={{ padding: 16 }}>
      <Title2>Pagina Reader</Title2>
      <Body1 as="p">{bookId ? `Opening book: ${bookId}` : "No book selected."}</Body1>
      <Body1 as="p">
        Position: {currentLocator ? currentLocator.toString() : "(start of book)"}
      </Body1>
    </div>
  );
};
