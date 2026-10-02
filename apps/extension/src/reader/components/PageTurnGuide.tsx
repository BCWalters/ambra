import { useEffect, useLayoutEffect, useState } from "react";
import { ArrowLeftRegular, ArrowRightRegular } from "@fluentui/react-icons";
import { useTranslation } from "../../i18n/LocaleContext.js";
import { useChromeTheme } from "../ChromeThemeContext.js";
import type { ReaderController } from "../ReaderController.js";
import type { PageTurnGuideGeometry } from "../PageTurnGuide.js";
import { usePrefersReducedMotion } from "../usePrefersReducedMotion.js";
import "./PageTurnGuide.css";

export function PageTurnGuide({ controller, hidden }: {
  controller: Pick<ReaderController, "subscribe" | "snapshot" | "subscribeNavigation" | "pageTurnGuideGeometry">;
  hidden: boolean;
}) {
  const t = useTranslation();
  const palette = useChromeTheme();
  const reducedMotion = usePrefersReducedMotion();
  const [finished, setFinished] = useState(false);
  const [geometry, setGeometry] = useState<PageTurnGuideGeometry>();
  const [rtl, setRtl] = useState(false);
  const [highlight, setHighlight] = useState(true);

  useEffect(() => controller.subscribeNavigation(() => setFinished(true)), [controller]);
  useEffect(() => {
    const timer = window.setTimeout(() => setHighlight(false), 1600);
    return () => window.clearTimeout(timer);
  }, []);
  useLayoutEffect(() => {
    if (finished || hidden) return;
    const measure = () => {
      setGeometry(controller.pageTurnGuideGeometry());
      setRtl(controller.snapshot().pageProgressionDirection === "rtl");
    };
    measure();
    const unsubscribe = controller.subscribe(measure);
    window.addEventListener("resize", measure);
    return () => { unsubscribe(); window.removeEventListener("resize", measure); };
  }, [controller, hidden, finished]);

  if (finished || hidden || !geometry) return null;
  return <div className="page-turn-guide" data-testid="page-turn-guide"
    data-phase={highlight && !reducedMotion ? "highlight" : "indicators"}
    style={{ color: palette.accentForeground }}>
    <span className="page-turn-guide-announcement" role="status">{t("pageTurnGuide.instructions")}</span>
    {(["left", "right"] as const).map(side => {
      const width = side === "left" ? geometry.leftWidth : geometry.rightWidth;
      if (width < 18) return null;
      const next = side === (rtl ? "left" : "right");
      const label = t(next ? "pageTurnGuide.next" : "pageTurnGuide.previous");
      return <div key={side} className="page-turn-guide-margin" data-side={side}
        data-direction={next ? "next" : "previous"} aria-hidden="true"
        style={{
          left: side === "left" ? geometry.left : geometry.right - width,
          top: geometry.top, width, height: geometry.height,
        }}>
        <div className="page-turn-guide-wash" />
        <div className="page-turn-guide-indicator" style={{ background: palette.backgroundSolid }}>
          {side === "left" ? <ArrowLeftRegular /> : <ArrowRightRegular />}
          {width >= 120 && <span>{label}</span>}
        </div>
      </div>;
    })}
  </div>;
}
