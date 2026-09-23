import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { FC, ReactNode } from "react";
import { LibraryDatabase } from "../library/LibraryDatabase.js";
import { DEFAULT_LOCALE, resolveLocale } from "./Locale.js";
import type { Locale, LocalePreference } from "./Locale.js";
import { getTranslate } from "./translate.js";
import type { Translate } from "./translate.js";
import { describeStorageError } from "../StorageErrors.js";

export type { Translate } from "./translate.js";
export { getTranslate } from "./translate.js";

interface LocaleContextValue {
  /** The locale actually in effect right now — already resolved from
   * `preference` (e.g. "system" resolved against the real browser
   * language) so components never need to do that resolution
   * themselves. */
  locale: Locale;
  /** What the reader actually chose — `"system"` (the default) or an
   * explicit locale — for the settings menu's own radio-button state
   * (which needs to show "System default" as checked, not whichever
   * locale that happens to currently resolve to). */
  preference: LocalePreference;
  setPreference: (preference: LocalePreference) => void;
  ready: boolean;
  error: string | undefined;
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: DEFAULT_LOCALE,
  preference: "system",
  setPreference: () => {},
  ready: false,
  error: undefined,
});

export interface LocaleProviderProps {
  children: ReactNode;
}

/** Owns the shared UI language and its database connection independently of
 * book loading. Library and reader menus use the same provider and receive
 * committed changes from other open pages. */
export const LocaleProvider: FC<LocaleProviderProps> = ({ children }) => {
  const [preference, setPreferenceState] = useState<LocalePreference>("system");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string>();
  const database = useRef<LibraryDatabase | undefined>(undefined);
  const revision = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let library: LibraryDatabase | undefined;
    let unsubscribe: (() => void) | undefined;
    void LibraryDatabase.open().then(async (opened) => {
      if (cancelled) {
        opened.close();
        return;
      }
      library = opened;
      database.current = opened;
      const refresh = async () => {
        const current = ++revision.current;
        const saved = await opened.getLocalePreference();
        if (!cancelled && current === revision.current) {
          setPreferenceState(saved ?? "system");
          setReady(true);
        }
      };
      unsubscribe = opened.subscribePreferences(() => {
        void refresh().catch((err) => {
          if (!cancelled) setError(describeStorageError(err, "open", "language settings"));
        });
      });
      await refresh();
    }).catch((err) => {
      if (!cancelled) setError(describeStorageError(err, "open", "language settings"));
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
      if (database.current === library) database.current = undefined;
      library?.close();
    };
  }, []);

  const setPreference = useCallback((next: LocalePreference) => {
    const db = database.current;
    if (!db) return;
    const current = ++revision.current;
    void db.setLocalePreference(next).then(() => {
      if (database.current === db && current === revision.current) {
        setPreferenceState(next);
        setError(undefined);
      }
    }).catch((err) => {
      if (database.current === db) setError(describeStorageError(err, "save", "language settings"));
    });
  }, []);

  const locale = resolveLocale(preference);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return (
    <LocaleContext.Provider value={{ locale, preference, setPreference, ready, error }}>{children}</LocaleContext.Provider>
  );
};

/** The current locale, the reader's raw preference (`"system"` or an
 * explicit choice), and a setter — for the settings menu's language
 * picker specifically. Most components should use `useTranslation`
 * instead; this is for the one place that needs the preference/setter
 * themselves, not just translated strings. */
export function useLocale(): LocaleContextValue {
  return useContext(LocaleContext);
}

/** Returns `t(key, params?)`, looking up `key` in the current locale's
 * string catalog (see `StringCatalog`) — falls back to the English
 * string if the active locale is somehow missing a key (shouldn't
 * happen, since every locale file is typechecked against the exact same
 * key set, but defensive against a future partial/in-progress
 * translation file that intentionally omits some keys).
 *
 * `params`, when given, fills in `{placeholder}` tokens in the looked-up
 * string (e.g. `t("scrubber.pageOfTotal", { current: 3, total: 20 })` on
 * a catalog entry of `"Page {current} of {total}"`) — a deliberately
 * minimal, dependency-free stand-in for a real ICU MessageFormat engine,
 * sufficient for this app's actual needs (a handful of simple numeric
 * substitutions, no complex plural/gender rules beyond the manual
 * "One"/"Other" key pairs already used for the couple of counts that
 * need one — see e.g. `scrubber.pagesLeftInChapterOne`/`...Other`). */
export function useTranslation(): Translate {
  const { locale } = useLocale();
  return useMemo(() => getTranslate(locale), [locale]);
}
