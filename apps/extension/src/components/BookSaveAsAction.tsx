import { useRef, useState, type FC, type ReactNode } from "react";
import { Button, tokens } from "@fluentui/react-components";
import { ArrowDownloadRegular } from "@fluentui/react-icons";
import { useTranslation } from "../i18n/LocaleContext.js";

export const BookSaveAsAction: FC<{
  accent: string;
  accentForeground: string;
  onSaveAs: () => Promise<void>;
  renderError: (message: string, onDismiss: () => void) => ReactNode;
}> = ({ accent, accentForeground, onSaveAs, renderError }) => {
  const t = useTranslation();
  const busy = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const save = async () => {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    setError(undefined);
    try {
      await onSaveAs();
    } catch (cause) {
      setError(t("library.saveAsFailed", { message: cause instanceof Error ? cause.message : String(cause) }));
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };
  return (
    <div style={{ marginTop: -8, marginBottom: 12 }}>
      <Button
        appearance="secondary"
        size="small"
        icon={<ArrowDownloadRegular style={{ fontSize: 14 }} />}
        disabled={saving}
        disabledFocusable={saving}
        onClick={() => void save()}
        style={{
          minWidth: 0,
          minHeight: 24,
          padding: "2px 6px",
          fontSize: tokens.fontSizeBase200,
          lineHeight: tokens.lineHeightBase200,
          fontWeight: tokens.fontWeightRegular,
          color: saving ? undefined : accentForeground,
          borderColor: saving ? undefined : accent,
          background: saving ? undefined : `color-mix(in srgb, ${accent} 12%, transparent)`,
        }}
      >
        {t("library.saveAs")}
      </Button>
      {error && renderError(error, () => setError(undefined))}
    </div>
  );
};
