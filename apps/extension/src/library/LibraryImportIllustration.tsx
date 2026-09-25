import type { FC } from "react";
import { makeStyles } from "@fluentui/react-components";
import { CHROME_THEMES } from "../reader/chromeTheme.js";

const useStyles = makeStyles({
  arriving: {
    transformBox: "fill-box",
    transformOrigin: "50% 100%",
    animationName: {
      "0%": { transform: "translate(-96px, -26px) rotate(-18deg)", opacity: 0 },
      "12%": { opacity: 1 },
      "52%": { transform: "translate(-8px, -14px) rotate(8deg)", opacity: 1 },
      "65%": { transform: "translate(0, 0) rotate(0deg)", opacity: 1 },
      "72%": { transform: "translate(0, -3px) rotate(-2deg)", opacity: 1 },
      "80%, 92%": { transform: "translate(0, 0) rotate(0deg)", opacity: 1 },
      "100%": { transform: "translate(0, 0) rotate(0deg)", opacity: 0 },
    },
    animationDuration: "4.8s",
    animationTimingFunction: "ease-in-out",
    animationIterationCount: "infinite",
    "@media (prefers-reduced-motion: reduce)": {
      animationName: "none",
    },
  },
});

export const LibraryImportIllustration: FC<{ busy: boolean }> = ({ busy }) => {
  const styles = useStyles();
  return (
    <svg data-testid="library-import-illustration" width="220" height="128" viewBox="0 0 180 104"
      fill="none" aria-hidden="true" focusable="false" style={{ maxWidth: "100%" }}>
      <ellipse cx="91" cy="94" rx="65" ry="4" fill="#8a5a24" opacity=".08" />
      <g stroke="#8a5a24" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round">
        <path d="M25 81H158V87H25Z" fill="#edd1a6" />
        <path d="M35 87V92M148 87V92" />
        <rect x="44" y="43" width="17" height="37" rx="3" fill="#c7d7ec" />
        <path d="M49 49H56M49 73H56" opacity=".55" />
        <rect x="64" y="35" width="20" height="45" rx="3" fill="#cee7da" />
        <path d="M69 42H79M69 47H79M69 73H79" opacity=".55" />
        <g transform="rotate(-9 103 80)">
          <rect x="91" y="47" width="16" height="33" rx="3" fill="#e1d4ef" />
          <path d="M96 53H102M96 73H102" opacity=".55" />
        </g>
        <g transform="translate(122 34)">
          <g data-testid="arriving-book" className={busy ? styles.arriving : undefined}>
            <path d="M3 0H23V46H3Q0 46 0 43V4Q0 0 3 0Z" fill={CHROME_THEMES.ambra.accent} />
            <path d="M4 0V39M4 39H23V46H4Q0 46 0 42.5Q0 39 4 39Z" fill="#fff8ec" />
            <path d="M6 42.5H20" opacity=".35" />
            <path d="M9 8H18" opacity=".55" />
            <circle cx="9" cy="20" r="1" fill="#8a5a24" stroke="none" />
            <circle cx="18" cy="20" r="1" fill="#8a5a24" stroke="none" />
            <path d="M10 26Q13.5 30 17 26" />
          </g>
        </g>
      </g>
    </svg>
  );
};
