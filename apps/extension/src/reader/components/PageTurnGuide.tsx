import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { Button } from "@fluentui/react-components";
import { ArrowLeftRegular, ArrowRightRegular, DismissRegular } from "@fluentui/react-icons";
import { useTranslation } from "../../i18n/LocaleContext.js";
import { useChromeTheme } from "../ChromeThemeContext.js";
import type { ReaderController } from "../ReaderController.js";
import type { PageTurnGuideGeometry } from "../PageTurnGuide.js";
import { usePrefersReducedMotion } from "../usePrefersReducedMotion.js";
import "./PageTurnGuide.css";

const FADE_DURATION_MS = 240;

export function PageTurnGuide({ controller, hidden }: {
  controller: Pick<ReaderController, "subscribe" | "snapshot" | "subscribeNavigation" | "pageTurnGuideGeometry" | "restoreContentFocus">;
  hidden: boolean;
}) {
  const t = useTranslation();
  const palette = useChromeTheme();
  const reducedMotion = usePrefersReducedMotion();
  const [phase, setPhase] = useState<"active" | "exiting" | "finished">("active");
  const [geometry, setGeometry] = useState<PageTurnGuideGeometry>();
  const [rtl, setRtl] = useState(false);
  const [highlight, setHighlight] = useState(true);

  const dismiss = useCallback(() => {
    setPhase(current => current === "active" ? hidden || reducedMotion ? "finished" : "exiting" : current);
  }, [hidden, reducedMotion]);
  const dismissTip = () => {
    dismiss();
    controller.restoreContentFocus();
  };
  useEffect(() => controller.subscribeNavigation(dismiss), [controller, dismiss]);
  useEffect(() => {
    if (phase !== "exiting") return;
    if (hidden || reducedMotion) {
      setPhase("finished");
      return;
    }
    const timer = window.setTimeout(() => setPhase("finished"), FADE_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [phase, hidden, reducedMotion]);
  useEffect(() => {
    const timer = window.setTimeout(() => setHighlight(false), 3000);
    return () => window.clearTimeout(timer);
  }, []);
  useLayoutEffect(() => {
    if (phase !== "active" || hidden) return;
    const measure = () => {
      setGeometry(controller.pageTurnGuideGeometry());
      setRtl(controller.snapshot().pageProgressionDirection === "rtl");
    };
    measure();
    const unsubscribe = controller.subscribe(measure);
    window.addEventListener("resize", measure);
    return () => { unsubscribe(); window.removeEventListener("resize", measure); };
  }, [controller, hidden, phase]);

  if (phase === "finished" || hidden || !geometry) return null;
  const preferredSide = rtl ? "left" : "right";
  const tipSide = (rtl ? geometry.leftWidth : geometry.rightWidth) > 0 ? preferredSide : rtl ? "right" : "left";
  const marginWidth = tipSide === "left" ? geometry.leftWidth : geometry.rightWidth;
  const anchor = tipSide === "left" ? geometry.left + marginWidth / 2 : geometry.right - marginWidth / 2;
  const tipWidth = Math.min(280, Math.max(0, geometry.right - geometry.left - 32));
  const tipLeft = Math.max(geometry.left + 16,
    Math.min(geometry.right - 16 - tipWidth, tipSide === "left" ? anchor + 20 : anchor - 20 - tipWidth));
  return <div className="page-turn-guide" data-testid="page-turn-guide"
    data-phase={phase === "exiting" ? "exiting" : highlight && !reducedMotion ? "highlight" : "indicators"}
    inert={phase === "exiting"}
    style={{ color: palette.accentForeground, transitionDuration: reducedMotion ? "0ms" : `${FADE_DURATION_MS}ms` }}>
    {(["left", "right"] as const).map(side => {
      const width = side === "left" ? geometry.leftWidth : geometry.rightWidth;
      if (width <= 0) return null;
      const next = side === (rtl ? "left" : "right");
      const label = t(next ? "pageTurnGuide.next" : "pageTurnGuide.previous");
      return <div key={side} className="page-turn-guide-margin" data-side={side}
        data-direction={next ? "next" : "previous"} aria-hidden="true"
        style={{
          left: side === "left" ? geometry.left : geometry.right - width,
          top: geometry.top, width, height: geometry.height,
        }}>
        <div className="page-turn-guide-wash" />
        {width >= 18 && <div className="page-turn-guide-indicator" style={{ background: palette.backgroundSolid }}>
          {side === "left" ? <ArrowLeftRegular /> : <ArrowRightRegular />}
          {width >= 120 && <span>{label}</span>}
        </div>}
      </div>;
    })}
    {marginWidth > 0 && tipWidth > 0 && <div className="page-turn-guide-tip" data-tip-side={tipSide}
      style={{ left: tipLeft, top: geometry.top + geometry.height / 2, width: tipWidth,
        color: palette.text, background: palette.backgroundSolid, borderColor: palette.border, boxShadow: palette.shadow }}>
      <p role="status" style={{ maxHeight: Math.max(32, geometry.height - 56) }}>{t("pageTurnGuide.instructions")}</p>
      <Button appearance="subtle" size="small" icon={<DismissRegular />} aria-label={t("pageTurnGuide.dismiss")}
        disabled={phase !== "active"} onPointerDown={event => event.stopPropagation()}
        onClick={event => { event.stopPropagation(); dismissTip(); }}
        onKeyDown={event => {
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); dismissTip(); }
        }} />
    </div>}
  </div>;
}
