import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { Check, History, Pencil, Play, RotateCcw, Trash2 } from "lucide-react";
import {
  eventEnd,
  eventTaskLabel,
  eventTone,
  isLogged,
  isTracking,
  logEvent,
  startEvent,
  type Event,
  type EventsApi,
} from "../lib/events";
import type { TasksApi } from "../lib/tasks";
import {
  formatDurationShort,
  formatTimeOfDay,
  parseEstimate,
  parseTimeOfDay,
} from "../lib/time";
import "./EventCard.css";

interface EventCardProps {
  event: Event;
  now: number;
  /** Midnight of the day it's drawn on — where a re-typed time is read onto. */
  day: number;
  api: TasksApi;
  events: EventsApi;
  /** Say what ▶ or Log just did — neither otherwise changes the schedule's
   *  own shape enough to notice. */
  onToast: (message: string) => void;
  /** Where it sits in the day's column, worked out by the screen. */
  style: CSSProperties;
  /** Sharing its hour with another booking, so it has half the room to say it in. */
  narrow?: boolean;
  /** A day that's been and gone: nothing left to book or to start, but a
   *  meeting you actually sat in is still worth logging. */
  readOnly?: boolean;
}

/** The six hues a booking can be pinned to, same ones a group hashes into. */
const SWATCHES = [1, 2, 3, 4, 5, 6] as const;

