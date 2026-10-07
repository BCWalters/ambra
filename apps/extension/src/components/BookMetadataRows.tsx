import { useId, useMemo, useState, type CSSProperties, type FC } from "react";
import { Body1, Body1Strong, Button, Caption1 } from "@fluentui/react-components";
import { useTranslation } from "../i18n/LocaleContext.js";
import { metadataTextAttributes, metadataTextSummary, type MetadataTextKind } from "../MetadataText.js";
import type { MetadataTextContext } from "@ambra/engine";
import { PaneCard } from "./PaneSections.js";

export const BookDescription: FC<{
  value: string;
  sourceName?: string | undefined;
  sourceUrl?: string | undefined;
  context?: MetadataTextContext | undefined;
}> = ({ value, sourceName, sourceUrl, context }) => {
  const t = useTranslation();
  return (
    <PaneCard title={t("inspector.description")}>
      <BookMetadataText value={value} context={context} name={t("inspector.description")} kind="description" small style={{ lineHeight: 1.5 }} />
      {sourceName && (
        <Caption1 as="p" block style={{ margin: "8px 0 0", opacity: 0.75, overflowWrap: "anywhere" }}>
          {t("bookDetails.descriptionSourcePrefix")}{" "}
          <a href={sourceUrl} target="_blank" rel="noreferrer">{sourceName}</a>
        </Caption1>
      )}
    </PaneCard>
  );
};

export const BookMetadataText: FC<{
  value: string;
  name?: string | undefined;
  kind?: MetadataTextKind;
  small?: boolean;
  heading?: boolean;
  style?: CSSProperties;
  context?: MetadataTextContext | undefined;
}> = ({ value, name, kind = "detail", small, heading, style, context }) => {
  const t = useTranslation();
  const id = useId();
  const summary = useMemo(() => heading
    ? { preview: value, expanded: value }
    : metadataTextSummary(value, kind), [value, kind, heading]);
  const [expandedValue, setExpandedValue] = useState<string>();
  const expanded = expandedValue === value;
  const ValueText = heading ? Body1Strong : small ? Caption1 : Body1;
  if (!summary.preview) return null;
  const action = t(expanded ? "bookDetails.showLess" : "bookDetails.showMore");
  return (
    <>
      <ValueText
        id={id}
        as={heading ? "h2" : "p"}
        block
        {...metadataTextAttributes(context, { margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere", ...style })}
      >
        {expanded ? summary.expanded : summary.preview}
      </ValueText>
      {summary.preview !== summary.expanded && (
        <Button
          appearance="subtle"
          size="small"
          aria-label={name ? `${action}: ${name}` : action}
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpandedValue(expanded ? undefined : value)}
          style={{ paddingInline: 0, minWidth: 0 }}
        >
          {action}
        </Button>
      )}
    </>
  );
};

interface BookDetailRowProps {
  label?: string | undefined;
  value: string | undefined;
  compact?: boolean;
  small?: boolean;
  kind?: MetadataTextKind;
  name?: string | undefined;
  context?: MetadataTextContext | undefined;
}

export const BookDetailRow: FC<BookDetailRowProps> = ({ label, value, compact, small, kind, name, context }) => {
  if (!value) return null;
  return (
    <div style={{ marginBottom: compact ? 4 : 12, marginTop: compact ? 6 : 0, overflowWrap: "anywhere" }}>
      {label && (
        <Caption1 as="p" block style={{ margin: "0 0 2px", opacity: 0.75, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {label}
        </Caption1>
      )}
      <BookMetadataText value={value} context={context} name={name ?? label} {...(kind ? { kind } : {})} {...(small ? { small } : {})} />
    </div>
  );
};

export const BookRightsRow: FC<{ label: string; value: string | undefined; context?: MetadataTextContext | undefined }> = ({ label, value, context }) => (
  <BookDetailRow
    label={label}
    value={value}
    context={context}
    kind="rights"
    name={label}
    compact
    small
  />
);
