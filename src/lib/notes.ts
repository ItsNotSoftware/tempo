import { useCallback, useEffect, useRef, useState } from "react";
import { dayFile, vault, type Index, type Snapshot } from "./vault";

const VIEW_KEY = "tempo.notes.view.v1";

/**
 * A page is a file. Kept notes are `<folder>/<title>.md` anywhere in the tree,
 * day pages are `Days/YYYY/MM/YYYY-MM-DD.md`. The path is the identity, so
 * renaming a note moves it and hands back a new id.
 */
export interface Note {
  /** Path relative to the notes root. */
  id: string;
  /** Midnight of the day this page belongs to; `null` on a kept note. */
  day: number | null;
  /** A kept note's name — its filename. A day page is titled by its date. */
  title: string;
  body: string;
  pinned: boolean;
  /** Folder holding this note; `null` at the root. Kept notes only. */
  folder: string | null;
  createdAt: number;
}

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

// --- Paths ---

// The year/month folder is optional so an un-migrated file still reads as a
// day page — never a kept note called "2026-08-22" on the shelf.
const DAY_FILE = /^Days\/(?:\d{4}\/\d{2}\/)?(\d{4})-(\d{2})-(\d{2})\.md$/;
// Matched separately from DAY_FILE so migration can tell "needs moving" apart
// from "already nested" — DAY_FILE alone can't distinguish the two.
const LEGACY_DAY_FILE = /^Days\/(\d{4})-(\d{2})-(\d{2})\.md$/;

/** The day a path names, reading both the nested shape and the legacy flat one. */
export function dayOf(rel: string): number | null {
  const m = DAY_FILE.exec(rel);
  return m === null
    ? null
    : new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
}

/** The last segment of a path — what a folder is called, without its parents. */
export function folderName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** Is `path` the folder `of`, or somewhere inside it? */
export function descends(path: string, of: string): boolean {
  return path === of || path.startsWith(`${of}/`);
}

function parentOf(path: string): string | null {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? null : path.slice(0, cut);
}

const join = (folder: string | null, name: string) =>
  folder === null ? name : `${folder}/${name}`;

