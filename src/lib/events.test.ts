import { describe, expect, it } from "vitest";
import {
  dayWindow,
  eventEnd,
  eventsOn,
  eventTaskLabel,
  eventTone,
  lay,
  logEvent,
  nextEvent,
  startEvent,
  type Event,
} from "./events";
import type { EventsApi } from "./events";
import { groupTone, type Task, type TasksApi } from "./tasks";

const HOUR = 3_600_000;
const dayStart = new Date(2026, 2, 12).getTime();
const dayEnd = new Date(2026, 2, 13).getTime();
const at = (hours: number, minutes = 0) =>
  new Date(2026, 2, 12, hours, minutes).getTime();

const booking = (over: Partial<Event> = {}): Event => ({
  id: "e1",
  title: "Standup",
  group: null,
  start: at(10),
  durationMs: HOUR,
  taskId: null,
  color: null,
  createdAt: dayStart,
  ...over,
});

/**
 * Enough of the two APIs for `startEvent` / `logEvent` to run against,
 * recording what they asked for. The casts are the price of not inventing a
 * narrower interface that only a test would use.
 */
function stubs(tasks: Task[] = []) {
  const calls: string[] = [];
  let next = 1;

  const api = {
    tasks,
    add: (name: string, group: string | null) => {
      const id = `t${next++}`;
      calls.push(`add ${group ?? "—"}/${name}`);
      tasks.push({
        id,
        group,
        name,
        notes: "",
        estimateMs: null,
        segments: [],
        createdAt: dayStart,
        completedAt: null,
      });
      return id;
    },
    setEstimate: (id: string, ms: number | null) =>
      calls.push(`estimate ${id} ${ms}`),
    start: (id: string) => calls.push(`start ${id}`),
    record: (id: string, from: number, to: number) =>
      calls.push(`record ${id} ${from} ${to}`),
  } as unknown as TasksApi;

  const events = {
    link: (eventId: string, taskId: string) =>
      calls.push(`link ${eventId} ${taskId}`),
  } as unknown as EventsApi;

  return { api, events, calls, tasks };
}

describe("startEvent", () => {
  // A booking you never attend shouldn't leave a task behind, so the task is
  // made on the first start — estimated at the booking's own length, so a
  // meeting running long trips the alert that already exists.
  it("makes one task, named and estimated after the booking", () => {
    const { api, events, calls } = stubs();
    startEvent(booking({ group: "TEMPO-42" }), api, events);

    expect(calls).toEqual([
      "add TEMPO-42/Standup",
      `estimate t1 ${HOUR}`,
      "link e1 t1",
      "start t1",
    ]);
  });

  // The event remembers its task, so starting again resumes it rather than
  // making a second. Two paths onto the clock would mean two tasks.
  it("resumes the linked task instead of making another", () => {
    const first = stubs();
    startEvent(booking(), first.api, first.events);

    const { api, events, calls } = stubs(first.tasks);
    startEvent(booking({ taskId: "t1" }), api, events);

    expect(calls).toEqual(["start t1"]);
  });

  it("falls back to Untitled rather than naming a task nothing", () => {
    const { api, events, calls } = stubs();
    startEvent(booking({ title: "   " }), api, events);

    expect(calls[0]).toBe("add —/Untitled");
  });

  it("sets no estimate for a booking with no length", () => {
    const { api, events, calls } = stubs();
    startEvent(booking({ durationMs: 0 }), api, events);

    expect(calls.some((c) => c.startsWith("estimate"))).toBe(false);
  });

  // The caller needs to say what happened — a toast names the task it just
  // put the clock on.
  it("hands back the task it just made", () => {
    const { api, events } = stubs();
    const task = startEvent(booking({ group: "TEMPO-42" }), api, events);

    expect(task).toEqual({ id: "t1", name: "Standup", group: "TEMPO-42" });
  });

  // Resuming reads the linked task's own name and group, not the booking's —
  // it may have been renamed since the task was made.
  it("hands back the linked task as it stands now, not as the booking reads", () => {
    const first = stubs();
    startEvent(booking({ group: "TEMPO-42" }), first.api, first.events);
    first.tasks[0].name = "Standup (renamed)";
    first.tasks[0].group = "TEMPO-99";

    const { api, events } = stubs(first.tasks);
    const task = startEvent(booking({ taskId: "t1" }), api, events);

    expect(task).toEqual({ id: "t1", name: "Standup (renamed)", group: "TEMPO-99" });
  });
});

