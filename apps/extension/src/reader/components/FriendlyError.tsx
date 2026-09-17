import { useEffect, useRef, useState } from "react";
import type { FC } from "react";
import { Body1, Button, Caption1 } from "@fluentui/react-components";
import { BookTroubleIllustration } from "./BookTroubleIllustration.js";
import { CHROME_BORDER, CHROME_SHADOW } from "../chromeTheme.js";
import { useChromeTheme } from "../ChromeThemeContext.js";

/** How long a "transient" toast stays up before auto-dismissing itself —
 * long enough to read a short message and, if wanted, click "Copy
 * diagnostics", short enough not to linger as visual clutter over
 * content the reader has likely already resumed reading (the previous
 * chapter is still shown underneath — see `ReaderSnapshot.errorSeverity`'s
 * doc comment). */
const TRANSIENT_AUTO_DISMISS_MS = 8000;

export interface FriendlyErrorProps {
  message: string;
  /** "blocking" shows the full illustrated card (nothing else is on
   * screen to read); "transient" shows a small, quieter toast in the
   * corner, since the reader still has their previous page in front of
   * them and isn't actually stuck — see issue #27: these two situations
   * shouldn't look equally alarming. */
  severity: "blocking" | "transient";
  onDismiss: () => void;
  /** Returns the current diagnostics trail (see `DiagnosticsLog`) plus
   * basic reader state, ready to copy to the clipboard — `undefined` if
   * there's genuinely nothing to copy yet. */
  getDiagnosticsText: () => string | undefined;
}

/**
 * The reader's one error presentation, in two sizes — see `severity`.
 * Always shows the *actual* underlying message directly (never hidden
 * behind a click: per explicit product direction, "tell the user
 * directly if there's something actionable without making them click on
 * more"), but leads with a friendly illustration/headline rather than a
 * bare stack trace, and always offers a "Copy diagnostics" button for
 * anything worth debugging further.
 */
export const FriendlyError: FC<FriendlyErrorProps> = ({
  message,
  severity,
  onDismiss,
  getDiagnosticsText,
}) => {
  const chromeTheme = useChromeTheme();
  const [copied, setCopied] = useState(false);
  const headingRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (severity !== "transient") {
      return;
    }
    const timeout = setTimeout(onDismiss, TRANSIENT_AUTO_DISMISS_MS);
    return () => clearTimeout(timeout);
    // `onDismiss` is a stable callback (see its callers) — only
    // `severity` changing (a fresh error) should re-arm the timer.
  }, [severity]);

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
          <Body1 as="p" style={{ margin: 0, fontWeight: 600 }}>
            Oh rats, something went wrong.
          </Body1>
        </div>
        <Caption1 as="p" style={{ margin: 0, maxWidth: 360, opacity: 0.75 }}>
          {message}
        </Caption1>
        <Button appearance="outline" size="small" onClick={copyDiagnostics}>
          {copied ? "Copied!" : "Copy diagnostics"}
        </Button>
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
      <Body1 as="p" style={{ margin: 0 }}>
        Hmm, that didn't quite work: {message}
      </Body1>
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
