import { Button, Dialog, DialogBody, DialogContent, DialogSurface, DialogTitle } from "@fluentui/react-components";
import { ArrowDownRegular, ArrowLeftRegular, ArrowRightRegular, DismissRegular, LibraryRegular } from "@fluentui/react-icons";
import { useTranslation } from "../../i18n/LocaleContext.js";
import { useShortcutPreferences } from "../../shortcuts/ShortcutPreferencesContext.js";
import { useChromeTheme } from "../ChromeThemeContext.js";
import { useId } from "react";
import "./ReadingWelcome.css";

interface ReadingWelcomeProps {
  open: boolean;
  scrolling: boolean;
  rtl: boolean;
  onDismiss: () => void;
  onAfterClose: () => void;
}

function ReadingNook() {
  const id = useId();
  const paint = (name: string) => `url(#${id}-${name})`;
  return <svg viewBox="0 0 480 240" aria-hidden="true" focusable="false" className="reading-welcome-art">
    <defs>
      <radialGradient id={`${id}-light`} cx=".55" cy=".25" r=".75">
        <stop stopColor="#fff3ce" stopOpacity=".85" /><stop offset="1" stopColor="#ffe4ab" stopOpacity="0" />
      </radialGradient>
      <linearGradient id={`${id}-table`} x2="0" y2="1">
        <stop stopColor="#d2a67c" /><stop offset="1" stopColor="#b98056" />
      </linearGradient>
      <linearGradient id={`${id}-shade`}>
        <stop stopColor="#52746a" /><stop offset=".48" stopColor="#839c88" /><stop offset="1" stopColor="#3b5a54" />
      </linearGradient>
      <linearGradient id={`${id}-left-page`}>
        <stop stopColor="#fff9e9" /><stop offset=".8" stopColor="#f9eed7" /><stop offset="1" stopColor="#d9c6a7" />
      </linearGradient>
      <linearGradient id={`${id}-right-page`}>
        <stop stopColor="#d9c6a7" /><stop offset=".16" stopColor="#fff9e9" /><stop offset="1" stopColor="#fffdf4" />
      </linearGradient>
      <linearGradient id={`${id}-ceramic`}>
        <stop stopColor="#d7e0d5" /><stop offset=".35" stopColor="#f7f6e9" /><stop offset="1" stopColor="#b3c3b7" />
      </linearGradient>
    </defs>
    <ellipse cx="243" cy="201" rx="199" ry="27" fill="#76533d" opacity=".1" />
    <path d="M37 174Q40 146 240 146T443 174V185Q433 218 240 220T37 185Z" fill="#9d6c49" />
    <ellipse cx="240" cy="174" rx="203" ry="38" fill={paint("table")} />
    <path d="M72 186Q237 217 409 185M90 163Q221 140 385 163" fill="none" stroke="#f4d7b2" strokeOpacity=".25" />
    <ellipse cx="267" cy="137" rx="156" ry="68" fill={paint("light")} />
    <ellipse cx="337" cy="158" rx="35" ry="8" fill="#795c43" opacity=".18" />
    <ellipse cx="337" cy="152" rx="26" ry="6" fill="#786c50" />
    <path d="M315 150Q337 138 359 150" fill="#b4a17c" />
    <path d="M337 145V63" fill="none" stroke="#756c51" strokeWidth="5" />
    <path d="M336 144V64" fill="none" stroke="#d4c29a" strokeWidth="1.5" />
    <path d="M329 28Q337 23 345 28L379 77Q337 88 295 77Z" fill={paint("shade")} />
    <path d="M332 29Q317 52 302 73" fill="none" stroke="#d3dfc5" strokeOpacity=".4" strokeWidth="2" />
    <ellipse cx="337" cy="77" rx="42" ry="9" fill="#35554c" />
    <ellipse cx="337" cy="77" rx="37" ry="6" fill="#f6da98" />
    <ellipse cx="337" cy="77" rx="17" ry="4" fill="#fff1c8" />
    <ellipse cx="206" cy="190" rx="119" ry="15" fill="#63432f" opacity=".18" />
    <path d="M106 94Q153 87 206 110Q251 88 300 94L321 187Q268 177 208 203Q151 181 90 188Z" fill="#725044" />
    <path d="M108 92Q151 86 206 108Q254 87 298 93L316 180L315 186Q262 178 208 197Q151 179 95 183Z" fill="#deccb0" />
    <path d="M103 173Q154 169 207 189Q264 171 312 176M99 178Q154 174 207 194Q264 176 314 181" fill="none" stroke="#baa487" strokeWidth="1" />
    <path d="M109 87Q159 84 206 105L208 190Q155 168 98 176Z" fill={paint("left-page")} />
    <path d="M206 105Q251 82 296 89L312 176Q262 167 208 190Z" fill={paint("right-page")} />
    <path d="M206 106L208 189" stroke="#b9a082" strokeWidth="1" />
    <g fill="none" stroke="#a2947b" strokeWidth="1.5" strokeLinecap="round" opacity=".75">
      <path d="M126 108Q159 108 188 120M124 117Q157 117 189 129M123 126Q157 126 189 138M122 135Q155 135 190 147M121 144Q155 144 190 156M129 155Q157 156 181 164" />
      <path d="M225 119Q253 106 281 109M225 128Q254 115 283 118M225 137Q255 124 284 127M225 146Q255 134 286 136M225 155Q255 144 287 145M233 162Q255 154 277 154" />
    </g>
    <path d="M208 190Q217 194 222 207L216 204L211 210Q212 198 205 192Z" fill="#a9573f" />
    <ellipse cx="370" cy="186" rx="35" ry="9" fill="#7b5136" opacity=".16" />
    <ellipse cx="368" cy="180" rx="32" ry="8" fill="#e6e4d4" />
    <ellipse cx="368" cy="179" rx="25" ry="5" fill="none" stroke="#b9c7ba" />
    <path d="M389 150C411 144 411 175 387 170" fill="none" stroke="#b5c5b8" strokeWidth="7" />
    <path d="M390 151C406 148 406 170 390 167" fill="none" stroke="#f4f4e7" strokeWidth="3" />
    <path d="M345 147Q345 171 353 177Q368 186 383 177Q391 170 391 147Z" fill={paint("ceramic")} />
    <ellipse cx="368" cy="147" rx="23" ry="7" fill="#f7f5e8" />
    <ellipse cx="368" cy="148" rx="19" ry="4.5" fill="#73523b" />
    <path d="M356 148Q367 143 379 148" fill="none" stroke="#bd9163" strokeWidth="1.5" />
    <path d="M352 156Q352 168 357 172" fill="none" stroke="#fffdf2" strokeWidth="2" strokeLinecap="round" opacity=".8" />
    <path d="M362 134C350 124 371 119 362 107M375 131C366 123 383 118 376 109" fill="none" stroke="#fff7e2" strokeWidth="2" strokeLinecap="round" opacity=".65" />
  </svg>;
}

export function ReadingWelcome({ open, scrolling, rtl, onDismiss, onAfterClose }: ReadingWelcomeProps) {
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
                <p>{t(scrolling ? "welcome.scroll" : rtl ? "welcome.marginsRtl" : "welcome.marginsLtr")}
                  {!scrolling && ready && preferences.enabled && <> {t(rtl ? "welcome.keysRtl" : "welcome.keysLtr")}</>}
                </p>
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
            </div>
            <p className="reading-welcome-footer">{t("welcome.reopen")}</p>
          </DialogContent>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
