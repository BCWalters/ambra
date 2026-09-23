import { useId, type FC } from "react";

export interface AmbraMarkIconProps {
  size?: number;
}

/** Decorative brand mark shared by Library/About branding and the reader's Library button. */
export const AmbraMarkIcon: FC<AmbraMarkIconProps> = ({ size = 20 }) => {
  const gradientId = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true">
      <path
        d="M 64 20 C 90 54, 101 71, 101 89 C 101 107, 84.5 120, 64 120 C 43.5 120, 27 107, 27 89 C 27 71, 38 54, 64 20 Z"
        fill={`url(#${gradientId})`}
        stroke="#6b3410"
        strokeWidth="4"
        strokeLinejoin="round"
      />
      <defs>
        <linearGradient id={gradientId} x1="40" y1="18" x2="88" y2="118" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#ffdf9c" />
          <stop offset="42%" stopColor="#f5a531" />
          <stop offset="100%" stopColor="#b6591b" />
        </linearGradient>
      </defs>
    </svg>
  );
};
