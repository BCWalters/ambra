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
 * A green cover was chosen simply to keep this "oh no" moment visually
 * distinct from the amber Ambra icon/brand elsewhere in the UI, so it
 * doesn't read as a branding color gone wrong.
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
    {/* Body — an open book viewed face-on, kept as a simple rounded
        rectangle (same gentle corner radius top and bottom, flat top
        and bottom edges) per issue #121: an asymmetric wavy top read
        as fussy/unclear, so both the cover and the inner page area
        below use one consistent, plain silhouette. */}
    <path
      d="M 38 40 Q 30 40 30 48 L 30 92 Q 30 100 38 100 L 82 100 Q 90 100 90 92 L 90 48 Q 90 40 82 40 Z"
      fill="url(#ambra-trouble-gradient)"
    />
    <path
      d="M 38 40 Q 30 40 30 48 L 30 92 Q 30 100 38 100 L 82 100 Q 90 100 90 92 L 90 48 Q 90 40 82 40 Z"
      stroke="#3f6b24"
      strokeWidth="2"
      strokeLinejoin="round"
    />
    {/* Inner page area — a plain rectangle (no rounded corners) inset
        just a few px inside the cover, so the amber cover reads as a
        slim, even border rather than a thick frame. */}
    <path d="M 34 44 L 86 44 L 86 96 L 34 96 Z" fill="#fdf6e8" />
    {/* Spine, down the middle of the pages */}
    <line x1="60" y1="46" x2="60" y2="94" stroke="#3f6b24" strokeWidth="1.5" opacity="0.5" />
    {/* Lines of "text" on each page, pushed in close to the spine
        (where a book's own text sits nearest the gutter) and reaching
        from just below the top edge down to the bottom — deliberately
        drawn *before* the face below so its eyes/mouth sit on top of
        them, the way a face resting on a page of text would. */}
    <line x1="42" y1="50" x2="57" y2="50" stroke="#3f6b24" strokeWidth="1.5" opacity="0.35" strokeLinecap="round" />
    <line x1="42" y1="56" x2="58" y2="56" stroke="#3f6b24" strokeWidth="1.5" opacity="0.35" strokeLinecap="round" />
    <line x1="42" y1="62" x2="56" y2="62" stroke="#3f6b24" strokeWidth="1.5" opacity="0.35" strokeLinecap="round" />
    <line x1="42" y1="74" x2="57" y2="74" stroke="#3f6b24" strokeWidth="1.5" opacity="0.35" strokeLinecap="round" />
    <line x1="42" y1="80" x2="55" y2="80" stroke="#3f6b24" strokeWidth="1.5" opacity="0.35" strokeLinecap="round" />
    <line x1="42" y1="86" x2="57" y2="86" stroke="#3f6b24" strokeWidth="1.5" opacity="0.35" strokeLinecap="round" />
    <line x1="42" y1="91" x2="56" y2="91" stroke="#3f6b24" strokeWidth="1.5" opacity="0.35" strokeLinecap="round" />
    <line x1="63" y1="50" x2="78" y2="50" stroke="#3f6b24" strokeWidth="1.5" opacity="0.35" strokeLinecap="round" />
    <line x1="62" y1="56" x2="78" y2="56" stroke="#3f6b24" strokeWidth="1.5" opacity="0.35" strokeLinecap="round" />
    <line x1="64" y1="62" x2="78" y2="62" stroke="#3f6b24" strokeWidth="1.5" opacity="0.35" strokeLinecap="round" />
    <line x1="63" y1="74" x2="78" y2="74" stroke="#3f6b24" strokeWidth="1.5" opacity="0.35" strokeLinecap="round" />
    <line x1="65" y1="80" x2="78" y2="80" stroke="#3f6b24" strokeWidth="1.5" opacity="0.35" strokeLinecap="round" />
    <line x1="63" y1="86" x2="78" y2="86" stroke="#3f6b24" strokeWidth="1.5" opacity="0.35" strokeLinecap="round" />
    <line x1="64" y1="91" x2="78" y2="91" stroke="#3f6b24" strokeWidth="1.5" opacity="0.35" strokeLinecap="round" />
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
        <stop offset="0%" stopColor="#9ccb6b" />
        <stop offset="100%" stopColor="#5a8a3a" />
      </linearGradient>
    </defs>
  </svg>
);
