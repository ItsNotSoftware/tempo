import { useEffect, useRef, useState } from "react";
import { Pin, PinOff, Plus, Trash2 } from "lucide-react";
import {
  dayPage,
  dayPages,
  keptNotes,
  useNotes,
  type Note,
} from "../lib/notes";
import {
  elapsedBetween,
  groupTone,
  knownGroups,
  taskCount,
  touchesDay,
  type TasksApi,
} from "../lib/tasks";
import {
  addDays,
  formatDate,
  formatDay,
  formatDurationShort,
  startOfDay,
} from "../lib/time";
import "./Notes.css";

interface NotesProps {
  /** Read-only in here: the day's ribbon, and nothing else. */
  api: TasksApi;
  now: number;
  /** The day in view, shared with the timer. */
  day: number;
  onDay: (dayStart: number) => void;
  /** Which kept note is open; `null` is the day's own page. */
  kept: string | null;
  onKept: (id: string | null) => void;
  onOpenTimer: () => void;
}

export function Notes({
  api,
  now,
  day,
  onDay,
  kept,
  onKept,
  onOpenTimer,
}: NotesProps) {
  const notes = useNotes();
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const name = useRef<HTMLInputElement>(null);

  // Reset the delete confirmation if you move on without answering.
  useEffect(() => {
    if (confirmDelete === null) return;
    const timer = setTimeout(() => setConfirmDelete(null), 4000);
    return () => clearTimeout(timer);
  }, [confirmDelete]);

  const today = startOfDay(now);
  const shelf = keptNotes(notes.notes);
  // A note deleted out from under the selection drops back to the day page.
  const open = shelf.find((n) => n.id === kept) ?? null;

  /**
   * Today, wherever the cursor is pointed, and every day already written on.
   * Days with tracked time but no page stay out of it — this is a list of
   * pages, and a list of days would only be a second day nav.
   */
  const days = [
    ...new Set([today, day, ...dayPages(notes.notes).map((n) => n.day ?? 0)]),
  ].sort((a, b) => b - a);

  function newKept() {
    onKept(notes.keep());
    // The name field only mounts once the new note is the one on screen.
    requestAnimationFrame(() => name.current?.focus());
  }

  function drop(note: Note) {
    if (confirmDelete !== note.id) return setConfirmDelete(note.id);
    setConfirmDelete(null);
    if (note.id === kept) onKept(null);
    notes.remove(note.id);
  }

  return (
    <div className="notes">
      <aside className="pages">
        {days.map((d) => (
          <div
            key={d}
            className={`pages__row${open === null && d === day ? " is-on" : ""}`}
          >
            <button
              className="pages__open"
              onClick={() => {
                onDay(d);
                onKept(null);
              }}
            >
              <span className="pages__lead">
                {open === null && d === day && <i className="pages__dot" />}
              </span>
              <span className="pages__label">{formatDay(d, now)}</span>
            </button>
          </div>
        ))}

        {/* The one create button that can't hide until hover: it's the only way
            to make the first note, and a hidden one is a dead end. */}
        <div className="pages__rule">
          kept
          <button
            className="icon-btn icon-btn--sm"
            title="New kept note"
            aria-label="New kept note"
            onClick={newKept}
          >
            <Plus size={15} />
          </button>
        </div>

        {shelf.length === 0 && (
          <p className="pages__empty">Nothing yet.</p>
        )}

        {shelf.map((note) => (
          <div
            key={note.id}
            className={`pages__row${note.id === kept ? " is-on" : ""}`}
          >
            <button className="pages__open" onClick={() => onKept(note.id)}>
              <span className="pages__lead">
                {note.id === kept ? (
                  <i className="pages__dot" />
                ) : note.pinned ? (
                  <Pin size={11} />
                ) : null}
              </span>
              <span className="pages__label">
                {note.title.trim() === "" ? "Untitled note" : note.title}
              </span>
            </button>

            <span className="pages__actions">
              {/* Armed, the confirmation needs the whole row — there isn't
                  190px of room for a question and a pin both. */}
              {confirmDelete !== note.id && (
                <button
                  className="icon-btn icon-btn--sm"
                  title={note.pinned ? "Unpin" : "Pin to the top"}
                  aria-label={note.pinned ? "Unpin note" : "Pin note"}
                  onClick={() => notes.pin(note.id, !note.pinned)}
                >
                  {note.pinned ? <PinOff size={13} /> : <Pin size={13} />}
                </button>
              )}
              <button
                className={`icon-btn icon-btn--sm icon-btn--danger${
                  confirmDelete === note.id ? " is-armed" : ""
                }`}
                title={
                  confirmDelete === note.id ? "Click again to delete" : "Delete"
                }
                aria-label={
                  confirmDelete === note.id ? "Confirm delete" : "Delete note"
                }
                onClick={() => drop(note)}
              >
                <Trash2 size={confirmDelete === note.id ? 12 : 13} />
                {confirmDelete === note.id && "Delete?"}
              </button>
            </span>
          </div>
        ))}
      </aside>

      {open === null ? (
        <section className="page">
          <h1 className="page__title">{formatDate(day)}</h1>
          <Tracked
            api={api}
            now={now}
            day={day}
            label={formatDay(day, now)}
            onOpen={onOpenTimer}
          />
          <textarea
            className="page__body"
            aria-label="Note"
            placeholder={`Notes for ${formatDate(day)}…`}
            value={dayPage(notes.notes, day)?.body ?? ""}
            onChange={(e) => notes.writeDay(day, e.target.value)}
          />
        </section>
      ) : (
        <section className="page">
          <input
            ref={name}
            className="page__name"
            aria-label="Note name"
            placeholder="Untitled note"
            value={open.title}
            onChange={(e) => notes.rename(open.id, e.target.value)}
          />
          <textarea
            className="page__body"
            aria-label="Note"
            placeholder="Whatever you keep coming back to…"
            value={open.body}
            onChange={(e) => notes.write(open.id, e.target.value)}
          />
        </section>
      )}
    </div>
  );
}

/**
 * What you were doing on the day you wrote the page. The whole reason the
 * notebook sits in a time tracker rather than in a text editor — and it's built
 * entirely out of what the timer already knows.
 */
function Tracked({
  api,
  now,
  day,
  label,
  onOpen,
}: {
  api: TasksApi;
  now: number;
  day: number;
  label: string;
  onOpen: () => void;
}) {
  const to = addDays(day, 1);
  const tasks = api.tasks.filter((t) => touchesDay(t, day, to));
  const total = tasks.reduce((sum, t) => sum + elapsedBetween(t, day, to, now), 0);

  // Nothing tracked says nothing at all, rather than a row of zeroes.
  if (total <= 0) return null;

  return (
    <button
      className="page__tracked"
      title={`Open ${label} in the timer`}
      onClick={onOpen}
    >
      <span className="page__spent">{formatDurationShort(total)}</span>
      {knownGroups(tasks).map((group) => (
        <i
          key={group}
          className="page__dot"
          style={{ background: `var(--group-${groupTone(group)})` }}
        />
      ))}
      <span className="page__count">{taskCount(tasks.length)}</span>
    </button>
  );
}
