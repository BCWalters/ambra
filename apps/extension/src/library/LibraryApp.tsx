import type { FC } from "react";
import { Title2, Body1 } from "@fluentui/react-components";

/**
 * Library popup/page: book grid, import, "continue reading." See the
 * `library-storage` work item for IndexedDB-backed data, and
 * `reader-shell-ui` for the toolbar this launches into.
 */
export const LibraryApp: FC = () => {
  return (
    <div style={{ padding: 16 }}>
      <Title2>Pagina</Title2>
      <Body1 as="p">Your library will appear here.</Body1>
    </div>
  );
};
