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
    {/* Keep the flat, gently rounded cover; a wider spread and stacked
        square page edges distinguish the book from a square face. */}
    <path
      d="M 34 40 Q 26 40 26 48 L 26 92 Q 26 100 34 100 L 86 100 Q 94 100 94 92 L 94 48 Q 94 40 86 40 Z"
      fill="url(#ambra-trouble-gradient)"
    />
    <path
      d="M 34 40 Q 26 40 26 48 L 26 92 Q 26 100 34 100 L 86 100 Q 94 100 94 92 L 94 48 Q 94 40 86 40 Z"
      stroke="#3f6b24"
      strokeWidth="2"
      strokeLinejoin="round"
    />
    <path d="M 30 44 H 90 V 96 H 30 Z" fill="#e8ddc9" />
    <path d="M 30 44 H 58 V 93 H 30 Z M 62 44 H 90 V 93 H 62 Z" fill="#fdf6e8" />
    <path d="M 32 94.5 H 57 M 63 94.5 H 88" stroke="#c5bda8" strokeWidth="0.7" />
    {/* Spine, down the middle of the pages */}
    <line x1="60" y1="44" x2="60" y2="96" stroke="#3f6b24" strokeWidth="1.2" opacity="0.45" />
    {/* Lines of "text" on each page, pushed in close to the spine
        (where a book's own text sits nearest the gutter) and reaching
        from just below the top edge down to the bottom — deliberately
        drawn *before* the face below so its eyes/mouth sit on top of
        them, the way a face resting on a page of text would. */}
    <line x1="38" y1="50" x2="57" y2="50" stroke="#3f6b24" strokeWidth="1.5" opacity="0.35" strokeLinecap="round" />
    <line x1="38" y1="56" x2="58" y2="56" stroke="#3f6b24" strokeWidth="1.5" opacity="0.35" strokeLinecap="round" />
    <line x1="38" y1="62" x2="56" y2="62" stroke="#3f6b24" strokeWidth="1.5" opacity="0.35" strokeLinecap="round" />
    <line x1="38" y1="74" x2="57" y2="74" stroke="#3f6b24" strokeWidth="1.5" opacity="0.35" strokeLinecap="round" />
    <line x1="38" y1="80" x2="55" y2="80" stroke="#3f6b24" strokeWidth="1.5" opacity="0.35" strokeLinecap="round" />
    <line x1="38" y1="86" x2="57" y2="86" stroke="#3f6b24" strokeWidth="1.5" opacity="0.35" strokeLinecap="round" />
    <line x1="63" y1="50" x2="82" y2="50" stroke="#3f6b24" strokeWidth="1.5" opacity="0.35" strokeLinecap="round" />
    <line x1="62" y1="56" x2="82" y2="56" stroke="#3f6b24" strokeWidth="1.5" opacity="0.35" strokeLinecap="round" />
    <line x1="64" y1="62" x2="82" y2="62" stroke="#3f6b24" strokeWidth="1.5" opacity="0.35" strokeLinecap="round" />
    <line x1="63" y1="74" x2="82" y2="74" stroke="#3f6b24" strokeWidth="1.5" opacity="0.35" strokeLinecap="round" />
    <line x1="65" y1="80" x2="82" y2="80" stroke="#3f6b24" strokeWidth="1.5" opacity="0.35" strokeLinecap="round" />
    <line x1="63" y1="86" x2="82" y2="86" stroke="#3f6b24" strokeWidth="1.5" opacity="0.35" strokeLinecap="round" />
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
