import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from "react";
import { CalendarClock, Plus } from "lucide-react";
import { DayNav } from "../components/DayNav";
import { EventCard } from "../components/EventCard";
import {
  dayWindow,
  eventEnd,
  eventsOn,
  lay,
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
/** The shortest a block is ever drawn, so a five-minute booking is still
 *  something you can read and hit. `lay` packs lanes against the same figure —
 *  two blocks drawn on top of each other have to go side by side whatever
 *  their times say. The 3px is the gap every block already leaves below
 *  itself: encroaching by that much is what a full-length booking does too,
 *  and splitting a cluster three ways over it would cost far more room than
 *  it saves. */
const MIN_PX = 24;
const MIN_MS = ((MIN_PX - 3) / HOUR_PX) * HOUR;

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
  // Ahead of now, so there is nothing to put on the clock yet — ▶ would start
  // a timer today for a meeting that hasn't happened.
  const ahead = day > today;

  const booked = eventsOn(events.events, from, to);
  const total = booked.reduce((sum, e) => sum + e.durationMs, 0);

  // The booking form's time lives up here: the grid aims it by being clicked,
  // and it steps on to the end of whatever was just booked.
  const [at, setAt] = useState(() => defaultAt(day, now));
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => setAt(defaultAt(day, Date.now())), [day]);

  // Hours are `from + n * HOUR` rather than calendar hours, so the 23- and
  // 25-hour days the clocks change on still line up with the bookings on them.
  const hourOf = (ts: number) => (ts - from) / HOUR;
  const { first, last } = dayWindow(booked, from, isToday ? now : null);
  // One more line than there are hours, so the day is closed off at the bottom.
  const hours = Array.from({ length: last - first + 1 }, (_, i) => first + i);
  const top = (ts: number) => (hourOf(ts) - first) * HOUR_PX;

  // A day can run to eighteen hours once anything is booked outside working
  // ones, so opening the screen at the top would land you on an empty 06:00.
  const anchor = useRef<HTMLDivElement>(null);
  const anchorAt = isToday ? now : (booked[0]?.start ?? null);
  useEffect(() => {
    anchor.current?.scrollIntoView({ block: "nearest" });
  }, [day]);

  /** Click an empty stretch of the day to aim the booking form at it. */
  function aimAt(e: ReactMouseEvent<HTMLDivElement>) {
    if (past || (e.target as HTMLElement).closest(".event") !== null) return;
    const box = e.currentTarget.getBoundingClientRect();
    // Read as a fraction of the box rather than in pixels: the app carries a
    // `zoom`, and a client coordinate is in the scaled space `HOUR_PX` isn't.
    const hour = first + ((e.clientY - box.top) / box.height) * (last - first);
    const quarter = Math.min(last, Math.max(first, Math.round(hour * 4) / 4));
    setAt(formatTimeOfDay(from + quarter * HOUR));
    titleRef.current?.focus();
  }

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

      {!past && (
        <Booking
          day={day}
          events={events}
          at={at}
          onAt={setAt}
          titleRef={titleRef}
        />
      )}

      <div className="sched__grid" style={{ height: (last - first) * HOUR_PX }}>
        {hours.map((hour) => (
          <div
            className="sched__hour"
            key={hour}
            style={{ top: (hour - first) * HOUR_PX }}
          >
            {/* The closing line is the next day's midnight, and `00:00` at the
                foot of a day reads as its top. The gutter keeps its width. */}
            <span className="sched__label">
              {hour === 24 ? "" : formatTimeOfDay(from + hour * HOUR)}
            </span>
          </div>
        ))}

        <div
          className={`sched__lanes${past ? "" : " sched__lanes--bookable"}`}
          onClick={aimAt}
        >
          {anchorAt !== null && (
            <div
              ref={anchor}
              className="sched__anchor"
              /* An hour behind and three ahead: the screen scrolls the
                 minimum to bring that band into view, which leaves what's
                 coming below the line rather than the morning above it. */
              style={{ top: top(anchorAt) - HOUR_PX, height: HOUR_PX * 4 }}
              aria-hidden
            />
          )}

          {isToday && (
            <div className="sched__now" style={{ top: top(now) }} aria-hidden>
              <span className="sched__now-time">{formatTimeOfDay(now)}</span>
            </div>
          )}

          {booked.length === 0 && (
            <div className="sched__empty">
              <CalendarClock size={30} strokeWidth={1.5} />
              <p>{past ? "Nothing was booked." : "Nothing booked yet."}</p>
              {!past && (
                <p className="sched__empty-sub">
                  Click an hour, or book above — it&rsquo;ll sit where it falls.
                </p>
              )}
            </div>
          )}

          {lay(booked, MIN_MS).map(({ event, lane, lanes }) => (
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
              canStart={!past && !ahead}
              style={{
                top: Math.max(0, top(event.start)),
                // Clamped so a 5-minute booking is still something you can hit.
                height: Math.max(
                  MIN_PX,
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

/** The next half hour — where a booking starts unless you say otherwise. */
function defaultAt(day: number, now: number): string {
  const when = new Date(startOfDay(now) === day ? now : day);
  // Built through `Date` rather than by adding milliseconds, so the hour the
  // clocks change still lands where it reads.
  if (startOfDay(now) === day) {
    when.setMinutes(Math.ceil((when.getMinutes() + 1) / 30) * 30, 0, 0);
  } else {
    when.setHours(9, 0, 0, 0);
  }
  return formatTimeOfDay(when.getTime());
}

/**
 * Book something. Three fields rather than one line of syntax — a time is the
 * point of the thing, and hiding it in a sentence would be clever at the cost
 * of being readable. A leading `TEMPO-42 ` still files it under that group,
 * the same rule the task composer follows.
 */
function Booking({
  day,
  events,
  at,
  onAt,
  titleRef,
}: {
  day: number;
  events: EventsApi;
  at: string;
  onAt: (at: string) => void;
  titleRef: RefObject<HTMLInputElement | null>;
}) {
  const [title, setTitle] = useState("");
  const [length, setLength] = useState("30m");

  const start = parseTimeOfDay(at, day);
  const durationMs = parseEstimate(length);
  const ready = title.trim() !== "" && start !== null && durationMs !== null;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready || start === null || durationMs === null) return;
    events.add(title.trim(), start, durationMs);
    setTitle("");
    // Aim at the end of what was just booked: a morning of back-to-back
    // meetings is typed one after another, and leaving the time where it was
    // would quietly stack the next one on top of this.
    onAt(formatTimeOfDay(start + durationMs));
  }

  return (
    <form className="booking" onSubmit={submit}>
      <input
        ref={titleRef}
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
          onChange={(e) => onAt(e.currentTarget.value)}
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
