import { useEffect, useRef, useState } from "react";
import type { FC } from "react";
import { Body1, Button, Caption1 } from "@fluentui/react-components";
import { BookTroubleIllustration } from "./BookTroubleIllustration.js";
import { CHROME_BORDER, CHROME_SHADOW } from "../chromeTheme.js";
import { useChromeTheme } from "../ChromeThemeContext.js";
import { useTranslation } from "../../i18n/LocaleContext.js";
import { ErrorDetails } from "../../components/ErrorDetails.js";

/** How long a "transient" toast stays up before auto-dismissing itself —
 * long enough to read a short message and, if wanted, click "Copy
 * diagnostics", short enough not to linger as visual clutter over
 * content the reader has likely already resumed reading (the previous
 * chapter is still shown underneath — see `ReaderSnapshot.errorSeverity`'s
 * doc comment). */
const TRANSIENT_AUTO_DISMISS_MS = 8000;

export interface FriendlyErrorProps {
  message: string;
  headline?: string;
  /** Change for a fresh notification even when its message is identical. */
  notificationId?: number;
  /** A smaller, de-emphasized technical detail (e.g. the raw underlying
   * exception message) shown below `message` for "actionFailed" errors
   * only — see issue #119: a friendly, actionable sentence should
   * always be the primary text a reader sees, with anything genuinely
   * technical demoted rather than hidden entirely. */
  detail?: string;
  /** "blocking" shows the full illustrated card (nothing else is on
   * screen to read); "transient" shows a small, quieter toast in the
   * corner, since the reader still has their previous page in front of
   * them and isn't actually stuck — see issue #27: these two situations
   * shouldn't look equally alarming. "actionFailed" is a third size in
   * between: same corner placement as "transient", but with its own
   * illustration and headline, and — critically — no auto-dismiss (see
   * issue #114). "info" is a non-error acknowledgement: same placement/
   * timing as "transient", but without its "that didn't work" framing,
   * since nothing actually failed (see issue #115). */
  severity: "blocking" | "transient" | "actionFailed" | "info";
  onDismiss: () => void;
  /** Returns the current diagnostics trail (see `DiagnosticsLog`) plus
   * basic reader state, ready to copy to the clipboard — `undefined` if
   * there's genuinely nothing to copy yet. */
  getDiagnosticsText: () => string | undefined;
}

/**
 * The reader's one error (and, for "info", non-error) presentation, in a
 * few sizes — see `severity`. Always shows the *actual* underlying
 * message directly (never hidden behind a click: per explicit product
 * direction, "tell the user directly if there's something actionable
 * without making them click on more"), but leads with a friendly
 * illustration/headline rather than a bare stack trace where one's
 * warranted, and offers a "Copy diagnostics" button for anything worth
 * debugging further.
 */
export const FriendlyError: FC<FriendlyErrorProps> = ({
  message,
  headline,
  notificationId,
  detail,
  severity,
  onDismiss,
  getDiagnosticsText,
}) => {
  const chromeTheme = useChromeTheme();
  const t = useTranslation();
  const [copied, setCopied] = useState(false);
  const headingRef = useRef<HTMLDivElement | null>(null);
  const onDismissRef = useRef(onDismiss);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (severity !== "transient" && severity !== "info") {
      return;
    }
    const timeout = setTimeout(() => onDismissRef.current(), TRANSIENT_AUTO_DISMISS_MS);
    return () => clearTimeout(timeout);
  }, [severity, message, notificationId]);


  // Moves keyboard focus onto the card itself for a "blocking" error —
  // unlike "transient" (a small toast over content that's still there
  // and still focused), a blocking error *replaces* the entire reading
  // surface, so whatever previously had focus (the content iframe, a
  // toolbar button) may no longer even exist. Without this, a keyboard
  // or screen reader user has no obvious landing spot at all. `role`
  // below (`alert`/`status`) means both cases are also announced the
  // instant they appear regardless of focus — this is the *additional*
  // step of giving a keyboard user something concrete to land on and Tab
  // onward from.
  useEffect(() => {
    if (severity === "blocking") {
      headingRef.current?.focus();
    }
  }, [severity]);

  const copyDiagnostics = (): void => {
    const text = getDiagnosticsText();
    if (!text) {
      return;
    }
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  if (severity === "blocking") {
    return (
      <div
        role="alert"
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 15,
          background: chromeTheme.backgroundSolid,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          padding: 32,
          textAlign: "center",
        }}
      >
        <BookTroubleIllustration />
        <div ref={headingRef} tabIndex={-1} style={{ outline: "none" }}>
          <Body1 as="p" block style={{ margin: 0, fontWeight: 600 }}>
            {headline ?? t("error.somethingWentWrongHeadline")}
          </Body1>
        </div>
        <ErrorDetails style={{ maxWidth: 360 }}>
          {message}
        </ErrorDetails>
        <Button appearance="outline" size="small" onClick={copyDiagnostics}>
          {copied ? "Copied!" : "Copy diagnostics"}
        </Button>
      </div>
    );
  }

  if (severity === "actionFailed") {
    return (
      <div
        role="alert"
        style={{
          position: "absolute",
          top: 64,
          right: 16,
          zIndex: 20,
          display: "flex",
          alignItems: "flex-start",
          gap: 10,
          maxWidth: 340,
          padding: "12px 14px",
          borderRadius: 10,
          background: chromeTheme.backgroundSolid,
          border: `1px solid ${CHROME_BORDER}`,
          boxShadow: CHROME_SHADOW,
        }}
      >
        <BookTroubleIllustration size={40} />
        <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <Body1 as="p" block style={{ margin: 0, fontWeight: 600 }}>
              {t("error.actionFailedHeadline")}
            </Body1>
            <Caption1 as="p" block style={{ margin: 0, opacity: 0.85 }}>
              {message}
            </Caption1>
            {detail && (
              <ErrorDetails>
                {t("error.detailsPrefix")} {detail}
              </ErrorDetails>
            )}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
            <Button appearance="outline" size="small" onClick={copyDiagnostics}>
              {copied ? "Copied!" : "Copy diagnostics"}
            </Button>
            <Button appearance="subtle" size="small" onClick={onDismiss}>
              Dismiss
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (severity === "info") {
    return (
      <div
        role="status"
        style={{
          position: "absolute",
          top: 64,
          right: 16,
          zIndex: 20,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          maxWidth: 320,
          padding: "10px 12px",
          borderRadius: 8,
          background: chromeTheme.backgroundSolid,
          border: `1px solid ${CHROME_BORDER}`,
          boxShadow: CHROME_SHADOW,
        }}
      >
        <Body1 as="p" block style={{ margin: 0 }}>
          {message}
        </Body1>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button appearance="subtle" size="small" onClick={onDismiss}>
            Dismiss
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      role="status"
      style={{
        position: "absolute",
        top: 64,
        right: 16,
        zIndex: 20,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        maxWidth: 320,
        padding: "10px 12px",
        borderRadius: 8,
        background: chromeTheme.backgroundSolid,
        border: `1px solid ${CHROME_BORDER}`,
        boxShadow: CHROME_SHADOW,
      }}
    >
      <Body1 as="p" block style={{ margin: 0 }}>
        {t("error.actionFailedHeadline")}
      </Body1>
      <ErrorDetails>{message}</ErrorDetails>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
        <Button appearance="outline" size="small" onClick={copyDiagnostics}>
          {copied ? "Copied!" : "Copy diagnostics"}
        </Button>
        <Button appearance="subtle" size="small" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    </div>
  );
};
