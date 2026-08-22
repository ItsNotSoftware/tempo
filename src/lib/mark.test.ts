import { describe, expect, it } from "vitest";
import { DRAIN_STEPS, drainBucket, fillExtent } from "./mark";

describe("fillExtent", () => {
  // Untouched: the top chamber is entirely sand, the bottom entirely glass.
  it("starts full at the top and empty at the bottom", () => {
    expect(fillExtent(0, true)).toEqual({ from: 0, to: 1 });
    expect(fillExtent(0, false)).toEqual({ from: 1, to: 1 });
  });

  // Over: the top has nothing left, the bottom is entirely sand.
  it("reads fully drained the other way round at progress 1", () => {
    expect(fillExtent(1, true)).toEqual({ from: 0, to: 0 });
    expect(fillExtent(1, false)).toEqual({ from: 0, to: 1 });
  });

  it("the top shrinks toward its neck as progress climbs", () => {
    const early = fillExtent(0.2, true);
    const late = fillExtent(0.8, true);
    expect(late.to).toBeLessThan(early.to);
    expect(early.from).toBe(0);
    expect(late.from).toBe(0);
  });

  it("the bottom grows toward its neck as progress climbs", () => {
    const early = fillExtent(0.2, false);
    const late = fillExtent(0.8, false);
    expect(late.from).toBeLessThan(early.from);
    expect(early.to).toBe(1);
    expect(late.to).toBe(1);
  });

  // A group over its own estimate, or a task that's run long past a short
  // one, can hand this a figure past 1 — the chamber still has to be a real
  // shape, not a negative-height one.
  it("clamps progress to 0..1", () => {
    expect(fillExtent(-0.4, true)).toEqual(fillExtent(0, true));
    expect(fillExtent(1.7, true)).toEqual(fillExtent(1, true));
    expect(fillExtent(-0.4, false)).toEqual(fillExtent(0, false));
    expect(fillExtent(1.7, false)).toEqual(fillExtent(1, false));
  });
});

describe("drainBucket", () => {
  // No estimate at all means there's no progress to show — the tray reads
  // this back as "draw the plain glyph", not as an empty-looking one.
  it("passes null straight through rather than treating it as zero", () => {
    expect(drainBucket(null)).toBe(null);
    expect(drainBucket(null)).not.toBe(drainBucket(0));
  });

  it("clamps to 0..1 before bucketing", () => {
    expect(drainBucket(-0.5)).toBe(0);
    expect(drainBucket(1.5)).toBe(DRAIN_STEPS);
  });

  it("lands on the ends exactly", () => {
    expect(drainBucket(0)).toBe(0);
    expect(drainBucket(1)).toBe(DRAIN_STEPS);
  });

  // Stable so the tray's icon cache — keyed on the bucket — hits for the same
  // figure twice, and monotonic so the icon never looks like it filled
  // backwards while the task keeps running forward.
  it("is stable and never runs backwards as progress climbs", () => {
    const progress = Array.from({ length: 41 }, (_, i) => i / 40);
    const buckets = progress.map(drainBucket);
    expect(progress.map(drainBucket)).toEqual(buckets);
    for (let i = 1; i < buckets.length; i++) {
      expect(buckets[i]).toBeGreaterThanOrEqual(buckets[i - 1] ?? 0);
    }
  });
});
