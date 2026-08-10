import { useEffect, useRef, useState } from "react";

const NOTES_KEY = "tempo.notes.v1";
const FOLDERS_KEY = "tempo.folders.v1";
const VIEW_KEY = "tempo.notes.view.v1";

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
  /**
   * Path of the folder holding this note ("Work/On-call"); `null` at the root.
   * Kept notes only — a day page is filed by its date and nothing else.
   */
  folder: string | null;
  createdAt: number;
}

/**
 * No id, the way groups have none: a path on each note plus the list of paths
 * that exist. A list rather than something derived from the notes, so a folder
 * survives being emptied.
 */
export interface Folder {
  /** Full path, "/"-separated. The last segment is the name on screen. */
  path: string;
  collapsed: boolean;
}

/** How the notebook is being looked at, as opposed to what's in it. */
export interface View {
  mode: "read" | "raw";
  /** Width of the page list, in px. */
  pages: number;
  hidden: boolean;
}

const DEFAULT_VIEW: View = { mode: "read", pages: 240, hidden: false };

function readNotes(): Note[] {
  try {
    const raw = localStorage.getItem(NOTES_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Notes written before folders existed have no `folder`.
    return (parsed as Note[]).map((n) => ({ ...n, folder: n.folder ?? null }));
  } catch {
    return [];
  }
}

function readFolders(): Folder[] {
  try {
    const raw = localStorage.getItem(FOLDERS_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Folder[]) : [];
  } catch {
    return [];
  }
}

function readView(): View {
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    if (raw === null) return DEFAULT_VIEW;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_VIEW;
    return { ...DEFAULT_VIEW, ...(parsed as Partial<View>) };
  } catch {
    return DEFAULT_VIEW;
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

/** The last segment of a path — what a folder is called, without its parents. */
export function folderName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** Is `path` the folder `of`, or somewhere inside it? */
export function descends(path: string, of: string): boolean {
  return path === of || path.startsWith(`${of}/`);
}

/** The parent path of a folder, or `null` for one sitting at the root. */
function parentOf(path: string): string | null {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? null : path.slice(0, cut);
}

export interface FolderNode {
  path: string;
  name: string;
  /** How far in, so the row can indent without a class per level. */
  depth: number;
  collapsed: boolean;
  /** The notes filed directly here, in the shelf's order. */
  notes: Note[];
  children: FolderNode[];
}

/** Kept notes at the root of the shelf, in the shelf's order. */
export function rootNotes(notes: Note[]): Note[] {
  return keptNotes(notes).filter((n) => n.folder === null);
}

/**
 * The shelf as a tree. Folders come before loose notes at every level and stay
 * in creation order; notes inside one keep `keptNotes`' order, so pinning is
 * pinning within a folder.
 */
export function folderTree(notes: Note[], folders: Folder[]): FolderNode[] {
  const shelf = keptNotes(notes);
  const build = (parent: string | null, depth: number): FolderNode[] =>
    folders
      .filter((f) => parentOf(f.path) === parent)
      .map((f) => ({
        path: f.path,
        name: folderName(f.path),
        depth,
        collapsed: f.collapsed,
        notes: shelf.filter((n) => n.folder === f.path),
        children: build(f.path, depth + 1),
      }));
  return build(null, 0);
}

/** Everything a folder would take with it: itself, its subfolders, its notes. */
export function folderContents(
  notes: Note[],
  folders: Folder[],
  path: string,
): { folders: Folder[]; notes: Note[] } {
  const inside = folders.filter((f) => descends(f.path, path));
  return {
    folders: inside,
    notes: notes.filter((n) => n.folder !== null && descends(n.folder, path)),
  };
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
  // Both change rarely enough to write straight through; only typing needs
  // the debounce below.
  const [folders, setFolders] = useState<Folder[]>(readFolders);
  const [view, setViewState] = useState<View>(readView);

  const writeFolders = (next: Folder[]) => {
    setFolders(next);
    localStorage.setItem(FOLDERS_KEY, JSON.stringify(next));
  };

  const setView = (patch: Partial<View>) => {
    const next = { ...view, ...patch };
    setViewState(next);
    localStorage.setItem(VIEW_KEY, JSON.stringify(next));
  };

  /**
   * Move a branch to a new path. Renaming and dragging are the same operation:
   * the prefix changes and every subfolder and note inside comes with it.
   */
  const repath = (from: string, to: string) => {
    if (to === from || folders.some((f) => f.path === to)) return;
    const rewrite = (path: string) => to + path.slice(from.length);
    writeFolders(
      folders.map((f) =>
        descends(f.path, from) ? { ...f, path: rewrite(f.path) } : f,
      ),
    );
    setNotes((current) =>
      current.map((n) =>
        n.folder !== null && descends(n.folder, from)
          ? { ...n, folder: rewrite(n.folder) }
          : n,
      ),
    );
  };

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
    folder: null,
    createdAt: Date.now(),
    ...over,
  });

  return {
    notes,
    folders,
    view,
    setView,

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
    keep(folder: string | null = null): string {
      const note = made({ folder });
      setNotes((current) => [...current, note]);
      return note.id;
    },

    /** `null` puts the note back on the root shelf. */
    file: (id: string, folder: string | null) =>
      setNotes((current) =>
        current.map((n) => (n.id === id ? { ...n, folder } : n)),
      ),

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

    /**
     * A new folder inside `parent`, or at the root. A name clash takes a number
     * rather than merging with the folder already there. Returns the path so
     * the caller can open it for rename.
     */
    makeFolder(parent: string | null, name = "New folder"): string {
      const base = parent === null ? name : `${parent}/${name}`;
      let path = base;
      for (let n = 2; folders.some((f) => f.path === path); n++) {
        path = `${base} ${n}`;
      }
      writeFolders([
        // Made inside a shut folder it would land out of sight.
        ...folders.map((f) =>
          f.path === parent ? { ...f, collapsed: false } : f,
        ),
        { path, collapsed: false },
      ]);
      return path;
    },

    renameFolder(from: string, name: string) {
      const trimmed = name.trim();
      if (trimmed === "" || trimmed.includes("/")) return;
      const parent = parentOf(from);
      repath(from, parent === null ? trimmed : `${parent}/${trimmed}`);
    },

    moveFolder(from: string, parent: string | null) {
      if (parent !== null && descends(parent, from)) return;
      const name = folderName(from);
      repath(from, parent === null ? name : `${parent}/${name}`);
    },

    setCollapsed: (path: string, collapsed: boolean) =>
      writeFolders(
        folders.map((f) => (f.path === path ? { ...f, collapsed } : f)),
      ),

    /** Takes its subfolders and notes with it, like a group's delete. */
    removeFolder(path: string) {
      writeFolders(folders.filter((f) => !descends(f.path, path)));
      setNotes((current) =>
        current.filter((n) => n.folder === null || !descends(n.folder, path)),
      );
    },
  };
}
