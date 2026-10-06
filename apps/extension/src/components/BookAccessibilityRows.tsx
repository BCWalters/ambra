import { Caption1 } from "@fluentui/react-components";
import type { FC } from "react";
import type { AccessibilityMetadata, MetadataLocalization } from "@ambra/engine";
import { metadataPropertyContext } from "@ambra/engine";
import { useTranslation, type Translate } from "../i18n/LocaleContext.js";
import { BookDetailRow } from "./BookMetadataRows.js";

export const BookAccessibilityRows: FC<{
  metadata: AccessibilityMetadata | undefined;
  localization?: MetadataLocalization | undefined;
}> = ({ metadata, localization }) => {
  const t = useTranslation();
  const declarations =
    metadata?.declarations ??
    localization?.metaValues.filter(
      (entry) =>
        entry.key.startsWith("schema:access") ||
        entry.key.startsWith("a11y:") ||
        entry.key === "dcterms:conformsTo",
    ) ??
    [];
  const fields: readonly {
    property: string;
    label: Parameters<Translate>[0];
    legacy: readonly string[] | undefined;
  }[] = [
    {
      property: "schema:accessibilitySummary",
      label: "bookDetails.accessibilitySummary",
      legacy: metadata?.accessibilitySummary ? [metadata.accessibilitySummary] : [],
    },
    {
      property: "schema:accessMode",
      label: "bookDetails.a11yAccessModes",
      legacy: metadata?.accessModes,
    },
    {
      property: "schema:accessModeSufficient",
      label: "bookDetails.a11ySufficient",
      legacy: metadata?.accessModeSufficient,
    },
    {
      property: "schema:accessibilityFeature",
      label: "bookDetails.accessibilityFeatures",
      legacy: metadata?.accessibilityFeatures,
    },
    {
      property: "schema:accessibilityHazard",
      label: "bookDetails.a11yHazards",
      legacy: metadata?.accessibilityHazards,
    },
    {
      property: "dcterms:conformsTo",
      label: "bookDetails.a11yConformance",
      legacy: metadata?.conformsTo,
    },
    {
      property: "a11y:certifiedBy",
      label: "bookDetails.a11yCertifier",
      legacy: metadata?.certifiedBy,
    },
    {
      property: "a11y:certificationDate",
      label: "bookDetails.a11yDate",
      legacy: metadata?.certificationDates,
    },
    {
      property: "a11y:certifierCredential",
      label: "bookDetails.a11yCredential",
      legacy: metadata?.certifierCredentials,
    },
    {
      property: "a11y:certifierReport",
      label: "bookDetails.a11yReport",
      legacy: metadata?.certifierReports,
    },
    {
      property: "a11y:contactEmail",
      label: "bookDetails.a11yContact",
      legacy: metadata?.contactEmails,
    },
  ];
  const rows = fields.flatMap((field) => {
    const values = declarations.filter((entry) => entry.key === field.property);
    const entries = values.length
      ? values
          .filter((entry) => !entry.refines)
          .map((entry) => ({ ...field, value: entry.value, context: entry }))
      : (field.legacy ?? []).map((value) => ({
          ...field,
          value,
          context: metadataPropertyContext(localization, field.property, value),
        }));
    if (
      !["schema:accessMode", "schema:accessibilityFeature", "schema:accessibilityHazard"].includes(
        field.property,
      )
    )
      return entries;
    const groups = new Map<string, (typeof entries)[number]>();
    for (const entry of entries) {
      const key = JSON.stringify([entry.context?.language, entry.context?.direction]);
      const previous = groups.get(key);
      groups.set(key, previous ? { ...entry, value: `${previous.value}, ${entry.value}` } : entry);
    }
    return [...groups.values()];
  });
  const additional = declarations.filter(
    (entry) => entry.refines || !fields.some((field) => field.property === entry.key),
  );
  return (
    <section aria-label={t("bookDetails.a11yClaims")} style={{ marginBlock: 12 }}>
      <Caption1 as="p" block style={{ margin: "0 0 8px", opacity: 0.75 }}>
        {rows.length || additional.length
          ? t("bookDetails.a11yDisclaimer")
          : metadata?.declarations !== undefined || localization !== undefined
            ? t("bookDetails.a11yMissing")
            : t("bookDetails.a11yUnavailable")}
      </Caption1>
      {rows.map((row, index) => (
        <BookDetailRow
          key={index}
          small
          label={t(row.label)}
          value={row.value}
          context={row.context}
        />
      ))}
      {additional.length > 0 && (
        <details>
          <summary>{t("bookDetails.a11yAdditional")}</summary>
          {additional.map((entry, index) => {
            const field = fields.find((field) => field.property === entry.key);
            const label = field ? t(field.label) : entry.key;
            return (
              <BookDetailRow
                key={index}
                small
                label={`${label}${entry.refines ? ` (#${entry.refines})` : ""}`}
                value={entry.value}
                context={entry}
              />
            );
          })}
        </details>
      )}
    </section>
  );
};
