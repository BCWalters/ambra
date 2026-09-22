/** Thrown when a SMIL clock value (`clipBegin`/`clipEnd`) doesn't match
 * either clock-value form SMIL 3.0 defines. */
export class SmilClockValueError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "SmilClockValueError";
  }
}

/**
 * Parses a SMIL 3.0 clock value into seconds — the two forms Media
 * Overlay `clipBegin`/`clipEnd` attributes actually use in practice:
 *
 * - A clock value, with or without an hours component:
 *   `H:MM:SS(.fraction)?` (e.g. `"0:23:23.84"`) or `MM:SS(.fraction)?`
 *   (e.g. `"23:23.84"`).
 * - A timecount value: a plain number with an optional unit suffix
 *   (`h`/`min`/`s`/`ms`) — e.g. `"5.2s"`, `"200ms"`, `"3min"`, `"1h"`.
 *   A bare number with no suffix is treated as seconds (SMIL itself
 *   requires a metric here, but real-world files occasionally omit it,
 *   and seconds is the only reasonable default).
 */
export function parseSmilClockValue(value: string): number {
  const trimmed = value.trim();

  if (trimmed.includes(":")) {
    const parts = trimmed.split(":");
    if (parts.length === 3) {
      const [hours, minutes, seconds] = parts as [string, string, string];
      return toSeconds(hours, 3600) + toSeconds(minutes, 60) + toSeconds(seconds, 1);
    }
    if (parts.length === 2) {
      const [minutes, seconds] = parts as [string, string];
      return toSeconds(minutes, 60) + toSeconds(seconds, 1);
    }
    throw new SmilClockValueError(`Malformed SMIL clock value: "${value}"`);
  }

  const match = /^(\d+(?:\.\d+)?)(h|min|ms|s)?$/.exec(trimmed);
  if (!match) {
    throw new SmilClockValueError(`Malformed SMIL clock value: "${value}"`);
  }
  const amount = Number(match[1]);
  switch (match[2]) {
    case "h":
      return amount * 3600;
    case "min":
      return amount * 60;
    case "ms":
      return amount / 1000;
    default:
      return amount;
  }
}

function toSeconds(component: string, multiplier: number): number {
  const value = Number(component);
  if (!Number.isFinite(value)) {
    throw new SmilClockValueError(`Malformed SMIL clock value component: "${component}"`);
  }
  return value * multiplier;
}
