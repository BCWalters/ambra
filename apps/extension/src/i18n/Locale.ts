/** Every UI locale this app ships translated strings for (issue #50) —
 * "system" isn't a real locale of its own, but a sentinel meaning
 * "detect from the browser" (see `detectBrowserLocale`), which is the
 * default until a reader explicitly picks one in the settings menu. */
export type Locale = "en" | "es" | "fr" | "de" | "ja" | "ko" | "zh" | "it" | "ru";

export type LocalePreference = "system" | Locale;

export const DEFAULT_LOCALE: Locale = "en";

/** Every supported locale, in the order they should list in a language
 * picker — alphabetical by English name, with English first since it's
 * the one every install can always fall back to. */
export const SUPPORTED_LOCALES: readonly Locale[] = ["en", "zh", "fr", "de", "it", "ja", "ko", "ru", "es"];

/** Each locale's own name for itself (not its English name) — a
 * language picker should always show a language's *own* name, not a
 * translation of it, so a reader can find their language even if the
 * current UI language is one they don't read at all. */
export const LOCALE_NATIVE_NAMES: Readonly<Record<Locale, string>> = {
  en: "English",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
  ja: "日本語",
  ko: "한국어",
  zh: "中文",
  it: "Italiano",
  ru: "Русский",
};

/** Maps a BCP-47 language tag (e.g. from `navigator.language`, which
 * looks like `"en-US"`/`"fr"`/`"zh-Hans-CN"`) down to one of our
 * supported locales by comparing just its primary subtag — good enough
 * for the handful of coarse-grained locales this app ships, without
 * needing a real BCP-47 parsing library. Falls back to `DEFAULT_LOCALE`
 * for anything unrecognized (including English regional variants we
 * don't have a dedicated translation for, which is correct: our one
 * `"en"` catalog already covers every English-speaking locale). */
export function matchSupportedLocale(tag: string): Locale {
  const primarySubtag = tag.split("-")[0]?.toLowerCase();
  const match = SUPPORTED_LOCALES.find((locale) => locale === primarySubtag);
  return match ?? DEFAULT_LOCALE;
}

/** Resolves `navigator.languages`/`navigator.language` (the browser's
 * own ranked preference list) down to whichever supported locale to use
 * — the first entry that matches any of our supported locales, or
 * `DEFAULT_LOCALE` if none do. Reads the *list* (not just the single
 * top preference) so a browser configured for, say, `["fr-CA", "en-US"]`
 * still gets French rather than immediately falling back to English
 * because the top entry's exact region isn't one of ours. */
export function detectBrowserLocale(): Locale {
  const candidates = typeof navigator !== "undefined" ? (navigator.languages ?? [navigator.language]) : [];
  for (const tag of candidates) {
    if (!tag) {
      continue;
    }
    const primarySubtag = tag.split("-")[0]?.toLowerCase();
    if (SUPPORTED_LOCALES.some((locale) => locale === primarySubtag)) {
      return matchSupportedLocale(tag);
    }
  }
  return DEFAULT_LOCALE;
}

/** Resolves a stored `LocalePreference` ("system", or an explicit
 * locale a reader picked in settings) down to the actual `Locale` to
 * render the UI in right now. */
export function resolveLocale(preference: LocalePreference): Locale {
  return preference === "system" ? detectBrowserLocale() : preference;
}
