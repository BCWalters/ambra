import { useCallback, useEffect, useRef, useState } from "react";
import { LibraryDatabase } from "../library/LibraryDatabase.js";

/** Independent of pagination totals: only a successfully opened book can offer the welcome. */
export function useReadingWelcome(successful: boolean, available: boolean, onOpen: () => void) {
  const database = useRef<LibraryDatabase | undefined>(undefined);
  const offered = useRef(false);
  const [needed, setNeeded] = useState(false);

  useEffect(() => {
    if (!successful) return;
    let cancelled = false;
    let db: LibraryDatabase | undefined;
    void LibraryDatabase.open().then(async opened => {
      db = opened;
      if (cancelled) { opened.close(); return; }
      database.current = opened;
      const version = await opened.getReadingWelcomeVersion();
      if (!cancelled) setNeeded(version < 1);
    }).catch(error => {
      // Help remains available manually; a storage failure must never block reading.
      console.warn("Could not load reading welcome preference.", error);
    });
    return () => {
      cancelled = true;
      if (database.current === db) database.current = undefined;
      db?.close();
    };
  }, [successful]);

  useEffect(() => {
    if (!successful || !available || !needed || offered.current) return;
    offered.current = true;
    onOpen();
  }, [successful, available, needed, onOpen]);

  const acknowledge = useCallback(async () => {
    offered.current = true;
    setNeeded(false);
    try {
      await database.current?.acknowledgeReadingWelcome();
    } catch (error) {
      console.warn("Could not save reading welcome preference.", error);
    }
  }, []);

  return { acknowledge };
}
