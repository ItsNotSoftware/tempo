import { useEffect, useState } from "react";
import { parseEntry, taskStatus, type TasksApi } from "./tasks";

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
  const linked =
    event.taskId === null
      ? null
      : (api.tasks.find((t) => t.id === event.taskId) ?? null);

  if (linked !== null) {
    api.start(linked.id);
    return;
  }

  const title = event.title.trim() === "" ? "Untitled" : event.title.trim();
  const id = api.add(title, event.group);
  if (event.durationMs > 0) api.setEstimate(id, event.durationMs);
  events.link(event.id, id);
  api.start(id);
}

/** Is this event's task the one currently counting? */
export function isTracking(event: Event, api: TasksApi): boolean {
  const task = api.tasks.find((t) => t.id === event.taskId);
  return task !== undefined && taskStatus(task) === "running";
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

    remove: (id: string) =>
      setEvents((current) => current.filter((e) => e.id !== id)),
  };
}
