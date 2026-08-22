import { describe, expect, it } from "vitest";
import {
  eventEnd,
  eventsOn,
  eventTone,
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
    logEvent(event, api, events, at(11));

    expect(calls).toEqual([
      "add TEMPO-42/Standup",
      `estimate t1 ${HOUR}`,
      "link e1 t1",
      `record t1 ${at(10)} ${at(11)}`,
    ]);
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
    logEvent(booking({ start: at(10) }), api, events, at(9));

    expect(calls).toEqual([]);
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
    logEvent(booking({ taskId: "t1" }), api, events, at(12));

    expect(calls).toEqual([]);
  });
});
