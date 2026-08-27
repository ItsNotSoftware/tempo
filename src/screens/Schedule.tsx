import { useEffect, useState, type FormEvent } from "react";
import { CalendarClock, Plus } from "lucide-react";
import { DayNav } from "../components/DayNav";
import { EventCard } from "../components/EventCard";
import {
  eventEnd,
  eventsOn,
  type Event,
  type EventsApi,
} from "../lib/events";
import type { TasksApi } from "../lib/tasks";
import {
  addDays,
  formatDurationShort,
  formatTimeOfDay,
  parseEstimate,
  parseTimeOfDay,
  startOfDay,
} from "../lib/time";
import "./Schedule.css";

interface ScheduleProps {
  api: TasksApi;
  events: EventsApi;
  now: number;
  /** The day in view, shared with the timer and the notebook. */
  day: number;
  onDay: (dayStart: number) => void;
  /** Say what a card's ▶ or Log just did — the schedule itself doesn't
   *  otherwise change shape when either fires. */
  onToast: (message: string) => void;
}

const HOUR = 3_600_000;
/** Tall enough that a half-hour booking is still a readable block. */
const HOUR_PX = 46;
/** The hours a working day is assumed to cover before anything is booked. */
const OPENS = 8;
const CLOSES = 20;

/**
 * The day as a column of hours, with what's booked sitting where it falls.
 * This is the one screen that looks forward — everything else in the app is a
 * measurement, and a measurement can only be of something that already happened.
 */
export function Schedule({ api, events, now, day, onDay, onToast }: ScheduleProps) {
  const today = startOfDay(now);
  const from = day;
  const to = addDays(day, 1);
  const isToday = day === today;
  // A day that's been and gone: still worth reading, nothing left to book.
  const past = day < today;

  const booked = eventsOn(events.events, from, to);
  const total = booked.reduce((sum, e) => sum + e.durationMs, 0);

  // Hours are `from + n * HOUR` rather than calendar hours, so the 23- and
  // 25-hour days the clocks change on still line up with the bookings on them.
  const hourOf = (ts: number) => (ts - from) / HOUR;
  const first = Math.max(
    0,
    Math.floor(Math.min(OPENS, ...booked.map((e) => hourOf(e.start)))),
  );
  const last = Math.min(
    24,
    Math.ceil(Math.max(CLOSES, ...booked.map((e) => hourOf(eventEnd(e))))),
  );
  // One more line than there are hours, so the day is closed off at the bottom.
  const hours = Array.from({ length: last - first + 1 }, (_, i) => first + i);
  const top = (ts: number) => (hourOf(ts) - first) * HOUR_PX;

  return (
    <div className="sched">
      <header className="sched__head">
        <span className="sched__total">{formatDurationShort(total)}</span>
        <span className="sched__sub">
          {booked.length === 0
            ? "nothing booked"
            : `across ${booked.length} event${booked.length > 1 ? "s" : ""}`}
        </span>

        {/* The one nav in the app that goes forward — you book ahead. */}
        <DayNav day={day} now={now} onDay={onDay} forward />
      </header>

      {!past && <Booking day={day} now={now} events={events} />}

      <div className="sched__grid" style={{ height: (last - first) * HOUR_PX }}>
        {hours.map((hour) => (
          <div
            className="sched__hour"
            key={hour}
            style={{ top: (hour - first) * HOUR_PX }}
          >
            <span className="sched__label">
              {formatTimeOfDay(from + hour * HOUR)}
            </span>
          </div>
        ))}

        <div className="sched__lanes">
          {isToday && hourOf(now) >= first && hourOf(now) <= last && (
            <div className="sched__now" style={{ top: top(now) }} aria-hidden />
          )}

          {booked.length === 0 && (
            <div className="sched__empty">
              <CalendarClock size={30} strokeWidth={1.5} />
              <p>{past ? "Nothing was booked." : "Nothing booked yet."}</p>
              {!past && (
                <p className="sched__empty-sub">
                  Book a meeting and it&rsquo;ll sit where it falls in the day.
                </p>
              )}
            </div>
          )}

          {lay(booked).map(({ event, lane, lanes }) => (
            <EventCard
              key={event.id}
              event={event}
              now={now}
              day={day}
              api={api}
              events={events}
              onToast={onToast}
              narrow={lanes > 1}
              readOnly={past}
              style={{
                top: Math.max(0, top(event.start)),
                // Clamped so a 5-minute booking is still something you can hit.
                height: Math.max(
                  24,
                  (Math.min(eventEnd(event), to) - Math.max(event.start, from)) /
                    HOUR *
                    HOUR_PX -
                    3,
                ),
                left: `${(lane / lanes) * 100}%`,
                width: `calc(${100 / lanes}% - 4px)`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

interface Laid {
  event: Event;
  lane: number;
  lanes: number;
}

/**
 * Side by side when two bookings overlap. Each cluster of overlapping events is
 * split only as many ways as that cluster needs, so one double-booked hour
 * doesn't squeeze the rest of the day into half the width.
 */
function lay(booked: Event[]): Laid[] {
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
    lanes[lane] = eventEnd(event);

    cluster.push({ event, lane, lanes: 1 });
    clusterEnd = Math.max(clusterEnd, eventEnd(event));
  }
  close();

  return laid;
}

/** The next half hour — where a booking starts unless you say otherwise. */
function defaultAt(day: number, now: number): string {
  if (startOfDay(now) !== day) return formatTimeOfDay(day + 9 * HOUR);
  const half = 30 * 60_000;
  return formatTimeOfDay(Math.ceil((now + 1) / half) * half);
}

/**
 * Book something. Three fields rather than one line of syntax — a time is the
 * point of the thing, and hiding it in a sentence would be clever at the cost
 * of being readable. A leading `TEMPO-42 ` still files it under that group,
 * the same rule the task composer follows.
 */
function Booking({
  day,
  now,
  events,
}: {
  day: number;
  now: number;
  events: EventsApi;
}) {
  const [title, setTitle] = useState("");
  const [at, setAt] = useState(() => defaultAt(day, now));
  const [length, setLength] = useState("30m");

  // Stepping to another day re-aims the time at that day's morning.
  useEffect(() => {
    setAt(defaultAt(day, Date.now()));
  }, [day]);

  const start = parseTimeOfDay(at, day);
  const durationMs = parseEstimate(length);
  const ready = title.trim() !== "" && start !== null && durationMs !== null;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready || start === null || durationMs === null) return;
    events.add(title.trim(), start, durationMs);
    setTitle("");
  }

  return (
    <form className="booking" onSubmit={submit}>
      <input
        className="booking__title"
        value={title}
        placeholder="What's booked?"
        aria-label="New event name"
        spellCheck={false}
        onChange={(e) => setTitle(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") e.currentTarget.blur();
        }}
      />

      <span className="booking__divider" />

      <label className="booking__field">
        at
        <input
          className={`estimate-field booking__at${start === null ? " is-bad" : ""}`}
          value={at}
          aria-label="Starts at"
          spellCheck={false}
          onChange={(e) => setAt(e.currentTarget.value)}
        />
      </label>

      <label className="booking__field">
        for
        <input
          className={`estimate-field booking__for${
            durationMs === null ? " is-bad" : ""
          }`}
          value={length}
          aria-label="Lasts"
          spellCheck={false}
          onChange={(e) => setLength(e.currentTarget.value)}
        />
      </label>

      <button type="submit" className="booking__add" disabled={!ready}>
        <Plus size={18} strokeWidth={2.5} />
        Book
      </button>
    </form>
  );
}
