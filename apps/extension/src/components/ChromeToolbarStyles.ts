import { buttonClassNames, makeStyles } from "@fluentui/react-components";

export const CHROME_TOOLBAR_HEIGHT = 56;

export const useChromeToolbarStyles = makeStyles({
  root: {
    height: `${CHROME_TOOLBAR_HEIGHT}px`,
    boxSizing: "border-box",
    [`& .${buttonClassNames.icon}`]: { fontSize: "20px" },
  },
});
