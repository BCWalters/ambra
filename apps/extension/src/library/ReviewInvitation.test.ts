import { describe, expect, it } from "vitest";
import { answerReviewInvitation, isReviewInvitationEligible, parseReviewInvitation, recordReviewReading,
  REVIEW_REMINDER_DELAY } from "./ReviewInvitation.js";

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

  it("respects the permanent flag from earlier local previews", () => {
    const state = { days: ["2026-10-01", "2026-10-02", "2026-10-03"], reachedHalf: true, presented: true };
    expect(isReviewInvitationEligible(state)).toBe(false);
    expect(recordReviewReading(state, day(4), 1)).toBe(state);
  });

  it.each(["yes", "no"] as const)("never prompts again after %s, even without following the link", answer => {
    const state = answerReviewInvitation({ days: ["2026-10-01", "2026-10-02", "2026-10-03"],
      reachedHalf: true, presented: false }, answer, day(4));
    expect(isReviewInvitationEligible(state, day(30))).toBe(false);
    expect(answerReviewInvitation(state, "later", day(10))).toBe(state);
    expect(recordReviewReading(state, day(5), 0.9)).toBe(state);
  });

  it("waits exactly three days after not sure yet and preserves the deadline while reading", () => {
    const now = day(4);
    const state = answerReviewInvitation({ days: ["2026-10-01", "2026-10-02", "2026-10-03"],
      reachedHalf: true, presented: false }, "later", now);
    expect(state.nextPromptAt).toBe(now + REVIEW_REMINDER_DELAY);
    const afterReading = recordReviewReading(state, day(5), 0.8);
    expect(afterReading.nextPromptAt).toBe(state.nextPromptAt);
    expect(isReviewInvitationEligible(afterReading, now + REVIEW_REMINDER_DELAY - 1)).toBe(false);
    expect(isReviewInvitationEligible(afterReading, now + REVIEW_REMINDER_DELAY)).toBe(true);
    expect(parseReviewInvitation(state)).toEqual(state);
  });

  it("does not mistake duplicate dates for genuine separate days", () => {
    const state = parseReviewInvitation({ days: ["2026-10-01", "2026-10-01", "2026-10-01"],
      reachedHalf: true, presented: false });
    expect(isReviewInvitationEligible(state)).toBe(false);
  });

  it.each([null, 1, {}, { days: [], reachedHalf: "yes", presented: false },
    { days: ["yesterday"], reachedHalf: true, presented: false },
    ...[-1, NaN, Infinity, "tomorrow", null].map(nextPromptAt =>
      ({ days: [], reachedHalf: false, presented: false, nextPromptAt })),
  ])("rejects malformed storage %j explicitly", value => {
    expect(() => parseReviewInvitation(value)).toThrow("Invalid review invitation preferences.");
  });
});