describe("eventsOn / nextEvent", () => {
  it("takes the day in view and nothing either side of it", () => {
    const today = booking({ id: "a" });
    const tomorrow = booking({ id: "b", start: at(10) + 86_400_000 });

    expect(eventsOn([today, tomorrow], dayStart, dayEnd).map((e) => e.id)).toEqual([
      "a",
    ]);
  });

  it("finds the soonest booking still ahead", () => {
    const early = booking({ id: "a", start: at(9) });
    const later = booking({ id: "b", start: at(16) });

    expect(nextEvent([later, early], at(8))?.id).toBe("a");
    expect(nextEvent([later, early], at(11))?.id).toBe("b");
    expect(nextEvent([later, early], at(20))).toBeNull();
  });

  it("ends a booking its own length after it starts", () => {
    expect(eventEnd(booking())).toBe(at(11));
  });
});

describe("eventTone", () => {
  it("prefers an explicit pick over anything derived", () => {
    const event = booking({ group: "TEMPO-42", color: 3 });
    expect(eventTone(event)).toBe(3);
  });

  // A grouped event hashes the group, the same one the timer's dot uses, so
  // the schedule and the timer can't disagree about a group's colour.
  it("falls back to the group's hash", () => {
    const event = booking({ group: "TEMPO-42", color: null });
    expect(eventTone(event)).toBe(groupTone("TEMPO-42"));
  });

  // No group either: hash the title, so no booking is ever grey.
  it("hashes the title when there's no group to hash instead", () => {
    const event = booking({ group: null, color: null, title: "Dentist" });
    expect(eventTone(event)).toBe(groupTone("Dentist"));
  });
});

describe("logEvent", () => {
  // The mirror of startEvent's first test: a forgotten meeting still gets
  // exactly one task, named and estimated the same way.
  it("makes and links a task on the first log", () => {
    const { api, events, calls } = stubs();
    const event = booking({ group: "TEMPO-42", start: at(10), durationMs: HOUR });
    const result = logEvent(event, api, events, at(11));

    expect(calls).toEqual([
      "add TEMPO-42/Standup",
      `estimate t1 ${HOUR}`,
      "link e1 t1",
      `record t1 ${at(10)} ${at(11)}`,
    ]);
    // What the caller needs to say a toast: the task and how much landed.
    expect(result).toEqual({ id: "t1", name: "Standup", group: "TEMPO-42", loggedMs: HOUR });
  });

  // Two paths onto the clock, one task — the same rule startEvent keeps.
  it("records onto the linked task rather than making a second", () => {
    const first = stubs();
    logEvent(booking(), first.api, first.events, at(11));

    const { api, events, calls } = stubs(first.tasks);
    logEvent(booking({ taskId: "t1", durationMs: 2 * HOUR }), api, events, at(11, 30));

    expect(calls).toEqual([`record t1 ${at(10)} ${at(11, 30)}`]);
  });

  // Logging mid-meeting can't credit minutes that haven't happened yet.
  it("clamps the logged window to now, never past the booking's own end", () => {
    const { api, events, calls } = stubs();
    logEvent(booking({ start: at(10), durationMs: HOUR }), api, events, at(15));

    expect(calls[calls.length - 1]).toBe(`record t1 ${at(10)} ${at(11)}`);
  });

  // Nothing to log before it's started.
  it("does nothing for a booking that hasn't started", () => {
    const { api, events, calls } = stubs();
    const result = logEvent(booking({ start: at(10) }), api, events, at(9));

    expect(calls).toEqual([]);
    expect(result).toBeNull();
  });

  // The rule lives in `logEvent`, not in the button that happens to be
  // disabled — `startEvent` keeps its "never two tasks" guard in the shared
  // function for the same reason, so anything wired here later inherits it.
  it("refuses to log twice onto a task that already has time", () => {
    const tracked: Task[] = [
      {
        id: "t1",
        group: null,
        name: "Standup",
        notes: "",
        estimateMs: null,
        segments: [{ start: at(10), end: at(11) }],
        createdAt: dayStart,
        completedAt: at(11),
      },
    ];
    const { api, events, calls } = stubs(tracked);
    const result = logEvent(booking({ taskId: "t1" }), api, events, at(12));

    expect(calls).toEqual([]);
    expect(result).toBeNull();
  });
});

