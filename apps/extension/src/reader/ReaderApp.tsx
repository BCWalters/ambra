import type { FC } from "react";
import { EpubInspector } from "./EpubInspector.js";

/**
 * Reader page shell. Currently renders `EpubInspector`, a temporary
 * developer tool for exercising the engine end-to-end while the real
 * reading surface (`pagination-engine`, `reader-shell-ui`, etc.) is built
 * out. See those work items for what will replace it.
 */
export const ReaderApp: FC = () => {
  return <EpubInspector />;
};
