import type { FC } from "react";

export interface AmbraMarkIconProps {
  size?: number;
}

/**
 * The Ambra "drop" mark — a simplified, single-path version of the
 * extension icon's amber gem shape (see `apps/extension/icon-source/icon.svg`),
 * sized to sit inline as a toolbar icon. Used for the reader toolbar's
 * Library button (issue #125): a generic left-arrow read as "go back"
 * to wherever you were, which isn't what this button does — it always
 * takes you to the Library, so it should look like a destination
 * (Ambra's own mark), not a directional undo.
 */
export const AmbraMarkIcon: FC<AmbraMarkIconProps> = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true">
    <path
      d="M 64 20 C 90 54, 101 71, 101 89 C 101 107, 84.5 120, 64 120 C 43.5 120, 27 107, 27 89 C 27 71, 38 54, 64 20 Z"
      fill="url(#ambra-mark-gradient)"
      stroke="#6b3410"
      strokeWidth="4"
      strokeLinejoin="round"
    />
    <defs>
      <linearGradient id="ambra-mark-gradient" x1="40" y1="18" x2="88" y2="118" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#ffdf9c" />
        <stop offset="42%" stopColor="#f5a531" />
        <stop offset="100%" stopColor="#b6591b" />
      </linearGradient>
    </defs>
  </svg>
);
