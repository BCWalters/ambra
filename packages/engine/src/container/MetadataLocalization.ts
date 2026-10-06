export interface MetadataTextContext {
  readonly direction: "ltr" | "rtl" | "auto";
  readonly language: string | undefined;
}

export interface LocalizedMetadataValue extends MetadataTextContext {
  readonly key: string;
  readonly value: string;
  readonly id: string | undefined;
  readonly refines: string | undefined;
  readonly preferred: boolean;
}

export interface MetadataLocalization {
  readonly package: MetadataTextContext;
  readonly dcValues: readonly LocalizedMetadataValue[];
  readonly metaValues: readonly LocalizedMetadataValue[];
}

/** Indices refer to nonempty values of this DC element, before UI filtering.
 * This distinguishes identical creator/identifier text with different contexts. */
export function metadataTextContext(
  localization: MetadataLocalization | undefined,
  key: string,
  value: string | undefined,
  index?: number,
): MetadataTextContext | undefined {
  if (value === undefined || !localization) return undefined;
  const entries = localization.dcValues.filter(entry => entry.key === key);
  const entry = index === undefined
    ? entries.find(entry => entry.preferred && entry.value === value) ?? entries.find(entry => entry.value === value)
    : entries[index];
  return entry?.value === value ? entry : undefined;
}

export function metadataPropertyContext(
  localization: MetadataLocalization | undefined,
  key: string,
  value: string | undefined,
): MetadataTextContext | undefined {
  return localization?.metaValues.find(entry => entry.key === key && entry.value === value);
}
