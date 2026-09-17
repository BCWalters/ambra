import type { FC } from "react";

export interface BookTroubleIllustrationProps {
  size?: number;
}

/**
 * A small, friendly "oh no" book character — hand-drawn as a plain inline
 * SVG (consistent with minimizing what this project depends on/ships;
 * see the extension icon, also hand-authored this way) rather than a
 * bitmap asset. Used by `FriendlyError` for a blocking error (the book
 * failed to open, or a chapter failed to load with nothing else to show
 * in its place) — see issue #27: a reader hitting a real bug shouldn't
 * be met with a bare stack trace, but the illustration is deliberately
 * modest/quick to read, not a cutesy centerpiece — this is still an
 * error state, not a mascot moment.
 *
 * The palette echoes the extension's own Ambra (amber) icon/theme so an
 * error page still feels like part of the same product, not a generic
 * "something broke" placeholder.
 */
export const BookTroubleIllustration: FC<BookTroubleIllustrationProps> = ({ size = 120 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 120 120"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    aria-hidden="true"
  >
    {/* Legs */}
    <line x1="46" y1="96" x2="40" y2="112" stroke="#b5772e" strokeWidth="4" strokeLinecap="round" />
    <line x1="74" y1="96" x2="80" y2="112" stroke="#b5772e" strokeWidth="4" strokeLinecap="round" />
    {/* Arms, thrown up in an "oh well" shrug */}
    <line x1="34" y1="66" x2="18" y2="50" stroke="#b5772e" strokeWidth="4" strokeLinecap="round" />
    <line x1="86" y1="66" x2="102" y2="50" stroke="#b5772e" strokeWidth="4" strokeLinecap="round" />
    {/* Body — a rounded book/gem shape matching the extension icon's own silhouette */}
    <rect x="30" y="34" width="60" height="66" rx="16" fill="url(#ambra-trouble-gradient)" />
    <rect x="30" y="34" width="60" height="66" rx="16" stroke="#8a5a24" strokeWidth="2" />
    {/* A single "spine" line, echoing an open book */}
    <line x1="60" y1="40" x2="60" y2="94" stroke="#8a5a24" strokeWidth="1.5" opacity="0.4" />
    {/* Face */}
    <circle cx="48" cy="58" r="4.5" fill="#4a2f10" />
    <circle cx="72" cy="58" r="4.5" fill="#4a2f10" />
    <path
      d="M46 76 Q60 66 74 76"
      stroke="#4a2f10"
      strokeWidth="3.5"
      strokeLinecap="round"
      fill="none"
    />
    <defs>
      <linearGradient id="ambra-trouble-gradient" x1="30" y1="34" x2="90" y2="100" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#f4c669" />
        <stop offset="100%" stopColor="#d68a3a" />
      </linearGradient>
    </defs>
  </svg>
);
