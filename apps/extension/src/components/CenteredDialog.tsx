import { useEffect, useId, useLayoutEffect, useRef, type FC, type ReactNode } from "react";
import { Button, Dialog, DialogBody, DialogContent, DialogSurface, DialogTitle } from "@fluentui/react-components";
import { DismissRegular } from "@fluentui/react-icons";
import { useTranslation } from "../i18n/LocaleContext.js";
import { captureFocusReturn } from "./useHelpDialogs.js";

export interface CenteredDialogProps {
  open: boolean;
  title: string;
  children: ReactNode;
  onRequestClose: () => void;
  onOutsideClick?: (() => void) | undefined;
  onAfterClose?: (() => void) | undefined;
  onAfterOpen?: (() => void) | undefined;
}

/** Fluent owns modality and focus trapping; return focus after its exit motion, including pointer dismissal. */
export const CenteredDialog: FC<CenteredDialogProps> = ({
  open, title, children, onRequestClose, onOutsideClick, onAfterClose, onAfterOpen,
}) => {
  const t = useTranslation();
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const focusReturn = useRef<(() => void) | undefined>(undefined);
  const restoreFrame = useRef<number | undefined>(undefined);
  const closeCompleted = useRef(true);
  const callbacks = useRef({ open, onAfterOpen, onAfterClose });
  callbacks.current = { open, onAfterOpen, onAfterClose };
  useLayoutEffect(() => {
    if (!open) return;
    if (restoreFrame.current !== undefined) cancelAnimationFrame(restoreFrame.current);
    // Capture before Fluent's passive opening effect moves focus into the dialog.
    focusReturn.current = captureFocusReturn();
    closeCompleted.current = false;
  }, [open]);
  useEffect(() => () => {
    if (restoreFrame.current !== undefined) cancelAnimationFrame(restoreFrame.current);
  }, []);
  useEffect(() => {
    if (open) {
      closeRef.current?.focus({ preventScroll: true });
      callbacks.current.onAfterOpen?.();
    }
  }, [open]);
  return (
    <Dialog open={open} surfaceMotion={{ onMotionFinish: (_event, data) => {
      if (data.direction !== "exit" || callbacks.current.open || closeCompleted.current) return;
      closeCompleted.current = true;
      // The modal scope is removed after the motion callback returns.
      restoreFrame.current = requestAnimationFrame(() => {
        restoreFrame.current = undefined;
        if (!callbacks.current.open) (callbacks.current.onAfterClose ?? focusReturn.current)?.();
      });
    } }} onOpenChange={(_event, data) => {
      if (!data.open) {
        if (data.type === "backdropClick" && onOutsideClick) onOutsideClick();
        else onRequestClose();
      }
    }}>
      <DialogSurface
        aria-labelledby={titleId}
        onKeyDown={(event) => { if (event.key === "Escape") event.stopPropagation(); }}
        style={{ width: 560, maxWidth: "calc(100vw - 24px)", maxHeight: "calc(100dvh - 24px)",
          padding: 16, boxSizing: "border-box" }}>
        <DialogBody style={{ minHeight: 0 }}>
          <DialogTitle id={titleId} action={
            <Button ref={closeRef} appearance="subtle" icon={<DismissRegular />} aria-label={t("highlight.close")} onClick={onRequestClose} />
          }>{title}</DialogTitle>
          <DialogContent style={{ minHeight: 0, overflowY: "auto", overflowWrap: "anywhere" }}>
            {children}
          </DialogContent>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
};
