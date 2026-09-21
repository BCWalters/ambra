import type { Locale } from "./Locale.js";
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

export const CATALOGS: Readonly<Record<Locale, StringCatalog>> = { en, es, fr, de, ja, ko, zh, it, ru };

/** `t(key, params?)`'s own function shape — a locale-bound string lookup
 * plus `{placeholder}` interpolation (see `useTranslation`'s doc comment
 * for the full rationale). Lives in this plain (non-React) module, not
 * `LocaleContext.tsx`, so non-component code that can't use a hook
 * (`ReaderController` — a plain, framework-agnostic class, not a React
 * component) can still be handed a real translator, via
 * `getTranslate`/`ReaderController.setTranslate`, instead of only ever
 * emitting hardcoded English for things like screen-reader
 * announcements. */
export type Translate = (key: keyof StringCatalog, params?: Record<string, string | number>) => string;

function interpolate(template: string, params: Record<string, string | number> | undefined): string {
  if (!params) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}

/** A standalone (non-hook) translator bound to one locale — the same
 * lookup+interpolation `useTranslation` uses internally, for callers
 * outside the React tree. See `Translate`'s doc comment. */
export function getTranslate(locale: Locale): Translate {
  const catalog = CATALOGS[locale];
  return (key, params) => interpolate(catalog[key] ?? en[key], params);
}
