export interface FoundationCriterion {
  readonly id: string;
  readonly kind: "package" | "navigation" | "roll";
}
export function isFoundationCriterion(value: unknown): value is FoundationCriterion;
export function isFoundationId(value: unknown): value is string;
export function foundationVerdict(observations: unknown, criterion: FoundationCriterion): boolean;
