import type { FC } from "react";

export interface LibraryEmptyIllustrationProps {
  size?: number;
}

/**
 * A friendly, welcoming book character for the Library's empty state
 * (issue #124) — the same hand-drawn-SVG construction as the reader's
 * `BookTroubleIllustration` (arms/legs/cover/pages/face built from
 * plain shapes, no bitmap asset), but happy rather than distressed:
 * arms open in a "come on in" gesture and a smiling mouth, in Ambra's
 * own amber palette rather than the error illustration's green — this
 * is an invitation, not a problem to report.
 */
export const LibraryEmptyIllustration: FC<LibraryEmptyIllustrationProps> = ({ size = 140 }) => (
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
    {/* Arms, open outward in a welcoming "come on in" gesture */}
    <line x1="34" y1="66" x2="14" y2="74" stroke="#b5772e" strokeWidth="4" strokeLinecap="round" />
    <line x1="86" y1="66" x2="106" y2="74" stroke="#b5772e" strokeWidth="4" strokeLinecap="round" />
    {/* Body — the same plain rounded-rectangle cover/pages silhouette as
        the error illustration, in Ambra's amber rather than green. */}
    <path
      d="M 38 40 Q 30 40 30 48 L 30 92 Q 30 100 38 100 L 82 100 Q 90 100 90 92 L 90 48 Q 90 40 82 40 Z"
      fill="url(#ambra-library-empty-gradient)"
    />
    <path
      d="M 38 40 Q 30 40 30 48 L 30 92 Q 30 100 38 100 L 82 100 Q 90 100 90 92 L 90 48 Q 90 40 82 40 Z"
      stroke="#8a5a24"
      strokeWidth="2"
      strokeLinejoin="round"
    />
    <path d="M 34 44 L 86 44 L 86 96 L 34 96 Z" fill="#fdf6e8" />
    <line x1="60" y1="46" x2="60" y2="94" stroke="#8a5a24" strokeWidth="1.5" opacity="0.5" />
    <line x1="42" y1="50" x2="57" y2="50" stroke="#8a5a24" strokeWidth="1.5" opacity="0.35" strokeLinecap="round" />
    <line x1="42" y1="56" x2="58" y2="56" stroke="#8a5a24" strokeWidth="1.5" opacity="0.35" strokeLinecap="round" />
    <line x1="42" y1="62" x2="56" y2="62" stroke="#8a5a24" strokeWidth="1.5" opacity="0.35" strokeLinecap="round" />
    <line x1="42" y1="74" x2="57" y2="74" stroke="#8a5a24" strokeWidth="1.5" opacity="0.35" strokeLinecap="round" />
    <line x1="42" y1="80" x2="55" y2="80" stroke="#8a5a24" strokeWidth="1.5" opacity="0.35" strokeLinecap="round" />
    <line x1="42" y1="86" x2="57" y2="86" stroke="#8a5a24" strokeWidth="1.5" opacity="0.35" strokeLinecap="round" />
    <line x1="42" y1="91" x2="56" y2="91" stroke="#8a5a24" strokeWidth="1.5" opacity="0.35" strokeLinecap="round" />
    <line x1="63" y1="50" x2="78" y2="50" stroke="#8a5a24" strokeWidth="1.5" opacity="0.35" strokeLinecap="round" />
    <line x1="62" y1="56" x2="78" y2="56" stroke="#8a5a24" strokeWidth="1.5" opacity="0.35" strokeLinecap="round" />
    <line x1="64" y1="62" x2="78" y2="62" stroke="#8a5a24" strokeWidth="1.5" opacity="0.35" strokeLinecap="round" />
    <line x1="63" y1="74" x2="78" y2="74" stroke="#8a5a24" strokeWidth="1.5" opacity="0.35" strokeLinecap="round" />
    <line x1="65" y1="80" x2="78" y2="80" stroke="#8a5a24" strokeWidth="1.5" opacity="0.35" strokeLinecap="round" />
    <line x1="63" y1="86" x2="78" y2="86" stroke="#8a5a24" strokeWidth="1.5" opacity="0.35" strokeLinecap="round" />
    <line x1="64" y1="91" x2="78" y2="91" stroke="#8a5a24" strokeWidth="1.5" opacity="0.35" strokeLinecap="round" />
    {/* Face — a smile (corners up, dipping down in the middle) instead
        of the error illustration's frown. */}
    <circle cx="48" cy="58" r="4.5" fill="#4a2f10" />
    <circle cx="72" cy="58" r="4.5" fill="#4a2f10" />
    <path
      d="M46 66 Q60 78 74 66"
      stroke="#4a2f10"
      strokeWidth="3.5"
      strokeLinecap="round"
      fill="none"
    />
    <defs>
      <linearGradient id="ambra-library-empty-gradient" x1="30" y1="34" x2="90" y2="100" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#f4c669" />
        <stop offset="100%" stopColor="#d68a3a" />
      </linearGradient>
    </defs>
  </svg>
);
