import { describe, expect, it } from "vitest";
import {
  formatDurationShort,
  parseDuration,
  parseEstimate,
  parseTimeOfDay,
} from "./time";

const HOUR = 3_600_000;
const MINUTE = 60_000;

describe("parseDuration", () => {
  // The four ways CLAUDE.md says a clock can be typed over. They all read —
  // they don't all mean the same thing: a bare number is minutes, so `90` is
  // an hour and a half rather than ninety of anything else.
  it("reads a clock, an estimate and a bare number", () => {
    expect(parseDuration("1:00")).toBe(HOUR);
    expect(parseDuration("1:00:00")).toBe(HOUR);
    expect(parseDuration("1h")).toBe(HOUR);
    expect(parseDuration("45m")).toBe(45 * MINUTE);
    expect(parseDuration("90")).toBe(90 * MINUTE);
  });

  it("keeps the seconds when they're given", () => {
    expect(parseDuration("1:30:15")).toBe(HOUR + 30 * MINUTE + 15_000);
  });

  // Zero is a real answer here and not to `parseEstimate` — clearing a day's
  // time is a thing you might mean.
  it("takes zero, where an estimate won't", () => {
    expect(parseDuration("0")).toBe(0);
    expect(parseEstimate("0")).toBeNull();
  });

  it("is null for anything it can't read, so the caller leaves it alone", () => {
    expect(parseDuration("later")).toBeNull();
    expect(parseDuration("")).toBeNull();
    expect(parseDuration("1:75")).toBeNull();
  });
});

describe("parseEstimate", () => {
  it("reads the forms an estimate is written in", () => {
    expect(parseEstimate("1h 30m")).toBe(HOUR + 30 * MINUTE);
    expect(parseEstimate("2h")).toBe(2 * HOUR);
    expect(parseEstimate("45m")).toBe(45 * MINUTE);
    expect(parseEstimate("90")).toBe(90 * MINUTE);
    expect(parseEstimate("~45m")).toBe(45 * MINUTE);
  });

  it("is null for empty and for garbage", () => {
    expect(parseEstimate("")).toBeNull();
    expect(parseEstimate("soon")).toBeNull();
  });

  // The claim in time.ts:41 — every string `formatDurationShort` writes reads
  // back to the figure it was given. True for whole minutes of a minute or
  // more; below that it writes `< 1m` and at zero `0m`, neither of which is a
  // number, which is the point of them.
  it("round-trips whatever formatDurationShort writes", () => {
    for (const ms of [
      MINUTE,
      45 * MINUTE,
      HOUR,
      HOUR + 30 * MINUTE,
      2 * HOUR,
      7 * HOUR + 14 * MINUTE,
    ]) {
      expect(parseEstimate(formatDurationShort(ms))).toBe(ms);
    }
    expect(parseEstimate(formatDurationShort(30_000))).toBeNull();
    expect(parseEstimate(formatDurationShort(0))).toBeNull();
  });
});

describe("parseTimeOfDay", () => {
  const dayStart = new Date(2026, 2, 12).getTime();
  const at = (hours: number, minutes = 0) =>
    new Date(2026, 2, 12, hours, minutes).getTime();

  it("reads the loose forms", () => {
    expect(parseTimeOfDay("15:25", dayStart)).toBe(at(15, 25));
    expect(parseTimeOfDay("1525", dayStart)).toBe(at(15, 25));
    expect(parseTimeOfDay("9.05", dayStart)).toBe(at(9, 5));
    expect(parseTimeOfDay("3:05 pm", dayStart)).toBe(at(15, 5));
    expect(parseTimeOfDay("9", dayStart)).toBe(at(9));
  });

  it("refuses a time that isn't one", () => {
    expect(parseTimeOfDay("25:00", dayStart)).toBeNull();
    expect(parseTimeOfDay("13:00 pm", dayStart)).toBeNull();
    expect(parseTimeOfDay("noon", dayStart)).toBeNull();
  });
});
