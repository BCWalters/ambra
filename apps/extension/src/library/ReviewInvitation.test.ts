import { describe, expect, it } from "vitest";
import { isReviewInvitationEligible, parseReviewInvitation, recordReviewReading } from "./ReviewInvitation.js";

describe("local review invitation eligibility", () => {
  const day = (date: number) => new Date(2026, 9, date, 12).getTime();

  it("requires three distinct reading days and at least half of a book", () => {
    let state = parseReviewInvitation(undefined);
    state = recordReviewReading(state, day(1), 0.5);
    for (let index = 0; index < 20; index++) state = recordReviewReading(state, day(1), 0.7);
    expect(state.days).toHaveLength(1);
    expect(isReviewInvitationEligible(state)).toBe(false);
    state = recordReviewReading(state, day(2), undefined);
    expect(isReviewInvitationEligible(state)).toBe(false);
    state = recordReviewReading(state, day(3), 0.1);
    expect(isReviewInvitationEligible(state)).toBe(true);
  });

  it("does not qualify from reading days alone or invalid percentages", () => {
    let state = parseReviewInvitation(undefined);
    for (const [index, fraction] of [0.499, undefined, NaN, Infinity, 2, -1].entries()) {
      state = recordReviewReading(state, day(index + 1), fraction);
      expect(isReviewInvitationEligible(state)).toBe(false);
      expect(state.days.length).toBeLessThanOrEqual(3);
    }
    expect(isReviewInvitationEligible(recordReviewReading(state, day(7), 0.5))).toBe(true);
  });

  it("never qualifies again or records more dates after presentation", () => {
    const state = { days: ["2026-10-01", "2026-10-02", "2026-10-03"], reachedHalf: true, presented: true };
    expect(isReviewInvitationEligible(state)).toBe(false);
    expect(recordReviewReading(state, day(4), 1)).toBe(state);
  });

  it("does not mistake duplicate dates for genuine separate days", () => {
    const state = parseReviewInvitation({ days: ["2026-10-01", "2026-10-01", "2026-10-01"],
      reachedHalf: true, presented: false });
    expect(isReviewInvitationEligible(state)).toBe(false);
  });

  it.each([null, 1, {}, { days: [], reachedHalf: "yes", presented: false },
    { days: ["yesterday"], reachedHalf: true, presented: false }])("rejects malformed storage %j explicitly", value => {
    expect(() => parseReviewInvitation(value)).toThrow("Invalid review invitation preferences.");
  });
});
