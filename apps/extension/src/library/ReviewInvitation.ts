export interface ReviewInvitationState {
  readonly days: readonly string[];
  readonly reachedHalf: boolean;
  readonly presented: boolean;
}

export const REVIEW_INVITATION_KEY = "localPrototypeReviewInvitation";

export function parseReviewInvitation(value: unknown): ReviewInvitationState {
  if (value === undefined) return { days: [], reachedHalf: false, presented: false };
  if (typeof value !== "object" || value === null ||
    !("days" in value) || !Array.isArray(value.days) || value.days.length > 3 ||
    !value.days.every((day: unknown) => typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day)) ||
    !("reachedHalf" in value) || typeof value.reachedHalf !== "boolean" ||
    !("presented" in value) || typeof value.presented !== "boolean") {
    throw new Error("Invalid review invitation preferences.");
  }
  return { days: [...new Set<string>(value.days)], reachedHalf: value.reachedHalf, presented: value.presented };
}

export function recordReviewReading(
  state: ReviewInvitationState, timestamp: number, fraction: number | undefined,
): ReviewInvitationState {
  if (state.presented) return state;
  const date = new Date(timestamp);
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return {
    days: [...new Set([...state.days, day])].slice(-3),
    reachedHalf: state.reachedHalf || (fraction !== undefined && Number.isFinite(fraction) && fraction >= 0.5 && fraction <= 1),
    presented: false,
  };
}

export function isReviewInvitationEligible(state: ReviewInvitationState): boolean {
  return !state.presented && state.days.length >= 3 && state.reachedHalf;
}