/** One booking, sitting in its slot. */
export function EventCard({
  event,
  now,
  day,
  api,
  events,
  onToast,
  style,
  narrow = false,
  readOnly = false,
}: EventCardProps) {
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Reset the delete confirmation if the user moves on without answering.
  useEffect(() => {
    if (!confirmDelete) return;
    const timer = setTimeout(() => setConfirmDelete(false), 4000);
    return () => clearTimeout(timer);
  }, [confirmDelete]);

  const end = eventEnd(event);
  const past = end <= now;
  const live = event.start <= now && now < end;
  const tracking = isTracking(event, api);
  const title = event.title.trim() === "" ? "Untitled" : event.title;

  const tone = eventTone(event);
  /**
   * Log is for a booking that has **ended**. Offered while one is still under
   * way it banks only the minutes so far and then locks — one press a minute
   * in would record a minute and call the meeting done. A booking you're
   * actually in has ▶, which is the honest answer for time still passing; if
   * you joined it late, the row's clock takes the figure it should read.
   *
   * `logged` is the other half: once the task has a minute on it the window is
   * already recorded, and ▶ and Log would otherwise fight over the same one.
   */
  const canLog = past;
  const logged = isLogged(event, api, now);

  function handleStart() {
    const task = startEvent(event, api, events);
    onToast(`Started · ${eventTaskLabel(task)}`);
  }

  function handleLog() {
    const result = logEvent(event, api, events, now);
    if (result === null) return;
    onToast(`Logged ${formatDurationShort(result.loggedMs)} · ${eventTaskLabel(result)}`);
  }

  function commit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const text = String(form.get("title") ?? "").trim();
    const start = parseTimeOfDay(String(form.get("at") ?? ""), day);
    const durationMs = parseEstimate(String(form.get("for") ?? ""));
    // Anything unreadable leaves the booking as it was, rather than guessing.
    if (text === "" || start === null || durationMs === null) {
      setEditing(false);
      return;
    }
    events.rebook(event.id, text, start, durationMs);
    setEditing(false);
  }

  return (
    <article
      className={`event${past ? " event--past" : ""}${
        live ? " event--live" : ""
      }${tracking ? " event--tracking" : ""}${editing ? " event--editing" : ""}`}
      style={
        {
          ...style,
          "--tone": `var(--group-${tone})`,
          "--tone-soft": `var(--group-${tone}-soft)`,
        } as CSSProperties
      }
    >
      {editing ? (
        <form className="event__edit" onSubmit={commit}>
          <div className="event__edit-row">
            <input
              name="title"
              className="event__field"
              defaultValue={
                event.group === null ? event.title : `${event.group} ${event.title}`
              }
              aria-label="Event name"
              spellCheck={false}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Escape") setEditing(false);
              }}
            />
            <input
              name="at"
              className="estimate-field event__at"
              defaultValue={formatTimeOfDay(event.start)}
              aria-label="Starts at"
              spellCheck={false}
            />
            <input
              name="for"
              className="estimate-field event__for"
              defaultValue={formatDurationShort(event.durationMs)}
              aria-label="Lasts"
              spellCheck={false}
            />
            <button type="submit" className="btn btn--ghost event__save">
              Save
            </button>
          </div>

          <div className="event__colors">
            {SWATCHES.map((n) => (
              <button
                key={n}
                type="button"
                className={`event__swatch${event.color === n ? " is-selected" : ""}`}
                style={{ "--swatch": `var(--group-${n})` } as CSSProperties}
                title={`Colour ${n}`}
                aria-label={`Set colour ${n}`}
                onClick={() => events.setColor(event.id, n)}
              />
            ))}
            <button
              type="button"
              className={`icon-btn icon-btn--sm event__reset${
                event.color === null ? " is-on" : ""
              }`}
              title="Match the group's colour"
              aria-label="Reset to the derived colour"
              onClick={() => events.setColor(event.id, null)}
            >
              <RotateCcw size={13} />
            </button>
          </div>
        </form>
      ) : (
        <>
          <i className="dot dot--sm event__dot" />
          <time className="event__when" dateTime={new Date(event.start).toISOString()}>
            {formatTimeOfDay(event.start)}
          </time>
          <span
            className="event__title"
            title={`${title} · ${formatDurationShort(event.durationMs)}`}
          >
            {title}
          </span>
          {/* In a shared hour the name gets the room; the length is in the
              tooltip and the block's own height already says it. */}
          {!narrow && (
            <span className="event__len">
              {formatDurationShort(event.durationMs)}
            </span>
          )}

          <div className="event__actions">
            {!readOnly && (
              <button
                className={`icon-btn icon-btn--sm event__play${tracking ? " is-on" : ""}`}
                title={tracking ? "Tracking this" : "Start a timer for this"}
                aria-label="Start timer for event"
                onClick={handleStart}
              >
                <Play size={14} strokeWidth={2.25} fill="currentColor" />
              </button>
            )}

            {/* A day gone by is a record, same as the timer — but logging a
                meeting you actually sat in is recording one that was never
                taken, the opposite of rewriting one, so it's the one action
                a past day still offers. */}
            {canLog && (
              <button
                className={`icon-btn icon-btn--sm${logged ? " event__logged" : ""}`}
                title={logged ? "Logged" : "Log the time you were in it"}
                aria-label={logged ? "Meeting logged" : "Log this meeting"}
                disabled={logged}
                onClick={handleLog}
              >
                {logged ? (
                  <>
                    <Check size={13} strokeWidth={2.5} />
                    Logged
                  </>
                ) : (
                  <History size={14} />
                )}
              </button>
            )}

            {!readOnly && (
              <>
                <button
                  className={`icon-btn icon-btn--sm${editing ? " is-on" : ""}`}
                  title="Change the booking"
                  aria-label="Edit event"
                  onClick={() => setEditing(true)}
                >
                  <Pencil size={14} />
                </button>

                <button
                  className={`icon-btn icon-btn--sm icon-btn--danger${
                    confirmDelete ? " is-armed" : ""
                  }`}
                  title={confirmDelete ? "Click again to delete" : "Delete"}
                  aria-label={confirmDelete ? "Confirm delete event" : "Delete event"}
                  onClick={() =>
                    confirmDelete ? events.remove(event.id) : setConfirmDelete(true)
                  }
                >
                  <Trash2 size={confirmDelete ? 13 : 15} />
                  {confirmDelete && "Delete?"}
                </button>
              </>
            )}
          </div>
        </>
      )}
    </article>
  );
}
