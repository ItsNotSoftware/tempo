import { describe, expect, it } from "vitest";
import {
  estimates,
  groupSpent,
  parseEntry,
  recorded,
  retimedDay,
  type Groups,
  type Segment,
  type Task,
} from "./tasks";

const HOUR = 3_600_000;
const MINUTE = 60_000;

const dayStart = new Date(2026, 2, 12).getTime();
const dayEnd = new Date(2026, 2, 13).getTime();
const at = (hours: number, minutes = 0, seconds = 0) =>
  new Date(2026, 2, 12, hours, minutes, seconds).getTime();

/** What the row would read for this day — the figure being typed over. */
function dayTotal(segments: Segment[], now: number): number {
  return segments.reduce(
    (sum, s) =>
      sum +
      Math.max(
        0,
        Math.min(s.end ?? now, dayEnd) - Math.max(s.start, dayStart),
      ),
    0,
  );
}

const retime = (segments: Segment[], now: number, target: number) =>
  retimedDay(segments, dayStart, dayEnd, now, target);

describe("retimedDay", () => {
  // The gesture the whole rule exists for: you left it counting, and you say
  // what the figure should have been.
  it("takes the difference off the day's newest run", () => {
    const now = at(14);
    const next = retime(
      [
        { start: at(9), end: at(10) },
        { start: at(11), end: at(11, 30, 15) },
      ],
      now,
      HOUR,
    );

    expect(dayTotal(next, now)).toBe(HOUR);
    // The newest run absorbed all of it and stopped being a run.
    expect(next).toEqual([{ start: at(9), end: at(10) }]);
  });

  it("carries a shortfall back into the run before it", () => {
    const now = at(14);
    const next = retime(
      [
        { start: at(9), end: at(10) },
        { start: at(11), end: at(11, 30) },
      ],
      now,
      45 * MINUTE,
    );

    expect(dayTotal(next, now)).toBe(45 * MINUTE);
    // 30m came off the newest run, the last 15m off the one before it.
    expect(next).toEqual([{ start: at(9), end: at(9, 45) }]);
  });

  // Trimming the run still going moves its start, so the task keeps counting
  // from a corrected figure rather than stopping.
  it("moves the start of a running run, and leaves it running", () => {
    const now = at(11, 30);
    const next = retime([{ start: at(10), end: null }], now, HOUR);

    expect(next).toEqual([{ start: at(10, 30), end: null }]);
    expect(dayTotal(next, now)).toBe(HOUR);
  });

  it("makes one run out of a task that was never started", () => {
    const now = at(14);
    const next = retime([], now, 2 * HOUR);

    expect(next).toEqual([{ start: at(12), end: at(14) }]);
    expect(dayTotal(next, now)).toBe(2 * HOUR);
  });

  // You can't bank time that hasn't passed.
  it("grows to now and no further, then backwards", () => {
    const now = at(10, 30);
    const next = retime([{ start: at(9), end: at(10) }], now, 3 * HOUR);

    expect(dayTotal(next, now)).toBe(3 * HOUR);
    expect(next[0]?.end).toBe(now);
    expect(next[0]?.start).toBe(at(7, 30));
  });

  it("won't grow a run back over the one before it", () => {
    const now = at(12);
    const next = retime(
      [
        { start: at(9), end: at(10) },
        { start: at(11), end: at(11, 30) },
      ],
      now,
      2 * HOUR + 30 * MINUTE,
    );

    expect(dayTotal(next, now)).toBe(2 * HOUR + 30 * MINUTE);
    expect(next).toEqual([
      { start: at(9), end: at(10) },
      // Grew to now first, then back — stopping where the earlier run ended.
      { start: at(10, 30), end: at(12) },
    ]);
  });

  it("leaves the measurement alone when the figure already agrees", () => {
    const now = at(14);
    const segments = [{ start: at(9), end: at(10) }];
    expect(retime(segments, now, HOUR)).toEqual(segments);
  });

  // A day is a record of itself — correcting today can't reach into yesterday.
  it("keeps a correction inside the day", () => {
    const now = at(14);
    const next = retime([], now, 20 * HOUR);

    expect(next[0]?.start).toBe(dayStart);
    expect(next.every((s) => (s.end ?? now) <= dayEnd)).toBe(true);
  });
});

describe("recorded", () => {
  // The gesture this rule exists for: a window that already happened, logged
  // straight onto a task that never ran for it.
  it("appends a run for a window that already happened", () => {
    const now = at(14);
    const next = recorded([], at(9), at(10), now);

    expect(next).toEqual([{ start: at(9), end: at(10) }]);
  });

  // Logging mid-meeting can't credit minutes that haven't passed yet.
  it("clamps an end past now", () => {
    const now = at(10);
    const next = recorded([], at(9), at(12), now);

    expect(next).toEqual([{ start: at(9), end: at(10) }]);
  });

  // Logging is what marks the task done, so nothing can be left counting
  // behind it — same one-clock rule `start` enforces, from the other side.
  it("closes a run still open rather than leaving two clocks", () => {
    const now = at(14);
    const next = recorded([{ start: at(8), end: null }], at(11), at(12), now);

    expect(next).toEqual([
      { start: at(8), end: now },
      { start: at(11), end: at(12) },
    ]);
  });

  it("leaves runs on other days untouched", () => {
    const now = at(14);
    const yesterday = { start: dayStart - HOUR, end: dayStart - 30 * MINUTE };
    const next = recorded([yesterday], at(9), at(10), now);

    expect(next).toContainEqual(yesterday);
    expect(next).toContainEqual({ start: at(9), end: at(10) });
  });

  // Same invariants `retimedDay` runs through the same seam: nothing ends
  // before it starts or after now, and the runs come out oldest first.
  it("satisfies the shape every task's segments keep", () => {
    const now = at(11, 30);
    const next = recorded([{ start: at(8), end: null }], at(9), at(10), now);

    expect(next.every((s) => s.start <= (s.end ?? now))).toBe(true);
    expect(next.every((s) => (s.end ?? now) <= now)).toBe(true);
    expect([...next]).toEqual([...next].sort((a, b) => a.start - b.start));
  });
});

