export interface RequiredNativeCriterion {
  readonly id: string;
  readonly kind: "document" | "math" | "svg" | "media" | "rejection";
}
export const requiredNativeCriteria: readonly RequiredNativeCriterion[];
export const requiredFoundationCriteria: readonly import("./epub-conformance-foundations.mjs").FoundationCriterion[];
export function isRequiredNativeCriterion(value: unknown): value is RequiredNativeCriterion;
export function isRequiredNativeId(value: unknown): value is string;
export function requiredNativeVerdict(
  observations: unknown,
  criterion: RequiredNativeCriterion,
): boolean;
