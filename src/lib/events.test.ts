import { describe, expect, it } from "vitest";
import { eventEnd, eventsOn, nextEvent, startEvent, type Event } from "./events";
import type { EventsApi } from "./events";
import type { Task, TasksApi } from "./tasks";

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
  createdAt: dayStart,
  ...over,
});

/**
 * Enough of the two APIs for `startEvent` to run against, recording what it
 * asked for. The casts are the price of not inventing a narrower interface
 * that only a test would use.
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
