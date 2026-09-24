import { useRef, useState } from "react";
import type { FC } from "react";
import { Body1, Caption1, Checkbox, tokens } from "@fluentui/react-components";
import { useTranslation } from "../i18n/LocaleContext.js";
import { READER_COMMANDS, formatShortcut, getCommandBindings } from "../shortcuts/ReaderCommands.js";
import { useShortcutPreferences } from "../shortcuts/ShortcutPreferencesContext.js";
import { ModalFlyout } from "./ModalFlyout.js";
import { PaneCard } from "./PaneSections.js";

export interface KeyboardShortcutsDialogProps {
  open: boolean;
  onRequestClose: () => void;
  onOutsideClick?: () => void;
  pageProgressionDirection?: "ltr" | "rtl";
  onAfterClose?: () => void;
}

export const KeyboardShortcutsDialog: FC<KeyboardShortcutsDialogProps> = ({
  open, onRequestClose, onOutsideClick, pageProgressionDirection = "ltr", onAfterClose,
}) => {
  const t = useTranslation();
  const { preferences, platform, ready, error, setPreferences } = useShortcutPreferences();
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [status, setStatus] = useState("");
  const [saveError, setSaveError] = useState(false);
  const setEnabled = async (enabled: boolean) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError(false);
    setStatus(t("shortcuts.saving"));
    try {
      await setPreferences({ enabled });
      setStatus(t("shortcuts.saved"));
    } catch {
      setStatus("");
      setSaveError(true);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <ModalFlyout
      open={open}
      title={t("shortcuts.title")}
      onRequestClose={onRequestClose}
      onOutsideClick={onOutsideClick}
      onAfterClose={onAfterClose}
      backgroundSolid={tokens.colorNeutralBackground1}
      width={440}
    >
      <div style={{ flex: 1, overflowY: "auto", padding: 20, overflowWrap: "anywhere" }}>
        <Body1 as="p" block style={{ margin: "0 0 12px" }}>{t("shortcuts.scope")}</Body1>
        <Caption1 as="p" block style={{ margin: "0 0 16px" }}>{t("shortcuts.layoutNote")}</Caption1>
        <div style={{ display: "grid", gap: 16 }}>
          {(["navigation", "reading", "help"] as const).map((group) => (
            <PaneCard key={group} title={t(`shortcuts.${group}`)}>
              <dl style={{ display: "grid", gap: 12, margin: 0 }}>
                {READER_COMMANDS.filter((command) => command.group === group).map((command) => (
                  <div key={command.id} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 12 }}>
                    <dt>{t(command.labelKey)}</dt>
                    <dd style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "start", margin: 0 }}>
                      {getCommandBindings(command.id, platform, pageProgressionDirection).map((binding, index) => (
                        <kbd key={index} style={{
                          padding: "1px 5px", borderRadius: 4, border: `1px solid ${tokens.colorNeutralStroke1}`,
                          background: tokens.colorNeutralBackground1, font: "inherit",
                        }}>{formatShortcut(binding, platform)}</kbd>
                      ))}
                    </dd>
                  </div>
                ))}
                {group === "help" && <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 12 }}>
                  <dt>{t("shortcuts.dismiss")}</dt>
                  <dd style={{ margin: 0 }}><kbd style={{ font: "inherit" }}>Escape</kbd></dd>
                </div>}
              </dl>
            </PaneCard>
          ))}
        </div>
        <Checkbox
          label={t("shortcuts.enabled")}
          checked={preferences.enabled}
          disabled={!ready}
          input={{ "aria-disabled": !ready || saving }}
          onClick={(event) => {
            if (savingRef.current) event.preventDefault();
          }}
          onChange={(_event, data) => { void setEnabled(data.checked === true); }}
          style={{ marginTop: 16 }}
        />
        {!preferences.enabled && <Caption1 as="p" block>{t("shortcuts.disabledHint")}</Caption1>}
        <Body1 as="p" block role="status" aria-live="polite" style={{ margin: "8px 0 0" }}>
          {!ready && !error ? t("shortcuts.loading") : status}
        </Body1>
        {(saveError || error) && <Body1 as="p" block role="alert">{t(saveError ? "shortcuts.saveError" : "shortcuts.loadError")}</Body1>}
      </div>
    </ModalFlyout>
  );
};
