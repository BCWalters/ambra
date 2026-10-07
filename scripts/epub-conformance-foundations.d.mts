export interface FoundationCriterion {
  readonly id: string;
  readonly kind: "package" | "navigation" | "roll";
}
export function isFoundationCriterion(value: unknown): value is FoundationCriterion;
export function isFoundationId(value: unknown): value is string;
export function foundationVerdict(observations: unknown, criterion: FoundationCriterion): boolean;
export interface PaintRectangle {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
export function rollImageHitPoint(geometry: {
  readonly frame: PaintRectangle;
  readonly image: PaintRectangle;
  readonly clip: PaintRectangle;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly clientWidth: number;
  readonly clientHeight: number;
}): {
  readonly viewport: { readonly x: number; readonly y: number };
  readonly document: { readonly x: number; readonly y: number };
} | null;
