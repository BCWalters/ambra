import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { FC, ReactNode } from "react";
import { LibraryDatabase } from "../library/LibraryDatabase.js";
import { DEFAULT_LOCALE, resolveLocale } from "./Locale.js";
import type { Locale, LocalePreference } from "./Locale.js";
import { getTranslate } from "./translate.js";
import type { Translate } from "./translate.js";

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
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: DEFAULT_LOCALE,
  preference: "system",
  setPreference: () => {},
});

export interface LocaleProviderProps {
  children: ReactNode;
}

/** Makes the current UI locale (and a setter for it) available to every
 * component without prop-drilling it through the whole tree — see
 * `ChromeThemeProvider` for the identical reasoning applied to chrome
 * color. Unlike that one, this owns its own state directly (loading the
 * saved preference once on mount, persisting every change) rather than
 * being handed a value from `ReaderSnapshot`, since the language choice
 * is a `LibraryDatabase`-backed setting shared across the whole
 * extension — including the library page, which has no
 * `ReaderSnapshot`/reader-specific `LibraryDatabase` connection of its
 * own at all. Opens (and closes on unmount) its own independent
 * `LibraryDatabase` connection rather than requiring every caller to
 * already have one handy — IndexedDB is fine with more than one
 * connection open to the same database at once, and this is the only
 * setting genuinely needed on *every* extension page, reader or
 * library. */
export const LocaleProvider: FC<LocaleProviderProps> = ({ children }) => {
  const [preference, setPreferenceState] = useState<LocalePreference>("system");

  useEffect(() => {
    let cancelled = false;
    let library: LibraryDatabase | undefined;
    void LibraryDatabase.open().then(async (opened) => {
      if (cancelled) {
        opened.close();
        return;
      }
      library = opened;
      const saved = await opened.getLocalePreference();
      if (!cancelled && saved) {
        setPreferenceState(saved);
      }
    });
    return () => {
      cancelled = true;
      library?.close();
    };
  }, []);

  const setPreference = useCallback((next: LocalePreference) => {
    setPreferenceState(next);
    void LibraryDatabase.open().then(async (db) => {
      await db.setLocalePreference(next);
      db.close();
    });
  }, []);

  const locale = resolveLocale(preference);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return (
    <LocaleContext.Provider value={{ locale, preference, setPreference }}>{children}</LocaleContext.Provider>
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
