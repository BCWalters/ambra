import type { Locale } from "../i18n/Locale.js";

export function formatLibraryBytes(bytes: number, locale: Locale): string {
  const units = ["byte", "kilobyte", "megabyte", "gigabyte", "terabyte"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = unitIndex === 0 || value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return new Intl.NumberFormat(locale, {
    style: "unit", unit: units[unitIndex], unitDisplay: "short",
    minimumFractionDigits: precision, maximumFractionDigits: precision,
  }).format(value);
}

export function formatLibraryProgress(fraction: number, locale: Locale): string {
  return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(fraction);
}
