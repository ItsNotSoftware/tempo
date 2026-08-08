import { useEffect, useRef, useState } from "react";

const NOTES_KEY = "tempo.notes.v1";

/**
 * Two kinds of page, told apart by `day`: the dated one the notebook opens on,
 * and a kept note — something you named because you keep coming back to it.
 */
export interface Note {
  id: string;
  /** Midnight of the day this page belongs to; `null` on a kept note. */
  day: number | null;
  /** A kept note's name. A day page is titled by its date. */
  title: string;
  body: string;
  /** Kept notes only — pinned ones sit at the top of the shelf. */
  pinned: boolean;
  createdAt: number;
}

function readNotes(): Note[] {
  try {
    const raw = localStorage.getItem(NOTES_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Note[]) : [];
  } catch {
    return [];
  }
}

/** The page for a day, or `null` — an untouched day has no row at all. */
export function dayPage(notes: Note[], day: number): Note | null {
  return notes.find((n) => n.day === day) ?? null;
}

/** Day pages, most recent first. */
export function dayPages(notes: Note[]): Note[] {
  return notes
    .filter((n) => n.day !== null)
    .sort((a, b) => (b.day ?? 0) - (a.day ?? 0));
}

/**
 * Kept notes: pinned first, then in the order they were made — never by when
 * they were last touched. A shelf that reshuffles under you is one you stop
 * being able to find things on, the same reason the day's rows don't sort by
 * time.
 */
export function keptNotes(notes: Note[]): Note[] {
  return notes
    .filter((n) => n.day === null)
    .sort(
      (a, b) => Number(b.pinned) - Number(a.pinned) || a.createdAt - b.createdAt,
    );
}

/**
 * Long enough to swallow a burst of typing, short enough that quitting from the
 * tray menu in the same breath as a keystroke is the only way to lose one.
 */
const SAVE_DELAY = 400;

export type NotesApi = ReturnType<typeof useNotes>;

/** Owns the notebook: hydrates from localStorage, persists just behind you. */
export function useNotes() {
  const [notes, setNotes] = useState<Note[]>(readNotes);

  // Unlike a task's three-line note, a notebook only grows — serialising the
  // whole thing on every keystroke is a stutter you can feel by the end of a
  // month. Only the write is deferred; the textarea stays fully controlled, so
  // typing never lags behind the caret.
  const timer = useRef<number | null>(null);
  const latest = useRef(notes);
  latest.current = notes;

  // Touches nothing but refs, so the mount-only effect below can hold on to the
  // first one it was given.
  const flush = () => {
    if (timer.current === null) return;
    clearTimeout(timer.current);
    timer.current = null;
    localStorage.setItem(NOTES_KEY, JSON.stringify(latest.current));
  };

  useEffect(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      localStorage.setItem(NOTES_KEY, JSON.stringify(latest.current));
    }, SAVE_DELAY);
  }, [notes]);

  useEffect(() => {
    // Closing the window only hides it, so this is the usual way out of the app.
    const onHidden = () => {
      if (document.hidden) flush();
    };
    document.addEventListener("visibilitychange", onHidden);
    // And leaving for the timer unmounts the screen.
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const made = (over: Partial<Note>): Note => ({
    id: crypto.randomUUID(),
    day: null,
    title: "",
    body: "",
    pinned: false,
    createdAt: Date.now(),
    ...over,
  });

  return {
    notes,

    /**
     * A day page exists exactly when there is something written on it: the
     * first keystroke makes it, clearing the last character takes it away — so
     * selecting all and deleting *is* how you throw one out.
     *
     * Testing the raw string rather than a trim is deliberate. Trimming would
     * eat the first space you ever type, because the row would never be made
     * and the controlled value would snap straight back to empty.
     */
    writeDay(day: number, body: string) {
      setNotes((current) => {
        const existing = current.find((n) => n.day === day);
        if (body === "") {
          return existing === undefined
            ? current
            : current.filter((n) => n.id !== existing.id);
        }
        if (existing === undefined) return [...current, made({ day, body })];
        return current.map((n) =>
          n.id === existing.id ? { ...n, body } : n,
        );
      });
    },

    write: (id: string, body: string) =>
      setNotes((current) =>
        current.map((n) => (n.id === id ? { ...n, body } : n)),
      ),

    /** A new kept note. The id comes back so the caller can select and name it. */
    keep(): string {
      const note = made({});
      setNotes((current) => [...current, note]);
      return note.id;
    },

    rename: (id: string, title: string) =>
      setNotes((current) =>
        current.map((n) => (n.id === id ? { ...n, title } : n)),
      ),

    pin: (id: string, pinned: boolean) =>
      setNotes((current) =>
        current.map((n) => (n.id === id ? { ...n, pinned } : n)),
      ),

    remove: (id: string) =>
      setNotes((current) => current.filter((n) => n.id !== id)),
  };
}
