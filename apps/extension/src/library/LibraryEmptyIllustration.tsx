import type { FC } from "react";

export interface LibraryEmptyIllustrationProps { size?: number }

/** Original open-book illustration, decorative and shared by both library sizes. */
export const LibraryEmptyIllustration: FC<LibraryEmptyIllustrationProps> = ({ size = 104 }) => (
  <svg width={size} height={size} viewBox="0 0 120 120" fill="none" aria-hidden="true">
    <path d="M14 31Q37 24 60 38Q83 24 106 31V89Q83 82 60 96Q37 82 14 89Z"
      fill="var(--colorBrandBackground2)" stroke="var(--colorBrandStroke1)" strokeWidth="2" strokeLinejoin="round" />
    <path d="M20 26Q40 23 60 36Q80 23 100 26V82Q80 79 60 92Q40 79 20 82Z"
      fill="var(--colorNeutralBackground1)" stroke="var(--colorNeutralStroke1)" strokeWidth="2" strokeLinejoin="round" />
    <path d="M60 36V92M30 43Q40 43 49 49M30 53Q40 53 49 59M30 63Q40 63 49 69M71 49Q80 43 90 43M71 59Q80 53 90 53M71 69Q80 63 90 63"
      stroke="var(--colorNeutralForeground3)" strokeWidth="2" strokeLinecap="round" />
    <path d="M82 28V50L87 46L92 48V26" fill="var(--colorBrandBackground)" />
  </svg>
);
