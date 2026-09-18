import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { FC, ReactNode } from "react";
import { LibraryDatabase } from "../library/LibraryDatabase.js";
import { DEFAULT_LOCALE, resolveLocale } from "./Locale.js";
import type { Locale, LocalePreference } from "./Locale.js";
import { en } from "./locales/en.js";
import { es } from "./locales/es.js";
import { fr } from "./locales/fr.js";
import { de } from "./locales/de.js";
import { ja } from "./locales/ja.js";
import { ko } from "./locales/ko.js";
import { zh } from "./locales/zh.js";
import { it } from "./locales/it.js";
import { ru } from "./locales/ru.js";
import type { StringCatalog } from "./locales/en.js";

const CATALOGS: Readonly<Record<Locale, StringCatalog>> = { en, es, fr, de, ja, ko, zh, it, ru };

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

/** Returns `t(key)`, looking up `key` in the current locale's string
 * catalog (see `StringCatalog`) — falls back to the English string if
 * the active locale is somehow missing a key (shouldn't happen, since
 * every locale file is typechecked against the exact same key set, but
 * defensive against a future partial/in-progress translation file that
 * intentionally omits some keys). */
export function useTranslation(): (key: keyof StringCatalog) => string {
  const { locale } = useLocale();
  const catalog = CATALOGS[locale];
  return useCallback((key: keyof StringCatalog) => catalog[key] ?? en[key], [catalog]);
}
