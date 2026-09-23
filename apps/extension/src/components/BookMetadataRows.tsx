import type { FC } from "react";
import { Body1, Caption1 } from "@fluentui/react-components";

interface BookDetailRowProps {
  label?: string | undefined;
  value: string | undefined;
  compact?: boolean;
}

export const BookDetailRow: FC<BookDetailRowProps> = ({ label, value, compact }) => {
  if (!value) return null;
  return (
    <div style={{ marginBottom: compact ? 4 : 12, marginTop: compact ? 6 : 0, overflowWrap: "anywhere" }}>
      {label && (
        <Caption1 as="p" block style={{ margin: "0 0 2px", opacity: 0.75 }}>
          {label}
        </Caption1>
      )}
      <Body1 as="p" block style={{ margin: 0, whiteSpace: "pre-wrap" }}>
        {value}
      </Body1>
    </div>
  );
};

export const BookRightsRow: FC<{ label: string; value: string | undefined }> = ({ label, value }) => (
  <BookDetailRow
    label={value && /^copyright\b/i.test(value.trim()) ? undefined : label}
    value={value}
    compact
  />
);
