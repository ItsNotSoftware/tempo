import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { Pencil, Play, Trash2 } from "lucide-react";
import {
  eventEnd,
  isTracking,
  startEvent,
  type Event,
  type EventsApi,
} from "../lib/events";
import { groupTone, type TasksApi } from "../lib/tasks";
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
  /** Where it sits in the day's column, worked out by the screen. */
  style: CSSProperties;
  /** Sharing its hour with another booking, so it has half the room to say it in. */
  narrow?: boolean;
  /** A day that's been and gone: nothing left to book or to start. */
  readOnly?: boolean;
}

/** One booking, sitting in its slot. */
export function EventCard({
  event,
  now,
  day,
  api,
  events,
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

  const tone =
    event.group === null
      ? "var(--text-faint)"
      : `var(--group-${groupTone(event.group)})`;

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
      style={{ ...style, "--tone": tone } as CSSProperties}
    >
      {editing ? (
        <form className="event__edit" onSubmit={commit}>
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

          {!readOnly && (
            <div className="event__actions">
              <button
                className={`icon-btn icon-btn--sm${tracking ? " is-on" : ""}`}
                title={tracking ? "Tracking this" : "Start a timer for this"}
                aria-label="Start timer for event"
                onClick={() => startEvent(event, api, events)}
              >
                <Play size={14} strokeWidth={2.25} fill="currentColor" />
              </button>

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
            </div>
          )}
        </>
      )}
    </article>
  );
}
