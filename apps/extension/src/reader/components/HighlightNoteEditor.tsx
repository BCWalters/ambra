import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { FC } from "react";
import { Button, Textarea } from "@fluentui/react-components";
import { useTranslation } from "../../i18n/LocaleContext.js";
import { describeStorageError } from "../../StorageErrors.js";

export interface HighlightNoteEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** An empty draft clears an existing note, but cannot add a new empty note. */
  hasExistingNote: boolean;
  /** Failures are reported by the caller; false retains the editable draft. */
  onSave: (note: string | undefined) => Promise<boolean>;
  onSaved: () => void;
  onCancel: () => void;
  autoFocus?: boolean;
  rows?: number;
}

/** Controlled draft, with one persistence lifecycle shared by the panel and popup. */
export const HighlightNoteEditor: FC<HighlightNoteEditorProps> = ({
  value,
  onChange,
  hasExistingNote,
  onSave,
  onSaved,
  onCancel,
  autoFocus = false,
  rows,
}) => {
  const t = useTranslation();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const requestRef = useRef(0);
  const pendingRef = useRef(false);
  const [pending, setPending] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const errorId = useId();
  const isEmptyAddition = !hasExistingNote && value.trim() === "";

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus();
  }, [autoFocus]);

  useLayoutEffect(
    () => () => {
      requestRef.current += 1;
    },
    [],
  );

  const save = async (): Promise<void> => {
    if (pendingRef.current || isEmptyAddition) return;
    pendingRef.current = true;
    setPending(true);
    setSaveError(undefined);
    const request = ++requestRef.current;
    let saved = false;
    let failureMessage: string | undefined;
    try {
      saved = await onSave(value.trim() || undefined);
    } catch (error) {
      failureMessage = describeStorageError(error, "save", "that note");
    }
    if (request !== requestRef.current) return;
    pendingRef.current = false;
    setPending(false);
    setSaveError(failureMessage);
    if (saved) onSaved();
    else textareaRef.current?.focus({ preventScroll: true });
  };

  return (
    <div aria-busy={pending}>
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={(_event, data) => onChange(data.value)}
        placeholder={t("annotations.notePlaceholder")}
        aria-label={t("annotations.notePlaceholder")}
        aria-describedby={saveError === undefined ? undefined : errorId}
        readOnly={pending}
        resize="vertical"
        rows={rows}
        style={{ width: "100%" }}
      />
      {saveError !== undefined && (
        <div
          id={errorId}
          role="alert"
          style={{ fontSize: 12, marginTop: 6, overflowWrap: "anywhere" }}
        >
          {t("error.detailsPrefix")} {saveError}
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 6 }}>
        <Button size="small" onClick={onCancel}>
          {t("annotations.cancelNote")}
        </Button>
        <Button
          size="small"
          appearance="primary"
          disabled={pending || isEmptyAddition}
          onClick={() => void save()}
        >
          {t("annotations.saveNote")}
        </Button>
      </div>
    </div>
  );
};
