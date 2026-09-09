import { useEffect, useState } from "react";
import { elapsedMs, groupTone, parseEntry, taskStatus, type TasksApi } from "./tasks";

const EVENTS_KEY = "tempo.events.v1";

/**
 * Something booked: a meeting, a class, anything that owns a slot whether or
 * not you track it. The other side of the app measures time that has passed;
 * this is the only part that knows about time that hasn't.
 */
export interface Event {
  id: string;
  title: string;
  group: string | null;
  /** Epoch ms — a booking is a wall clock, not an offset into a day. */
  start: number;
  durationMs: number;
  /** The task this event times, made the first time it's started. */
  taskId: string | null;
  /** An explicit pick into `--group-1`…`--group-6`. `null` means derived —
   *  see `eventTone`, which reuses the same six hues rather than growing them. */
  color: number | null;
  createdAt: number;
}

function readEvents(): Event[] {
  try {
    const raw = localStorage.getItem(EVENTS_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // `color` arrived after these were written, so anything booked before it
    // has no such key at all. Filled in here rather than coped with at each
    // reader: `undefined` and `null` both derive a hue, but only one of them
    // equals `null`, and a picker asking "is this one derived?" would say no
    // for every booking made before the feature existed.
    return (parsed as Event[]).map((e) => ({ ...e, color: e.color ?? null }));
  } catch {
    return [];
  }
}

export function eventEnd(event: Event): number {
  return event.start + event.durationMs;
}

/**
 * The colour a booking reads as: a pick made on the event itself first, then
 * its group's hash — the same one the timer's dot uses, so the two screens
 * can't disagree — then, for a booking with no group at all, its own title's.
 * No booking is ever grey: something always hashes to one of the six hues.
 */
export function eventTone(event: Event): number {
  return event.color ?? groupTone(event.group ?? event.title);
}

/**
 * What's booked on `[from, to)`, in the order it happens. Sorted by time
 * unlike the task list — a schedule that didn't run down the day would be
 * lying about what it is.
 */
export function eventsOn(events: Event[], from: number, to: number): Event[] {
  return events
    .filter((e) => e.start < to && eventEnd(e) > from)
    .sort((a, b) => a.start - b.start || a.createdAt - b.createdAt);
}

/** The hours a working day is assumed to cover before anything is booked. */
const OPENS = 8;
const CLOSES = 20;

/**
 * The hours the day's column has to cover: the working day, widened to hold
 * anything booked outside it, and — on today — `now`, because the hairline is
 * the one thing on the screen that has to be visible whatever is booked.
 * `now` is `null` on any other day, which has no hairline to make room for.
 *
 * Counted in hours from `dayStart` rather than in calendar hours, so the 23-
 * and 25-hour days the clocks change on still line up with the bookings on
 * them.
 */
export function dayWindow(
  booked: Event[],
  dayStart: number,
  now: number | null,
): { first: number; last: number } {
  const hourOf = (ts: number) => (ts - dayStart) / 3_600_000;
  const marks = now === null ? [] : [hourOf(now)];
  return {
    first: Math.max(
      0,
      Math.floor(Math.min(OPENS, ...marks, ...booked.map((e) => hourOf(e.start)))),
    ),
    last: Math.min(
      24,
      Math.ceil(Math.max(CLOSES, ...marks, ...booked.map((e) => hourOf(eventEnd(e))))),
    ),
  };
}

/** Where a booking sits once the day is drawn: which lane, of how many. */
export interface Laid {
  event: Event;
  lane: number;
  lanes: number;
}

/**
 * Side by side when two bookings collide. Each cluster of colliding events is
 * split only as many ways as that cluster needs, so one double-booked hour
 * doesn't squeeze the rest of the day into half the width.
 *
 * Collision is measured on what gets *drawn*, not on what was booked: `minMs`
 * is the shortest span the screen can draw and still leave something you can
 * hit, so two ten-minute bookings ten minutes apart don't overlap in the diary
 * but do overlap on the screen — and packing them into one lane would print
 * the second one's name over the first's.
 */
export function lay(booked: Event[], minMs = 0): Laid[] {
  const drawnEnd = (event: Event) =>
    Math.max(eventEnd(event), event.start + minMs);

  const laid: Laid[] = [];
  let cluster: Laid[] = [];
  let lanes: number[] = []; // when each lane comes free
  let clusterEnd = -Infinity;

  const close = () => {
    for (const item of cluster) item.lanes = lanes.length;
    laid.push(...cluster);
    cluster = [];
    lanes = [];
  };

  for (const event of booked) {
    if (event.start >= clusterEnd) close();

    let lane = lanes.findIndex((free) => free <= event.start);
    if (lane === -1) lane = lanes.length;
    lanes[lane] = drawnEnd(event);

    cluster.push({ event, lane, lanes: 1 });
    clusterEnd = Math.max(clusterEnd, drawnEnd(event));
  }
  close();

  return laid;
}

/** The next thing due, from `now` on; `null` when the day's run out. */
export function nextEvent(events: Event[], now: number): Event | null {
  return (
    events
      .filter((e) => eventEnd(e) > now)
      .sort((a, b) => a.start - b.start)[0] ?? null
  );
}

/** Enough of a task to say what `startEvent` / `logEvent` just did — its own
 *  name and group, which may have moved on from the booking's if it was
 *  renamed since. */
export interface EventTask {
  id: string;
  name: string;
  group: string | null;
}

/** How a task made from an event reads in a confirmation — `taskLabel`'s
 *  shape, kept in step with it. */
export function eventTaskLabel(task: EventTask): string {
  return task.group === null ? task.name : `${task.group} · ${task.name}`;
}

/**
 * Made the first time an event goes onto the clock, whichever way it gets
 * there — title, group and estimate straight from the booking, so `startEvent`
 * and `logEvent` can't ever give the same meeting two different tasks.
 */
function linkedTask(event: Event, api: TasksApi, events: EventsApi): EventTask {
  const title = event.title.trim() === "" ? "Untitled" : event.title.trim();
  const id = api.add(title, event.group);
  if (event.durationMs > 0) api.setEstimate(id, event.durationMs);
  events.link(event.id, id);
  return { id, name: title, group: event.group };
}

/**
 * The task an event is already timing, or `null` if it never made one — or
 * if it did and that task has since been deleted, which reads the same as
 * never having made one.
 */
function findLinked(event: Event, api: TasksApi) {
  return event.taskId === null
    ? null
    : (api.tasks.find((t) => t.id === event.taskId) ?? null);
}

/**
 * Put the clock on an event. The one path in — the row's play button, the
 * notification's action and the tray menu all come through here, so a meeting
 * can never end up with two tasks for it.
 *
 * The task is made on first start rather than at booking: a booking you never
 * attend shouldn't leave a task behind. Its estimate is the event's own length,
 * which means a meeting that runs long trips the over-estimate alert already
 * in the app rather than needing one of its own.
 */
export function startEvent(event: Event, api: TasksApi, events: EventsApi): EventTask {
  const linked = findLinked(event, api);
  if (linked !== null) {
    api.start(linked.id);
    return { id: linked.id, name: linked.name, group: linked.group };
  }
  const made = linkedTask(event, api, events);
  api.start(made.id);
  return made;
}

/**
 * Log a window that already happened rather than starting one now — the
 * second sanctioned way onto the clock, and the mirror of `startEvent`: that
 * puts the clock on now, this puts a finished window on the books, so walking
 * into a meeting and forgetting to press ▶ doesn't lose the hour.
 *
 * Records `[event.start, min(eventEnd(event), now))` — nothing to log before
 * an event has started, and nothing past the minute it's actually reached.
 * Makes the task on first log exactly as `startEvent` would, so a booking
 * still never ends up with two tasks whichever button finds it first.
 */
export function logEvent(
  event: Event,
  api: TasksApi,
  events: EventsApi,
  now: number,
): (EventTask & { loggedMs: number }) | null {
  const to = Math.min(eventEnd(event), now);
  if (to <= event.start) return null;

  const linked = findLinked(event, api);
  // One log per booking, enforced here rather than only on the button that
  // happens to be disabled: `startEvent` keeps its own "never two tasks" rule
  // in the shared function precisely because the tray and a notification reach
  // it too, and anything wired to this later inherits the same guard.
  if (linked !== null && elapsedMs(linked, now) > 0) return null;

  const made: EventTask =
    linked !== null
      ? { id: linked.id, name: linked.name, group: linked.group }
      : linkedTask(event, api, events);
  api.record(made.id, event.start, to);
  return { ...made, loggedMs: to - event.start };
}

/** Is this event's task the one currently counting? */
export function isTracking(event: Event, api: TasksApi): boolean {
  const task = api.tasks.find((t) => t.id === event.taskId);
  return task !== undefined && taskStatus(task) === "running";
}

/** Has the event's linked task already got time on it? One log per booking —
 *  otherwise ▶ and Log would fight over the same window. */
export function isLogged(event: Event, api: TasksApi, now: number): boolean {
  const task = api.tasks.find((t) => t.id === event.taskId);
  return task !== undefined && elapsedMs(task, now) > 0;
}

export type EventsApi = ReturnType<typeof useEvents>;

/** Owns what's booked: hydrates from localStorage, persists on every change. */
export function useEvents() {
  const [events, setEvents] = useState<Event[]>(readEvents);

  useEffect(() => {
    localStorage.setItem(EVENTS_KEY, JSON.stringify(events));
  }, [events]);

  const edit = (id: string, change: (event: Event) => Event) =>
    setEvents((current) => current.map((e) => (e.id === id ? change(e) : e)));

  return {
    events,

    /**
     * A leading `TEMPO-42 ` files the event under that group, the same rule the
     * task composer follows — one syntax to know, not two.
     */
    add(title: string, start: number, durationMs: number): string {
      const entry = parseEntry(title);
      const id = crypto.randomUUID();
      setEvents((current) => [
        ...current,
        {
          id,
          title: entry.name,
          group: entry.group,
          start,
          durationMs,
          taskId: null,
          color: null,
          createdAt: Date.now(),
        },
      ]);
      return id;
    },

    /** Rebooking: the title is re-read for a group key, as when it was made. */
    rebook: (id: string, title: string, start: number, durationMs: number) =>
      edit(id, (e) => {
        const entry = parseEntry(title);
        return {
          ...e,
          title: entry.name,
          group: entry.group ?? e.group,
          start,
          durationMs,
        };
      }),

    link: (id: string, taskId: string | null) =>
      edit(id, (e) => ({ ...e, taskId })),

    /** `null` drops back to derived — the group's hash, or the title's. */
    setColor: (id: string, color: number | null) =>
      edit(id, (e) => ({ ...e, color })),

    remove: (id: string) =>
      setEvents((current) => current.filter((e) => e.id !== id)),
  };
}
