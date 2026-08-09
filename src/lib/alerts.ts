import { useEffect, useRef, useState } from "react";
import { isTauri, type PluginListener } from "@tauri-apps/api/core";
import {
  isPermissionGranted,
  onAction,
  registerActionTypes,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { eventEnd, type Event } from "./events";
import {
  estimates,
  taskStatus,
  type Estimate,
  type Groups,
  type Task,
} from "./tasks";
import { formatDurationShort, formatTimeOfDay } from "./time";

/** Which alerts have already fired, so a restart doesn't repeat them. */
const ALERTS_KEY = "tempo.alerts.v1";

function readFired(): Set<string> {
  try {
    const raw = localStorage.getItem(ALERTS_KEY);
    if (raw === null) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? (parsed as string[]) : []);
  } catch {
    return new Set();
  }
}

function writeFired(fired: Set<string>) {
  localStorage.setItem(ALERTS_KEY, JSON.stringify([...fired]));
}

/**
 * Says something the one time it's worth interrupting for: the task you're on
 * has passed the estimate you set for it.
 *
 * Only the running task and its group are ever checked — an estimate can only
 * be crossed while the clock is moving — so this is two comparisons a tick.
 */
export function useEstimateAlerts(tasks: Task[], groups: Groups, now: number) {
  // Read once, then kept in memory — this runs every tick.
  const fired = useRef<Set<string> | null>(null);
  fired.current ??= readFired();

  useEffect(() => {
    if (!isTauri()) return;

    const current = tasks.find((t) => taskStatus(t) === "running") ?? null;
    if (current === null || fired.current === null) return;

    // The same rule the tray paints on, so the menu bar and the notification
    // can never disagree about what "over" means.
    for (const estimate of estimates(current, tasks, groups, now)) {
      check(fired.current, estimate);
    }
  }, [tasks, groups, now]);
}

/**
 * Fire once on the way over, and re-arm on the way back under — so raising an
 * estimate past what's been spent means the new one can alert in its turn.
 */
function check(fired: Set<string>, estimate: Estimate) {
  const { key, spentMs, estimateMs } = estimate;

  if (!estimate.over) {
    if (fired.delete(key)) writeFired(fired);
    return;
  }
  if (fired.has(key)) return;

  fired.add(key);
  writeFired(fired);
  void notify(
    estimate.scope === "task" ? "Over estimate" : "Group over estimate",
    // `over` doesn't narrow the estimate for TypeScript, but it can't be null
    // here — nothing without an estimate is ever over one.
    `${estimate.subject} — ${formatDurationShort(spentMs)} of ~${formatDurationShort(estimateMs ?? 0)}`,
  );
}

/** Asked for at the first alert, so the prompt arrives with a reason attached. */
async function notify(title: string, body: string, event?: Event) {
  try {
    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === "granted";
    if (!granted) return;
    sendNotification(
      event === undefined
        ? { title, body }
        : {
            title,
            body,
            actionTypeId: ACTION_TYPE,
            extra: { eventId: event.id },
          },
    );
  } catch {
    // No notifications available; nothing worth breaking the timer over.
  }
}

/** How long before a booking the first word about it comes. */
const LEAD = 5 * 60_000;
/**
 * How late a reminder is still worth having. Past this it's marked as said and
 * never spoken — a nudge about a meeting you're already in the middle of is
 * noise, and opening the app on Monday shouldn't replay Friday.
 */
const STALE = 10 * 60_000;

const ACTION_TYPE = "event";

interface Due {
  key: string;
  at: number;
  starting: boolean;
  event: Event;
}

function thresholds(events: Event[]): Due[] {
  return events.flatMap((event) => [
    { key: `event:${event.id}:soon`, at: event.start - LEAD, starting: false, event },
    { key: `event:${event.id}:start`, at: event.start, starting: true, event },
  ]);
}

/**
 * Speaks up twice for anything booked: five minutes out, and as it starts. The
 * one at the top carries an action, because the moment you're told a meeting
 * has started is the moment you'd want its clock going.
 *
 * Returns whether something is imminent or under way, which is what the rail
 * marks — the same reason it marks a running timer.
 */
export function useEventAlerts(
  events: Event[],
  now: number,
  onStart: (event: Event) => void,
): boolean {
  const fired = useRef<Set<string> | null>(null);
  fired.current ??= readFired();

  /** Bumped by the timer below, purely to re-run the sweep on a threshold. */
  const [tick, retick] = useState(0);

  // The action fires long after the render that sent the notification, so it
  // reaches the current bookings through a ref rather than that render's copy.
  const latest = useRef({ events, onStart });
  latest.current = { events, onStart };

  useEffect(() => {
    if (!isTauri()) return;

    let listener: PluginListener | null = null;
    let live = true;

    void (async () => {
      try {
        await registerActionTypes([
          {
            id: ACTION_TYPE,
            actions: [{ id: "start", title: "Start timer", foreground: true }],
          },
        ]);
        const bound = await onAction((notification) => {
          const id = notification.extra?.eventId;
          const event = latest.current.events.find((e) => e.id === id);
          if (event !== undefined) latest.current.onStart(event);
        });
        if (live) listener = bound;
        else void bound.unregister();
      } catch {
        // Action buttons aren't offered everywhere — macOS wants a bundled app.
        // The notification still lands; the tray and the row still start it.
      }
    })();

    return () => {
      live = false;
      void listener?.unregister();
    };
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    const said = fired.current;
    if (said === null) return;

    const due = thresholds(events);

    // An event's alerts never re-arm the way an estimate's do, so the set would
    // grow forever; anything whose booking is gone goes with it.
    const known = new Set(due.map((d) => d.key));
    let changed = false;
    for (const key of said) {
      if (key.startsWith("event:") && !known.has(key)) {
        said.delete(key);
        changed = true;
      }
    }

    const at = Date.now();
    for (const item of due) {
      if (item.at > at || said.has(item.key)) continue;
      said.add(item.key);
      changed = true;
      if (at - item.at > STALE) continue;
      void notify(
        item.starting ? "Starting now" : "In 5 minutes",
        `${formatTimeOfDay(item.event.start)} · ${label(item.event)}`,
        item.starting ? item.event : undefined,
      );
    }
    if (changed) writeFired(said);

    // The app's clock idles at a minute, which would make a five-minute warning
    // up to a minute late. Waiting on the threshold itself lands it on time.
    const next = due.reduce<number | null>(
      (soonest, item) =>
        item.at > at && (soonest === null || item.at < soonest)
          ? item.at
          : soonest,
      null,
    );
    if (next === null) return;
    const timer = setTimeout(() => retick((n) => n + 1), next - at + 250);
    return () => clearTimeout(timer);
    // `tick` is the reschedule landing, not a value anything in here reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, now, tick]);

  return events.some((e) => e.start - LEAD <= now && now < eventEnd(e));
}

function label(event: Event): string {
  const name = event.title.trim() === "" ? "Untitled" : event.title.trim();
  return event.group === null ? name : `${event.group} · ${name}`;
}