describe("eventTaskLabel", () => {
  it("reads group and name together, the same shape as taskLabel", () => {
    expect(eventTaskLabel({ id: "t1", name: "Standup", group: "TEMPO-42" })).toBe(
      "TEMPO-42 · Standup",
    );
  });

  it("drops the separator for a task with no group", () => {
    expect(eventTaskLabel({ id: "t1", name: "Dentist", group: null })).toBe("Dentist");
  });
});

describe("dayWindow", () => {
  const MINUTE = 60_000;

  it("covers the working day when nothing is booked", () => {
    expect(dayWindow([], dayStart, null)).toEqual({ first: 8, last: 20 });
  });

  it("widens to hold a booking outside it, whole hours either way", () => {
    const early = booking({ start: at(6, 15), durationMs: 45 * MINUTE });
    const late = booking({ id: "e2", start: at(21, 10), durationMs: HOUR });

    expect(dayWindow([early, late], dayStart, null)).toEqual({ first: 6, last: 23 });
  });

  it("makes room for now on today, whatever is booked", () => {
    expect(dayWindow([], dayStart, at(5, 40))).toEqual({ first: 5, last: 20 });
    expect(dayWindow([], dayStart, at(23, 10))).toEqual({ first: 8, last: 24 });
  });

  it("never runs past either end of the day", () => {
    const overnight = booking({ start: at(23, 30), durationMs: 3 * HOUR });
    const before = booking({ id: "e2", start: at(0) - HOUR, durationMs: 2 * HOUR });

    expect(dayWindow([overnight, before], dayStart, null)).toEqual({
      first: 0,
      last: 24,
    });
  });
});

describe("lay", () => {
  const MINUTE = 60_000;
  const lanesOf = (booked: Event[], minMs = 0) =>
    lay(booked, minMs).map(({ event, lane, lanes }) => [event.id, lane, lanes]);

  it("gives a day that never overlaps the full width", () => {
    const morning = booking({ id: "a", start: at(9), durationMs: HOUR });
    const noon = booking({ id: "b", start: at(12), durationMs: HOUR });

    expect(lanesOf([morning, noon])).toEqual([
      ["a", 0, 1],
      ["b", 0, 1],
    ]);
  });

  it("splits only the cluster that overlaps", () => {
    const a = booking({ id: "a", start: at(9), durationMs: 2 * HOUR });
    const b = booking({ id: "b", start: at(10), durationMs: HOUR });
    const alone = booking({ id: "c", start: at(15), durationMs: HOUR });

    expect(lanesOf([a, b, alone])).toEqual([
      ["a", 0, 2],
      ["b", 1, 2],
      ["c", 0, 1],
    ]);
  });

  it("reuses a lane once its booking has finished", () => {
    const a = booking({ id: "a", start: at(9), durationMs: 3 * HOUR });
    const b = booking({ id: "b", start: at(9, 30), durationMs: HOUR });
    const c = booking({ id: "c", start: at(10, 30), durationMs: HOUR });

    expect(lanesOf([a, b, c])).toEqual([
      ["a", 0, 2],
      ["b", 1, 2],
      ["c", 1, 2],
    ]);
  });

  it("splits two short bookings that only collide once drawn", () => {
    const a = booking({ id: "a", start: at(9, 30), durationMs: 10 * MINUTE });
    const b = booking({ id: "b", start: at(9, 40), durationMs: 10 * MINUTE });

    // On the times alone they sit end to end, so one lane is right.
    expect(lanesOf([a, b])).toEqual([
      ["a", 0, 1],
      ["b", 0, 1],
    ]);
    // Drawn at a hittable minimum they land on top of each other.
    expect(lanesOf([a, b], 30 * MINUTE)).toEqual([
      ["a", 0, 2],
      ["b", 1, 2],
    ]);
  });

  it("keeps a short booking out of the way of the next hour's", () => {
    const a = booking({ id: "a", start: at(9), durationMs: 5 * MINUTE });
    const b = booking({ id: "b", start: at(10), durationMs: HOUR });

    expect(lanesOf([a, b], 30 * MINUTE)).toEqual([
      ["a", 0, 1],
      ["b", 0, 1],
    ]);
  });
});
