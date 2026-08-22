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
    return Array.isArray(parsed) ? (parsed as Event[]) : [];
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

/** The next thing due, from `now` on; `null` when the day's run out. */
export function nextEvent(events: Event[], now: number): Event | null {
  return (
    events
      .filter((e) => eventEnd(e) > now)
      .sort((a, b) => a.start - b.start)[0] ?? null
  );
}

/**
 * Made the first time an event goes onto the clock, whichever way it gets
 * there — title, group and estimate straight from the booking, so `startEvent`
 * and `logEvent` can't ever give the same meeting two different tasks.
 */
function linkedTask(event: Event, api: TasksApi, events: EventsApi): string {
  const title = event.title.trim() === "" ? "Untitled" : event.title.trim();
  const id = api.add(title, event.group);
  if (event.durationMs > 0) api.setEstimate(id, event.durationMs);
  events.link(event.id, id);
  return id;
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
export function startEvent(event: Event, api: TasksApi, events: EventsApi) {
  const linked = findLinked(event, api);
  if (linked !== null) {
    api.start(linked.id);
    return;
  }
  api.start(linkedTask(event, api, events));
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
) {
  const to = Math.min(eventEnd(event), now);
  if (to <= event.start) return;

  const linked = findLinked(event, api);
  const id = linked !== null ? linked.id : linkedTask(event, api, events);
  api.record(id, event.start, to);
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
