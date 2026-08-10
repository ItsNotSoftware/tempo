import { invoke } from "@tauri-apps/api/core";

/**
 * The notebook's storage, behind one interface so the screenshot harness — a
 * plain browser with no shell to call — exercises the same tree logic the app
 * does. Only the leaf reads and writes differ.
 */

export interface FileNote {
  /** Path relative to the notes root, always "/"-separated. */
  rel: string;
  body: string;
  /** Stands in for createdAt on a file Tempo has never seen before. */
  modified: number;
}

/** Tempo's own metadata, keyed by path — what the filesystem can't hold. */
export interface Index {
  notes: Record<string, { pinned?: boolean; createdAt?: number }>;
  folders: Record<string, { collapsed?: boolean }>;
}

export interface Snapshot {
  root: string;
  notes: FileNote[];
  dirs: string[];
  index: Index;
}

export interface Vault {
  load(): Promise<Snapshot>;
  writeNote(rel: string, body: string): Promise<void>;
  deleteNote(rel: string): Promise<void>;
  movePath(from: string, to: string): Promise<void>;
  makeDir(rel: string): Promise<void>;
  deleteDir(rel: string): Promise<void>;
  writeIndex(index: Index): Promise<void>;
  /** Returns the root actually in use, which may not be what was asked for. */
  setRoot(path: string, moveExisting: boolean): Promise<string>;
  canPickRoot: boolean;
}

/** Day pages sit here so a date can't collide with a folder you made. */
export const DAYS_DIR = "Days";

export const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const EMPTY_INDEX: Index = { notes: {}, folders: {} };

function parseIndex(text: string | null | undefined): Index {
  try {
    if (text === null || text === undefined) return EMPTY_INDEX;
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) return EMPTY_INDEX;
    const { notes, folders } = parsed as Partial<Index>;
    return { notes: notes ?? {}, folders: folders ?? {} };
  } catch {
    return EMPTY_INDEX;
  }
}

const tauriVault: Vault = {
  async load() {
    const raw = await invoke<{
      root: string;
      notes: FileNote[];
      dirs: string[];
      index: string | null;
    }>("load_vault");
    return { ...raw, index: parseIndex(raw.index) };
  },
  writeNote: (rel, body) => invoke("write_note", { rel, body }),
  deleteNote: (rel) => invoke("delete_note", { rel }),
  movePath: (from, to) => invoke("move_path", { from, to }),
  makeDir: (rel) => invoke("make_dir", { rel }),
  deleteDir: (rel) => invoke("delete_dir", { rel }),
  writeIndex: (index) => invoke("write_index", { json: JSON.stringify(index) }),
  setRoot: (path, moveExisting) =>
    invoke<string>("set_notes_root", { path, moveExisting }),
  canPickRoot: true,
};

// --- The browser stand-in ---

const FILES_KEY = "tempo.vault.v1";
const DIRS_KEY = "tempo.vault.dirs.v1";
const INDEX_KEY = "tempo.vault.index.v1";
/** The pre-filesystem notebook, still what the screenshot harness seeds. */
const LEGACY_NOTES = "tempo.notes.v1";
const LEGACY_FOLDERS = "tempo.folders.v1";

interface LegacyNote {
  day: number | null;
  title: string;
  body: string;
  pinned: boolean;
  folder: string | null;
  createdAt: number;
}

/** `Days/2026-08-10.md` — sortable, and readable in a file listing. */
export function dayFile(day: number): string {
  const d = new Date(day);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${DAYS_DIR}/${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.md`;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

/** One-time conversion of a seeded or pre-filesystem notebook into files. */
function fromLegacy(): { files: Record<string, string>; dirs: string[]; index: Index } {
  const notes = readJson<LegacyNote[]>(LEGACY_NOTES, []);
  const folders = readJson<{ path: string; collapsed: boolean }[]>(LEGACY_FOLDERS, []);
  const files: Record<string, string> = {};
  const index: Index = { notes: {}, folders: {} };

  for (const n of notes) {
    const rel =
      n.day === null || n.day === undefined
        ? `${n.folder ? `${n.folder}/` : ""}${n.title.trim() === "" ? "Untitled note" : n.title}.md`
        : dayFile(n.day);
    files[rel] = n.body;
    index.notes[rel] = { pinned: n.pinned === true, createdAt: n.createdAt };
  }
  for (const f of folders) index.folders[f.path] = { collapsed: f.collapsed };

  return { files, dirs: folders.map((f) => f.path), index };
}

const browserVault: Vault = {
  async load() {
    const stored = localStorage.getItem(FILES_KEY);
    if (stored === null) {
      const seeded = fromLegacy();
      localStorage.setItem(FILES_KEY, JSON.stringify(seeded.files));
      localStorage.setItem(DIRS_KEY, JSON.stringify(seeded.dirs));
      localStorage.setItem(INDEX_KEY, JSON.stringify(seeded.index));
    }
    const files = readJson<Record<string, string>>(FILES_KEY, {});
    return {
      root: "(browser)",
      notes: Object.entries(files).map(([rel, body]) => ({ rel, body, modified: 0 })),
      dirs: readJson<string[]>(DIRS_KEY, []),
      index: parseIndex(localStorage.getItem(INDEX_KEY)),
    };
  },
  async writeNote(rel, body) {
    const files = readJson<Record<string, string>>(FILES_KEY, {});
    files[rel] = body;
    localStorage.setItem(FILES_KEY, JSON.stringify(files));
  },
  async deleteNote(rel) {
    const files = readJson<Record<string, string>>(FILES_KEY, {});
    delete files[rel];
    localStorage.setItem(FILES_KEY, JSON.stringify(files));
  },
  async movePath(from, to) {
    const files = readJson<Record<string, string>>(FILES_KEY, {});
    for (const rel of Object.keys(files)) {
      if (rel === from || rel.startsWith(`${from}/`)) {
        files[to + rel.slice(from.length)] = files[rel];
        delete files[rel];
      }
    }
    localStorage.setItem(FILES_KEY, JSON.stringify(files));
    const dirs = readJson<string[]>(DIRS_KEY, []).map((d) =>
      d === from || d.startsWith(`${from}/`) ? to + d.slice(from.length) : d,
    );
    localStorage.setItem(DIRS_KEY, JSON.stringify(dirs));
  },
  async makeDir(rel) {
    const dirs = new Set(readJson<string[]>(DIRS_KEY, []));
    dirs.add(rel);
    localStorage.setItem(DIRS_KEY, JSON.stringify([...dirs]));
  },
  async deleteDir(rel) {
    const files = readJson<Record<string, string>>(FILES_KEY, {});
    for (const key of Object.keys(files)) {
      if (key === rel || key.startsWith(`${rel}/`)) delete files[key];
    }
    localStorage.setItem(FILES_KEY, JSON.stringify(files));
    const dirs = readJson<string[]>(DIRS_KEY, []).filter(
      (d) => d !== rel && !d.startsWith(`${rel}/`),
    );
    localStorage.setItem(DIRS_KEY, JSON.stringify(dirs));
  },
  async writeIndex(index) {
    localStorage.setItem(INDEX_KEY, JSON.stringify(index));
  },
  async setRoot(path) {
    return path;
  },
  canPickRoot: false,
};

export const vault: Vault = inTauri ? tauriVault : browserVault;
