import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { LibraryDatabase } from "../library/LibraryDatabase.js";
import {
  DEFAULT_SHORTCUT_PREFERENCES, DISABLED_SHORTCUT_PREFERENCES, getShortcutPlatform, parseShortcutPreferences,
} from "./ReaderCommands.js";
import type { ShortcutPlatform, ShortcutPreferences } from "./ReaderCommands.js";

interface ShortcutPreferencesContextValue {
  preferences: ShortcutPreferences;
  platform: ShortcutPlatform;
  ready: boolean;
  error: string | undefined;
  setPreferences: (next: ShortcutPreferences) => Promise<void>;
}
const ShortcutPreferencesContext = createContext<ShortcutPreferencesContextValue>({
  preferences: DISABLED_SHORTCUT_PREFERENCES,
  platform: getShortcutPlatform(),
  ready: false,
  error: undefined,
  setPreferences: async () => { throw new Error("Keyboard shortcut settings are not ready."); },
});

export function ShortcutPreferencesProvider({ children }: { children: ReactNode }) {
  const [platform] = useState(getShortcutPlatform);
  const [preferences, setState] = useState(DISABLED_SHORTCUT_PREFERENCES);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string>();
  const database = useRef<LibraryDatabase | undefined>(undefined);
  const revision = useRef(0);
  useEffect(() => {
    let cancelled = false;
    let library: LibraryDatabase | undefined;
    let unsubscribe: (() => void) | undefined;
    const fail = (cause: unknown) => {
      if (cancelled) return;
      setReady(false);
      setState(DISABLED_SHORTCUT_PREFERENCES);
      setError(cause instanceof Error ? cause.message : String(cause));
    };
    void LibraryDatabase.open().then(async opened => {
      if (cancelled) { opened.close(); return; }
      database.current = library = opened;
      const refresh = async () => {
        const current = ++revision.current;
        try {
          const saved = await opened.getShortcutPreferences();
          if (cancelled || current !== revision.current) return;
          setState(saved === undefined ? DEFAULT_SHORTCUT_PREFERENCES : parseShortcutPreferences(saved));
          setReady(true);
          setError(undefined);
        } catch (cause) {
          if (current === revision.current) fail(cause);
        }
      };
      unsubscribe = opened.subscribePreferences(() => { void refresh(); });
      await refresh();
    }).catch(fail);
    return () => {
      cancelled = true;
      revision.current++;
      unsubscribe?.();
      if (database.current === library) database.current = undefined;
      library?.close();
    };
  }, []);
  const setPreferences = useCallback(async (next: ShortcutPreferences) => {
    const db = database.current;
    if (!db) throw new Error("Keyboard shortcut settings are not ready.");
    const current = ++revision.current;
    try {
      const preferences = parseShortcutPreferences(next);
      await db.setShortcutPreferences(preferences);
      if (database.current !== db || current !== revision.current) return;
      setState(preferences);
      setReady(true);
      setError(undefined);
    } catch (cause) {
      if (database.current === db && current === revision.current) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
      throw cause;
    }
  }, []);
  return (
    <ShortcutPreferencesContext.Provider value={{ preferences, platform, ready, error, setPreferences }}>
      {children}
    </ShortcutPreferencesContext.Provider>
  );
}

export function useShortcutPreferences(): ShortcutPreferencesContextValue {
  return useContext(ShortcutPreferencesContext);
}
