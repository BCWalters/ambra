import { useContext, useEffect, useRef, useState } from "react";
import type { FC } from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
} from "@fluentui/react-components";
import { useTranslation } from "../../i18n/LocaleContext.js";
import { useChromeTheme } from "../ChromeThemeContext.js";
import { ReaderDiagnosticContext } from "../ReaderDiagnosticContext.js";
import { ariaShortcut, getCommandBindings } from "../../shortcuts/ReaderCommands.js";
import { useShortcutPreferences } from "../../shortcuts/ShortcutPreferencesContext.js";

export interface GoToDialogProps {
  /** Which flavor of "go to" this dialog is currently showing — a
   * single component handles both rather than two near-identical ones,
   * since the only real difference is the input's valid range and how
   * its value maps to a seek fraction. */
  mode: "page" | "percentage";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAfterClose?: () => void;
  /** The book's total page count, once `BookPaginationEstimator` has
   * measured it — only meaningful for `mode: "page"`. `undefined` means
   * "not yet known," in which case the dialog explains that rather than
   * accepting a page number it can't actually resolve. */
  bookPageCount: number | undefined;
  isPaginated: boolean;
  isFixedLayout: boolean;
  onGo: (fraction: number) => void | Promise<void>;
}

/** A small dialog for jumping straight to a book-wide page number or a
 * percentage through the book — the "Go to Page…"/"Go to Percentage…"
 * keyboard commands. Both reduce to
 * the exact same underlying mechanism, `ReaderController.seekToFraction`
 * (already used by `ProgressScrubber`'s drag-to-seek) — this dialog's
 * only job is turning a page number or percentage into that 0-to-1
 * fraction. Page-number-to-fraction uses the same `bookPageIndex /
 * bookPageCount` relationship `ProgressScrubber`'s own `currentFraction`
 * helper does, so typing in the page number currently displayed as
 * "Page X of Y" and the scrubber's own position always agree. */
export const GoToDialog: FC<GoToDialogProps> = ({
  mode,
  open,
  onOpenChange,
  onAfterClose,
  bookPageCount,
  isPaginated,
  isFixedLayout,
  onGo,
}) => {
  const t = useTranslation();
  const chromeTheme = useChromeTheme();
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const submitting = useRef(false);
  const opening = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreFrame = useRef<number | undefined>(undefined);
  const { preferences, platform } = useShortcutPreferences();
  const recordSurfaces = useContext(ReaderDiagnosticContext);
  useEffect(() => {
    if (!open || !recordSurfaces) return;
    recordSurfaces({ "go-to": { open: true, mode } });
    return () => recordSurfaces({ "go-to": { open: false, mode } });
  }, [open, mode, recordSurfaces]);

  // A fresh, empty input every time the dialog opens — never pre-filled
  // with whatever was last typed (in this mode or the other one), which
  // would read as a stale, possibly-invalid suggestion.
  useEffect(() => {
    opening.current++;
    submitting.current = false;
    setPending(false);
    if (open) {
      setValue("");
      setFailed(false);
    }
    return () => { opening.current++; };
  }, [open, mode]);

  useEffect(() => {
    if (open && restoreFrame.current !== undefined) {
      cancelAnimationFrame(restoreFrame.current);
      restoreFrame.current = undefined;
    }
    return () => {
      if (restoreFrame.current !== undefined) cancelAnimationFrame(restoreFrame.current);
    };
  }, [open]);

  const isPage = mode === "page";
  const knownPageCount = Number.isSafeInteger(bookPageCount) && bookPageCount! > 0 ? bookPageCount : undefined;
  // openSpineItem only honors page/fraction landing in paginated hosts.
  // Scroll mode must not masquerade as a successful percentage seek.
  const unavailable = isFixedLayout ? t("goTo.fixedLayoutUnavailable")
    : !isPaginated ? t("goTo.scrollingUnavailable")
    : isPage && knownPageCount === undefined ? t("goTo.pageCountMeasuring") : undefined;
  const max = isPage ? knownPageCount : 100;
  const parsed = Number(value);
  const isValid =
    !unavailable && /^\d+$/.test(value.trim()) && Number.isSafeInteger(parsed) && parsed >= 1 && max !== undefined && parsed <= max;

  useEffect(() => {
    if (open && !unavailable) inputRef.current?.focus();
  }, [open, mode, unavailable]);

  const submit = async (): Promise<void> => {
    if (!isValid || max === undefined || submitting.current) {
      return;
    }
    submitting.current = true;
    setPending(true);
    setFailed(false);
    const currentOpening = opening.current;
    try {
      await onGo(parsed / max);
      if (opening.current === currentOpening) onOpenChange(false);
    } catch {
      if (opening.current === currentOpening) setFailed(true);
    } finally {
      if (opening.current === currentOpening) {
        submitting.current = false;
        setPending(false);
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={(_event, data) => onOpenChange(data.open)}
      surfaceMotion={{
        onMotionFinish: (_event, data) => {
          if (data.direction !== "exit" || open) return;
          // Wait for Fluent to release its modal accessibility scope.
          restoreFrame.current = requestAnimationFrame(() => {
            restoreFrame.current = undefined;
            // A later modal may already own focus and Tabster's accessibility scope.
            if (!document.querySelector('[aria-modal="true"]')) onAfterClose?.();
          });
        },
      }}
    >
      <DialogSurface
        onKeyDown={(event) => {
          if (event.key === "Escape") event.stopPropagation();
        }}
        aria-keyshortcuts={preferences.enabled
          ? getCommandBindings(isPage ? "goToPage" : "goToPercentage", platform).map(binding => ariaShortcut(binding, platform)).join(" ")
          : undefined}
        style={{ background: chromeTheme.backgroundSolid, width: 360, maxWidth: "90vw" }}
      >
        <form noValidate onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <DialogBody>
          <DialogTitle>{isPage ? t("goTo.pageTitle") : t("goTo.percentageTitle")}</DialogTitle>
          <DialogContent>
            {unavailable ? <p role="status">{unavailable}</p> : (
              <Field
                label={
                  isPage
                    ? t("goTo.pageInputLabel", { max: knownPageCount! })
                    : t("goTo.percentageInputLabel")
                }
                validationMessage={
                  value !== "" && !isValid
                    ? t("goTo.rangeValidation", { max: max! })
                    : undefined
                }
              >
                <Input
                  type="number"
                  ref={inputRef}
                  min={1}
                  max={max}
                  step={1}
                  value={value}
                  readOnly={pending}
                  aria-disabled={pending || undefined}
                  aria-invalid={value !== "" && !isValid}
                  onChange={(_event, data) => setValue(data.value)}
                  autoFocus
                />
              </Field>
            )}
            {failed && <p role="alert">{t("goTo.seekFailed")}</p>}
          </DialogContent>
          <DialogActions>
            <Button type="button" appearance="secondary" onClick={() => onOpenChange(false)}>
              {t("annotations.cancelNote")}
            </Button>
            <Button type="submit" appearance="primary" disabled={!isValid || pending} disabledFocusable={pending}>
              {t("goTo.goButton")}
            </Button>
          </DialogActions>
        </DialogBody>
        </form>
      </DialogSurface>
    </Dialog>
  );
};
