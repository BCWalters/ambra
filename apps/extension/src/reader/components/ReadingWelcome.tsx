import { Button, Dialog, DialogBody, DialogContent, DialogSurface, DialogTitle } from "@fluentui/react-components";
import { ArrowDownRegular, ArrowLeftRegular, ArrowRightRegular, DismissRegular, LibraryRegular } from "@fluentui/react-icons";
import { useTranslation } from "../../i18n/LocaleContext.js";
import { useShortcutPreferences } from "../../shortcuts/ShortcutPreferencesContext.js";
import { useChromeTheme } from "../ChromeThemeContext.js";
import "./ReadingWelcome.css";

interface ReadingWelcomeProps {
  open: boolean;
  scrolling: boolean;
  rtl: boolean;
  onDismiss: () => void;
  onAfterClose: () => void;
  onLibrary: () => void;
}

/** Original, decorative book-and-reading-lamp illustration; no EPUB scripting or external assets. */
function ReadingNook() {
  return <svg viewBox="0 0 480 170" aria-hidden="true" focusable="false" className="reading-welcome-art">
    <ellipse cx="240" cy="143" rx="166" ry="13" fill="currentColor" opacity=".08" />
    <path d="M101 126V85a67 67 0 0 1 134 0v41" fill="currentColor" opacity=".07" />
    <circle cx="172" cy="72" r="29" fill="#efba64" opacity=".7" />
    <path d="M348 45v88m-26 0h51m-25-88-45 13" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    <path d="m300 43-26 33 64 1-17-36Z" fill="#bf783d" />
    <path d="m282 82-38 55h111l-25-55" fill="#edbd73" opacity=".2" />
    <path d="M125 102q49-18 113 5 56-25 117-10l-7 45q-56-8-111 9-58-19-116-9Z" fill="#af714c" />
    <path d="M128 96q52-15 110 6 58-22 109-9l-4 42q-54-10-106 8-56-18-112-8Z" fill="#fffaf0" stroke="#775b43" strokeWidth="2" />
    <path d="m238 102-1 41m-92-31q38-5 74 7m-73 4q36-3 67 6m46-14q32-11 67-7m-66 18q31-10 64-7" fill="none" stroke="#a89174" strokeWidth="2" strokeLinecap="round" />
    <path d="m273 96-2 29 8-5 7 4 1-30" fill="#b7653d" />
    <path d="M102 129c-21-11-25-24-18-31 16 1 22 17 18 31Zm0 0c-2-20 5-33 16-31 8 12-2 25-16 31Z" fill="#738369" />
    <path d="m89 128 4 17h19l5-17" fill="#c99467" />
    <path d="M365 113h19v21h-19Zm19 3h5a6 6 0 0 1 0 12h-5" fill="#e2c6a3" stroke="#775b43" strokeWidth="2" />
    <path d="M155 37v8m-4-4h8m102-9v8m-4-4h8" stroke="currentColor" opacity=".45" strokeWidth="2" strokeLinecap="round" />
  </svg>;
}

export function ReadingWelcome({ open, scrolling, rtl, onDismiss, onAfterClose, onLibrary }: ReadingWelcomeProps) {
  const t = useTranslation();
  const palette = useChromeTheme();
  const { ready, preferences } = useShortcutPreferences();
  return (
    <Dialog open={open} onOpenChange={(_event, data) => { if (!data.open) onDismiss(); }}
      surfaceMotion={{ onMotionFinish: (_event, data) => { if (data.direction === "exit") onAfterClose(); } }}>
      <DialogSurface className="reading-welcome" style={{ background: palette.backgroundSolid }}
        onKeyDown={event => { if (event.key === "Escape") event.stopPropagation(); }}>
        <DialogBody className="reading-welcome-body">
          <DialogTitle className="reading-welcome-title"
            action={<Button appearance="subtle" icon={<DismissRegular />} aria-label={t("highlight.close")} onClick={onDismiss} />}>
            {t("welcome.title")}
          </DialogTitle>
          <DialogContent className="reading-welcome-content">
            <p className="reading-welcome-intro">{t("welcome.intro")}</p>
            <ReadingNook />
            <div className="reading-welcome-tip">
              <span className="reading-welcome-icon" aria-hidden="true">{scrolling ? <ArrowDownRegular /> : rtl ? <ArrowLeftRegular /> : <ArrowRightRegular />}</span>
              <div><h3>{t(scrolling ? "welcome.scrollTitle" : "welcome.turnTitle")}</h3>
                <p>{t(scrolling ? "welcome.scroll" : rtl ? "welcome.marginsRtl" : "welcome.marginsLtr")}</p>
                {!scrolling && ready && preferences.enabled && <p className="reading-welcome-keys">{t(rtl ? "welcome.keysRtl" : "welcome.keysLtr")}</p>}
                {!scrolling && <p className="reading-welcome-note">{t("welcome.firstTap")}</p>}
              </div>
            </div>
            <div className="reading-welcome-tip">
              <span className="reading-welcome-icon" aria-hidden="true"><LibraryRegular /></span>
              <div><h3>{t("welcome.libraryTitle")}</h3><p>{t("welcome.library")}</p></div>
            </div>
            <div className="reading-welcome-actions">
              <Button appearance="primary" size="large" onClick={onDismiss}
                style={{ background: palette.accentForeground, borderColor: palette.accentForeground, color: "#fff" }}>
                {t("welcome.start")}
              </Button>
              <Button appearance="subtle" onClick={onLibrary}>{t("toolbar.backToLibrary")}</Button>
            </div>
            <p className="reading-welcome-footer">{t("welcome.reopen")}</p>
          </DialogContent>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