describe("parseEntry", () => {
  it("takes a leading ticket as the group and a trailing ~ as the estimate", () => {
    expect(parseEntry("TEMPO-42 Wire the token refresh ~45m")).toEqual({
      group: "TEMPO-42",
      name: "Wire the token refresh",
      estimateMs: 45 * MINUTE,
    });
  });

  it("uppercases a ticket so tempo-42 and TEMPO-42 are one group", () => {
    expect(parseEntry("tempo-42 Fix it").group).toBe("TEMPO-42");
  });

  // The prefix matches the ticket shape on purpose — a looser rule would split
  // every two-word task in half.
  it("doesn't split an ordinary two-word name", () => {
    expect(parseEntry("Write the changelog")).toEqual({
      group: null,
      name: "Write the changelog",
      estimateMs: null,
    });
  });

  it("keeps a ~ that didn't parse as part of the name", () => {
    expect(parseEntry("Read ~ the docs")).toEqual({
      group: null,
      name: "Read ~ the docs",
      estimateMs: null,
    });
  });
});

describe("groupSpent", () => {
  const task = (over: Partial<Task> = {}): Task => ({
    id: "t1",
    group: "TEMPO-42",
    name: "Wire the token refresh",
    notes: "",
    estimateMs: null,
    segments: [],
    createdAt: dayStart,
    completedAt: null,
    ...over,
  });

  // The bar reads against the whole group, so a run on an earlier day still
  // counts — measuring today's slice against a whole-group budget would read
  // under from the second day on.
  it("counts every day the group ran, not the one in view", () => {
    const yesterday = dayStart - 86_400_000;
    const spent = groupSpent(
      [
        task({ id: "a", segments: [{ start: yesterday, end: yesterday + HOUR }] }),
        task({ id: "b", segments: [{ start: at(9), end: at(11) }] }),
      ],
      "TEMPO-42",
      at(14),
    );

    expect(spent).toBe(3 * HOUR);
  });

  it("counts only the tasks carrying the name", () => {
    const spent = groupSpent(
      [
        task({ id: "a", segments: [{ start: at(9), end: at(10) }] }),
        task({ id: "b", group: "TEMPO-99", segments: [{ start: at(9), end: at(12) }] }),
        task({ id: "c", group: null, segments: [{ start: at(9), end: at(12) }] }),
      ],
      "TEMPO-42",
      at(14),
    );

    expect(spent).toBe(HOUR);
  });

  it("counts a run still going, up to now", () => {
    const spent = groupSpent(
      [task({ segments: [{ start: at(12), end: null }] })],
      "TEMPO-42",
      at(14),
    );

    expect(spent).toBe(2 * HOUR);
  });
});

describe("estimates", () => {
  const task = (over: Partial<Task> = {}): Task => ({
    id: "t1",
    group: null,
    name: "Wire the token refresh",
    notes: "",
    estimateMs: null,
    segments: [],
    createdAt: dayStart,
    completedAt: null,
    ...over,
  });

  const now = at(14);
  const twoHours = [{ start: at(12), end: null }];

  it("reports a task past its own estimate", () => {
    const running = task({ estimateMs: HOUR, segments: twoHours });
    const [first] = estimates(running, [running], {}, now);

    expect(first?.scope).toBe("task");
    expect(first?.over).toBe(true);
    expect(first?.spentMs).toBe(2 * HOUR);
  });

  it("re-arms when the estimate is raised past what's been spent", () => {
    const running = task({ estimateMs: 3 * HOUR, segments: twoHours });
    expect(estimates(running, [running], {}, now)[0]?.over).toBe(false);
  });

  // A group without its own says nothing — its expected time is just the sum
  // of its tasks', and those alert on their own. It's still measured, so the
  // tray can paint the spend; what it can't do is ever read as over.
  it("says nothing about a group with no estimate of its own", () => {
    const running = task({ group: "TEMPO-42", estimateMs: HOUR, segments: twoHours });
    const group = estimates(running, [running], {}, now).find(
      (e) => e.scope === "group",
    );

    expect(group?.estimateMs).toBeNull();
    expect(group?.over).toBe(false);
  });

  it("reports a group past an estimate set on the group itself", () => {
    const running = task({ group: "TEMPO-42", segments: twoHours });
    const groups: Groups = { "TEMPO-42": { estimateMs: HOUR, notes: "" } };
    const group = estimates(running, [running], groups, now).find(
      (e) => e.scope === "group",
    );

    expect(group?.over).toBe(true);
    expect(group?.subject).toBe("TEMPO-42");
  });
});
