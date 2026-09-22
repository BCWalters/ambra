import { describe, expect, it } from "vitest";
import { parseSmilClockValue, SmilClockValueError } from "./SmilClockValue.js";

describe("parseSmilClockValue", () => {
  it("parses a full clock value with hours", () => {
    expect(parseSmilClockValue("0:23:23.84")).toBeCloseTo(23 * 60 + 23.84, 5);
  });

  it("parses a full clock value with a multi-digit hours component", () => {
    expect(parseSmilClockValue("02:30:03.5")).toBeCloseTo(2 * 3600 + 30 * 60 + 3.5, 5);
  });

  it("parses a partial clock value with no hours component", () => {
    expect(parseSmilClockValue("23:23.84")).toBeCloseTo(23 * 60 + 23.84, 5);
  });

  it("parses a clock value with no fractional seconds", () => {
    expect(parseSmilClockValue("0:00:05")).toBe(5);
  });

  it("parses a bare-seconds timecount value", () => {
    expect(parseSmilClockValue("5.2s")).toBeCloseTo(5.2, 5);
  });

  it("parses a milliseconds timecount value", () => {
    expect(parseSmilClockValue("200ms")).toBeCloseTo(0.2, 5);
  });

  it("parses a minutes timecount value", () => {
    expect(parseSmilClockValue("3min")).toBe(180);
  });

  it("parses an hours timecount value", () => {
    expect(parseSmilClockValue("1h")).toBe(3600);
  });

  it("treats a bare number with no unit suffix as seconds", () => {
    expect(parseSmilClockValue("42")).toBe(42);
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseSmilClockValue("  0:00:05.250  ")).toBeCloseTo(5.25, 5);
  });

  it("throws for a value with too many colon-separated components", () => {
    expect(() => parseSmilClockValue("1:2:3:4")).toThrow(SmilClockValueError);
  });

  it("throws for a value with a non-numeric component", () => {
    expect(() => parseSmilClockValue("0:0x:05")).toThrow(SmilClockValueError);
  });

  it("throws for a completely malformed value", () => {
    expect(() => parseSmilClockValue("not-a-time")).toThrow(SmilClockValueError);
  });
});
