import { describe, expect, it } from "vitest";
import { crossings, thresholds } from "./alerts";
import type { Event } from "./events";
import type { Estimate } from "./tasks";

const HOUR = 3_600_000;
const MINUTE = 60_000;
const at = (hours: number, minutes = 0) =>
  new Date(2026, 2, 12, hours, minutes).getTime();

const over = (key: string, spentMs = 2 * HOUR): Estimate => ({
  scope: "task",
  key,
  subject: "Wire the token refresh",
  estimateMs: HOUR,
  spentMs,
  over: true,
});

const under = (key: string): Estimate => ({ ...over(key), over: false });

describe("crossings", () => {
  it("fires on the way over", () => {
    const { fire, next, changed } = crossings(new Set(), [over("task:1")]);

    expect(fire.map((e) => e.key)).toEqual(["task:1"]);
    expect([...next]).toEqual(["task:1"]);
    expect(changed).toBe(true);
  });

  // The clock ticks every second; the notification comes once.
  it("stays quiet on every pass after the first", () => {
    const { next } = crossings(new Set(), [over("task:1")]);
    const again = crossings(next, [over("task:1")]);

    expect(again.fire).toEqual([]);
    expect(again.changed).toBe(false);
  });

  // Raising an estimate past what's been spent means the new one can alert in
  // its turn.
  it("re-arms when it drops back under, and can fire again", () => {
    const first = crossings(new Set(), [over("task:1")]);
    const rearmed = crossings(first.next, [under("task:1")]);

    expect(rearmed.fire).toEqual([]);
    expect([...rearmed.next]).toEqual([]);
    expect(rearmed.changed).toBe(true);

    expect(crossings(rearmed.next, [over("task:1")]).fire).toHaveLength(1);
  });

  it("leaves the set alone when nothing has crossed either way", () => {
    const { fire, next, changed } = crossings(new Set(), [under("task:1")]);

    expect(fire).toEqual([]);
    expect([...next]).toEqual([]);
    expect(changed).toBe(false);
  });

  // The caller persists the set it's handed back, so the one it passed in must
  // survive the call — otherwise a failed write loses the fact it fired.
  it("doesn't mutate the set it was given", () => {
    const fired = new Set(["task:1"]);
    crossings(fired, [under("task:1"), over("task:2")]);

    expect([...fired]).toEqual(["task:1"]);
  });

  it("carries the task and the group through together", () => {
    const group: Estimate = { ...over("group:TEMPO-42"), scope: "group" };
    const { fire } = crossings(new Set(), [over("task:1"), group]);

    expect(fire.map((e) => e.scope)).toEqual(["task", "group"]);
  });
});

describe("thresholds", () => {
  const event: Event = {
    id: "e1",
    title: "Standup",
    group: null,
    start: at(10),
    durationMs: HOUR,
    taskId: null,
    createdAt: at(9),
  };

  // A booking speaks twice: five minutes out, and as it starts. Only the
  // second carries an action.
  it("puts one five minutes out and one on the hour", () => {
    expect(thresholds([event])).toEqual([
      { key: "event:e1:soon", at: at(10) - 5 * MINUTE, starting: false, event },
      { key: "event:e1:start", at: at(10), starting: true, event },
    ]);
  });

  it("gives every booking its own pair of keys", () => {
    const other = { ...event, id: "e2" };
    expect(thresholds([event, other]).map((d) => d.key)).toEqual([
      "event:e1:soon",
      "event:e1:start",
      "event:e2:soon",
      "event:e2:start",
    ]);
  });
});