/** Strips what a filename can't carry, and never returns an empty name. */
function safeName(title: string): string {
  const clean = title.replace(/[/\\:*?"<>|]/g, "-").trim();
  return clean === "" ? "Untitled note" : clean;
}

/** `Deploy steps`, `Deploy steps 2`, … — never silently merging with a file. */
function freePath(taken: Set<string>, folder: string | null, name: string): string {
  let path = join(folder, `${name}.md`);
  for (let n = 2; taken.has(path); n++) path = join(folder, `${name} ${n}.md`);
  return path;
}

function toNote(
  file: { rel: string; body: string; modified: number },
  index: Index,
): Note {
  const meta = index.notes[file.rel] ?? {};
  const day = dayOf(file.rel);
  return {
    id: file.rel,
    day,
    title: day === null ? folderName(file.rel).replace(/\.md$/, "") : "",
    body: file.body,
    pinned: meta.pinned === true,
    folder: day === null ? parentOf(file.rel) : null,
    createdAt: meta.createdAt ?? file.modified,
  };
}

// --- Migration ---

/**
 * Legacy flat day pages (`Days/2026-08-22.md`), nested under their year and
 * month. Pure so the rule is testable on its own; the `vault.load()` effect
 * that calls it is the one-line caller — per CLAUDE.md's note on exporting a
 * kernel rather than hook internals.
 */
export function migrateDayPaths(
  snapshot: Snapshot,
): { snapshot: Snapshot; moves: { from: string; to: string }[] } {
  const taken = new Set(snapshot.notes.map((n) => n.rel));
  const moves: { from: string; to: string }[] = [];

  for (const note of snapshot.notes) {
    const m = LEGACY_DAY_FILE.exec(note.rel);
    if (m === null) continue;
    const day = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
    const to = dayFile(day);
    // Something already sits at the nested path — leave the flat file where
    // it is rather than clobber whatever's there.
    if (taken.has(to)) continue;
    moves.push({ from: note.rel, to });
  }

  if (moves.length === 0) return { snapshot, moves };

  const renamed = new Map(moves.map((m) => [m.from, m.to]));
  const notesIndex = { ...snapshot.index.notes };
  for (const { from, to } of moves) {
    if (from in notesIndex) {
      notesIndex[to] = notesIndex[from];
      delete notesIndex[from];
    }
  }

  return {
    snapshot: {
      ...snapshot,
      notes: snapshot.notes.map((n) =>
        renamed.has(n.rel) ? { ...n, rel: renamed.get(n.rel) ?? n.rel } : n,
      ),
      index: { notes: notesIndex, folders: snapshot.index.folders },
    },
    moves,
  };
}

// --- Selectors ---

/** The page for a day, or `null` — an untouched day has no file at all. */
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
 * being able to find things on.
 */
export function keptNotes(notes: Note[]): Note[] {
  return notes
    .filter((n) => n.day === null)
    .sort(
      (a, b) => Number(b.pinned) - Number(a.pinned) || a.createdAt - b.createdAt,
    );
}

export interface FolderNode {
  path: string;
  name: string;
  /** How far in, so the row can indent without a class per level. */
  depth: number;
  collapsed: boolean;
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
  return {
    folders: folders.filter((f) => descends(f.path, path)),
    notes: notes.filter((n) => n.folder !== null && descends(n.folder, path)),
  };
}

/**
 * Read the vault, nesting any legacy flat day pages on the way in.
 *
 * The single path onto a snapshot, and it has to stay that way: pointing the
 * notebook at another directory loads it too, and a load that skipped the
 * migration would leave a day readable at its flat path while `writeDay`
 * saved to the nested one — two files for one day, and the next launch
 * wouldn't heal it, because the migration skips a move whose target is taken.
 *
 * The moves are awaited rather than fired alongside. The notebook is already
 * showing nothing until this resolves, and a UI live while renames are in
 * flight is one that can write a `.tempo.json` entry the index write below
 * would then stamp back over.
 *
 * `allSettled`, because the index has to be written whatever happens: one move
 * failing under `all` would take the rekeyed metadata for every page that
 * *did* move down with it. A page whose move failed stays flat, which `dayOf`
 * still reads, and loses only its index entry — where `createdAt` falls back
 * to the file's mtime, and a day page is never pinned anyway.
 */
async function loadMigrated(): Promise<Snapshot> {
  const { snapshot, moves } = migrateDayPaths(await vault.load());
  if (moves.length > 0) {
    await Promise.allSettled(moves.map(({ from, to }) => vault.movePath(from, to)));
    await vault.writeIndex(snapshot.index);
  }
  return snapshot;
}

/**
 * Long enough to swallow a burst of typing, short enough that quitting from the
 * tray menu in the same breath as a keystroke is the only way to lose one.
 */
const SAVE_DELAY = 400;

const EMPTY: Snapshot = {
  root: "",
  notes: [],
  dirs: [],
  index: { notes: {}, folders: {} },
};

export type NotesApi = ReturnType<typeof useNotes>;

/** Owns the notebook: loads the vault once, writes back just behind you. */
export function useNotes() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [view, setViewState] = useState<View>(readView);

  // Only bodies are deferred. Everything else is a filesystem operation the
  // user asked for, and goes through at once.
  const dirty = useRef(new Set<string>());
  const timer = useRef<number | null>(null);
  const latest = useRef(snapshot);
  latest.current = snapshot;

  const flush = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    for (const rel of dirty.current) {
      const file = latest.current?.notes.find((n) => n.rel === rel);
      if (file !== undefined) void vault.writeNote(rel, file.body);
    }
    dirty.current.clear();
  }, []);

  useEffect(() => {
    void loadMigrated().then(setSnapshot);
  }, []);

  useEffect(() => {
    // Closing the window only hides it, so this is the usual way out.
    const onHidden = () => {
      if (document.hidden) flush();
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      flush();
    };
  }, [flush]);

  const setView = (patch: Partial<View>) => {
    const next = { ...view, ...patch };
    setViewState(next);
    localStorage.setItem(VIEW_KEY, JSON.stringify(next));
  };

  const state = snapshot ?? EMPTY;
  const notes = state.notes.map((f) => toNote(f, state.index));
  const folders: Folder[] = state.dirs.map((path) => ({
    path,
    collapsed: state.index.folders[path]?.collapsed === true,
  }));
  const taken = new Set(state.notes.map((n) => n.rel));

  const patch = (next: (current: Snapshot) => Snapshot) =>
    setSnapshot((current) => (current === null ? current : next(current)));

  const writeIndex = (next: Index) => {
    patch((current) => ({ ...current, index: next }));
    void vault.writeIndex(next);
  };

  const setBody = (rel: string, body: string) => {
    patch((current) => ({
      ...current,
      notes: current.notes.some((n) => n.rel === rel)
        ? current.notes.map((n) => (n.rel === rel ? { ...n, body } : n))
        : [...current.notes, { rel, body, modified: Date.now() }],
    }));
    dirty.current.add(rel);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, SAVE_DELAY);
  };

  const removeFile = (rel: string) => {
    dirty.current.delete(rel);
    patch((current) => ({
      ...current,
      notes: current.notes.filter((n) => n.rel !== rel),
    }));
    void vault.deleteNote(rel);
  };

  /** Move a file or a directory, taking everything under it. */
  const movePath = (from: string, to: string) => {
    if (from === to) return;
    // The pending body belongs to the old path; it has to land before the move.
    flush();
    const moved = (p: string) => to + p.slice(from.length);
    const rekey = <T,>(map: Record<string, T>) =>
      Object.fromEntries(
        Object.entries(map).map(([k, v]) => [descends(k, from) ? moved(k) : k, v]),
      );

    let after: Snapshot | null = null;
    patch((current) => {
      after = {
        ...current,
        notes: current.notes.map((n) =>
          descends(n.rel, from) ? { ...n, rel: moved(n.rel) } : n,
        ),
        dirs: current.dirs.map((d) => (descends(d, from) ? moved(d) : d)),
        index: {
          notes: rekey(current.index.notes),
          folders: rekey(current.index.folders),
        },
      };
      return after;
    });
    void vault.movePath(from, to).then(() => {
      if (after !== null) void vault.writeIndex(after.index);
    });
  };

  return {
    notes,
    folders,
    view,
    setView,
    /** False until the vault has been read; the screen waits on it. */
    loaded: snapshot !== null,
    /** The directory the notebook is in, for the settings screen. */
    root: state.root,

    /**
     * A day page exists exactly when there is something written on it: the
     * first keystroke makes the file, clearing the last character deletes it.
     * Testing the raw string rather than a trim is deliberate — trimming would
     * eat the first space you type, because the file would never be made.
     */
    writeDay(day: number, body: string) {
      const rel = dayFile(day);
      if (body === "") {
        if (taken.has(rel)) removeFile(rel);
        return;
      }
      if (!taken.has(rel)) {
        writeIndex({
          ...state.index,
          notes: { ...state.index.notes, [rel]: { createdAt: Date.now() } },
        });
      }
      setBody(rel, body);
    },

    write: (id: string, body: string) => setBody(id, body),

    /** A new kept note. The id comes back so the caller can select and name it. */
    keep(folder: string | null = null): string {
      const rel = freePath(taken, folder, "Untitled note");
      writeIndex({
        ...state.index,
        notes: { ...state.index.notes, [rel]: { createdAt: Date.now() } },
      });
      setBody(rel, "");
      return rel;
    },

    /** Renames the file, so the new path comes back as the new id. */
    rename(id: string, title: string): string {
      const note = notes.find((n) => n.id === id);
      if (note === undefined || note.day !== null) return id;
      const name = safeName(title);
      if (name === note.title) return id;
      const to = freePath(taken, note.folder, name);
      movePath(id, to);
      return to;
    },

    pin(id: string, pinned: boolean) {
      writeIndex({
        ...state.index,
        notes: { ...state.index.notes, [id]: { ...state.index.notes[id], pinned } },
      });
    },

    /** `null` puts the note back on the root shelf. */
    file(id: string, folder: string | null): string {
      const note = notes.find((n) => n.id === id);
      if (note === undefined || note.folder === folder) return id;
      const to = freePath(taken, folder, safeName(note.title));
      movePath(id, to);
      return to;
    },

    remove: (id: string) => removeFile(id),

    /**
     * A new folder inside `parent`, or at the root. A name clash takes a number
     * rather than merging with the directory already there. Returns the path so
     * the caller can open it for rename.
     */
    makeFolder(parent: string | null, name = "New folder"): string {
      const dirs = new Set(state.dirs);
      let path = join(parent, name);
      for (let n = 2; dirs.has(path); n++) path = join(parent, `${name} ${n}`);

      patch((current) => ({ ...current, dirs: [...current.dirs, path] }));
      void vault.makeDir(path);
      // Made inside a shut folder it would land out of sight.
      if (parent !== null) {
        writeIndex({
          ...state.index,
          folders: { ...state.index.folders, [parent]: { collapsed: false } },
        });
      }
      return path;
    },

    /** Both return the new path: anything selected inside it has moved too. */
    renameFolder(from: string, name: string): string {
      const clean = safeName(name);
      if (clean === folderName(from)) return from;
      const to = free(state.dirs, parentOf(from), clean);
      movePath(from, to);
      return to;
    },

    moveFolder(from: string, parent: string | null): string {
      if (parent !== null && descends(parent, from)) return from;
      if (parentOf(from) === parent) return from;
      const to = free(state.dirs, parent, folderName(from));
      movePath(from, to);
      return to;
    },

    setCollapsed: (path: string, collapsed: boolean) =>
      writeIndex({
        ...state.index,
        folders: {
          ...state.index.folders,
          [path]: { ...state.index.folders[path], collapsed },
        },
      }),

    /** Takes its subfolders and notes with it, like a group's delete. */
    removeFolder(path: string) {
      patch((current) => ({
        ...current,
        notes: current.notes.filter((n) => !descends(n.rel, path)),
        dirs: current.dirs.filter((d) => !descends(d, path)),
      }));
      void vault.deleteDir(path);
    },

    /** Point the notebook at a different directory. */
    async setRoot(path: string, moveExisting: boolean) {
      flush();
      await vault.setRoot(path, moveExisting);
      // Through `loadMigrated`, not `vault.load`: the directory you point at
      // may be an older notebook, and its flat day pages have to be nested on
      // the way in like any other.
      setSnapshot(await loadMigrated());
    },
  };
}

/** A directory path not already in use. */
function free(dirs: string[], parent: string | null, name: string): string {
  const used = new Set(dirs);
  let path = join(parent, name);
  for (let n = 2; used.has(path); n++) path = join(parent, `${name} ${n}`);
  return path;
}
