import { useEffect, useState } from "react";
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

export interface GoToDialogProps {
  /** Which flavor of "go to" this dialog is currently showing — a
   * single component handles both rather than two near-identical ones,
   * since the only real difference is the input's valid range and how
   * its value maps to a seek fraction. */
  mode: "page" | "percentage";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The book's total page count, once `BookPaginationEstimator` has
   * measured it — only meaningful for `mode: "page"`. `undefined` means
   * "not yet known," in which case the dialog explains that rather than
   * accepting a page number it can't actually resolve. */
  bookPageCount: number | undefined;
  onGo: (fraction: number) => void;
}

/** A small dialog for jumping straight to a book-wide page number or a
 * percentage through the book — the "Go to Page…"/"Go to Percentage…"
 * actions in the Book Details panel (originally the toolbar's Navigate
 * menu — see issue #23 — relocated when that menu was removed as
 * redundant screen-clutter). Both reduce to
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
  bookPageCount,
  onGo,
}) => {
  const [value, setValue] = useState("");

  // A fresh, empty input every time the dialog opens — never pre-filled
  // with whatever was last typed (in this mode or the other one), which
  // would read as a stale, possibly-invalid suggestion.
  useEffect(() => {
    if (open) {
      setValue("");
    }
  }, [open, mode]);

  const isPage = mode === "page";
  const max = isPage ? bookPageCount : 100;
  const parsed = Number.parseInt(value, 10);
  const isValid =
    value.trim() !== "" && Number.isFinite(parsed) && parsed >= 1 && (max === undefined || parsed <= max);

  const submit = (): void => {
    if (!isValid || max === undefined) {
      return;
    }
    onGo(parsed / max);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(_event, data) => onOpenChange(data.open)}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{isPage ? "Go to Page" : "Go to Percentage"}</DialogTitle>
          <DialogContent>
            {isPage && bookPageCount === undefined ? (
              <Field validationMessage="Still measuring this book's page count — try again in a moment.">
                <Input disabled value="" />
              </Field>
            ) : (
              <Field
                label={isPage ? `Page number (1–${bookPageCount})` : "Percentage (1–100)"}
                validationMessage={
                  value.trim() !== "" && !isValid
                    ? `Enter a number between 1 and ${max}.`
                    : undefined
                }
              >
                <Input
                  type="number"
                  min={1}
                  max={max}
                  value={value}
                  onChange={(_event, data) => setValue(data.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      submit();
                    }
                  }}
                  autoFocus
                />
              </Field>
            )}
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button appearance="primary" disabled={!isValid} onClick={submit}>
              Go
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
};
