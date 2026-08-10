import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  BookOpen,
  ChevronRight,
  FilePlus,
  Folder,
  FolderOpen,
  FolderPlus,
  PanelLeft,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Trash2,
} from "lucide-react";
import { Markdown } from "../components/Markdown";
import {
  dayPage,
  dayPages,
  descends,
  folderContents,
  folderName,
  folderTree,
  keptNotes,
  rootNotes,
  type FolderNode,
  type Note,
  type NotesApi,
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
  notes: NotesApi;
  now: number;
  /** The day in view, shared with the timer. */
  day: number;
  onDay: (dayStart: number) => void;
  /** Which kept note is open; `null` is the day's own page. */
  kept: string | null;
  onKept: (id: string | null) => void;
  onOpenTimer: () => void;
}

/** The root shelf as a drop target — a path no folder can have. */
const ROOT = "";
const MIN_PAGES = 160;
const MAX_PAGES = 420;

const MODES = [
  { id: "read", label: "Markdown", Icon: BookOpen },
  { id: "raw", label: "Text", Icon: Pencil },
] as const;

export function Notes({
  api,
  notes,
  now,
  day,
  onDay,
  kept,
  onKept,
  onOpenTimer,
}: NotesProps) {
  /** One at a time: `note:<id>` or `folder:<path>`. */
  const [armed, setArmed] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [drag, setDrag] = useState<Drag | null>(null);
  /** The title being typed. Committing renames the file, so it waits for blur. */
  const [titling, setTitling] = useState<string | null>(null);
  /** Live width while the divider is pulled; written to view on release. */
  const [pulling, setPulling] = useState<number | null>(null);
  const name = useRef<HTMLInputElement>(null);

  // Reset the delete confirmation if you move on without answering.
  useEffect(() => {
    if (armed === null) return;
    const timer = setTimeout(() => setArmed(null), 4000);
    return () => clearTimeout(timer);
  }, [armed]);

  const view = notes.view;
  const setView = notes.setView;
  const pages = pulling ?? view.pages;

  // Screen-local: the shell's shortcuts are navigation, these aren't.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (key === "e") {
        e.preventDefault();
        setView({ mode: view.mode === "read" ? "raw" : "read" });
      } else if (key === "\\") {
        e.preventDefault();
        setView({ hidden: !view.hidden });
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const today = startOfDay(now);
  // A note deleted out from under the selection drops back to the day page.
  const open = keptNotes(notes.notes).find((n) => n.id === kept) ?? null;

  /** A path is an identity, so anything that moves takes the selection with it. */
  function moved(from: string, to: string) {
    if (kept !== null && descends(kept, from)) onKept(to + kept.slice(from.length));
  }

  function commitTitle() {
    if (titling === null || open === null) return;
    const next = notes.rename(open.id, titling);
    setTitling(null);
    if (next !== open.id) onKept(next);
  }

  const tree = folderTree(notes.notes, notes.folders);
  const loose = rootNotes(notes.notes);

  /**
   * Today, wherever the cursor is pointed, and every day already written on.
   * Days with tracked time but no page stay out of it — this is a list of
   * pages, and a list of days would only be a second day nav.
   */
  const days = [
    ...new Set([today, day, ...dayPages(notes.notes).map((n) => n.day ?? 0)]),
  ].sort((a, b) => b - a);

  function newKept(folder: string | null = null) {
    if (folder !== null) notes.setCollapsed(folder, false);
    onKept(notes.keep(folder));
    // The name field only mounts once the new note is the one on screen.
    requestAnimationFrame(() => name.current?.focus());
  }

  function newFolder(parent: string | null) {
    const path = notes.makeFolder(parent);
    setRenaming(path);
    setDraft(folderName(path));
  }

  function drop(note: Note) {
    if (armed !== `note:${note.id}`) return setArmed(`note:${note.id}`);
    setArmed(null);
    if (note.id === kept) onKept(null);
    notes.remove(note.id);
  }

  function dropFolder(node: FolderNode) {
    if (armed !== `folder:${node.path}`) return setArmed(`folder:${node.path}`);
    setArmed(null);
    const inside = folderContents(notes.notes, notes.folders, node.path);
    if (inside.notes.some((n) => n.id === kept)) onKept(null);
    notes.removeFolder(node.path);
  }

  function commitRename(path: string) {
    setRenaming(null);
    moved(path, notes.renameFolder(path, draft));
  }

  // --- Filing by drag ---
  //
  // Pointer events, not HTML5 drag-and-drop: the webview needs
  // `dragDropEnabled: false` for that, and the screenshot harness can only
  // drive a real mouse.

  /** The drop target under the cursor, or null if it can't take this row. */
  function targetAt(x: number, y: number, kind: Held, key: string) {
    const el = document.elementFromPoint(x, y)?.closest("[data-drop]");
    if (el === null || el === undefined) return null;
    const path = el.getAttribute("data-drop") ?? ROOT;
    if (kind === "folder" && path !== ROOT && descends(path, key)) return null;
    return path;
  }

  function lift(e: React.PointerEvent, kind: Held, key: string, label: string) {
    if (e.button !== 0) return;
    const from = { x: e.clientX, y: e.clientY };
    let live = false;

    const move = (m: PointerEvent) => {
      // Slack, or every click on a row would start a drag.
      if (!live && Math.hypot(m.clientX - from.x, m.clientY - from.y) < 5) return;
      live = true;
      setDrag({
        kind,
        key,
        label,
        x: m.clientX,
        y: m.clientY,
        over: targetAt(m.clientX, m.clientY, kind, key),
      });
    };

    const up = (u: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDrag(null);
      if (!live) return;
      const onto = targetAt(u.clientX, u.clientY, kind, key);
      // Releasing over a row would otherwise also fire its click.
      window.addEventListener("click", swallow, { capture: true, once: true });
      if (onto === null) return;
      const to = onto === ROOT ? null : onto;
      moved(key, kind === "note" ? notes.file(key, to) : notes.moveFolder(key, to));
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function pull(e: React.PointerEvent) {
    if (e.button !== 0) return;
    const move = (m: PointerEvent) =>
      setPulling(Math.min(MAX_PAGES, Math.max(MIN_PAGES, m.clientX / ZOOM)));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      // One write on release rather than one per pixel travelled.
      setPulling((width) => {
        if (width !== null) setView({ pages: Math.round(width) });
        return null;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  // --- Rows ---

  function noteRow(note: Note, depth: number) {
    const isArmed = armed === `note:${note.id}`;
    const label = note.title.trim() === "" ? "Untitled note" : note.title;
    return (
      <div
        key={note.id}
        data-row={label}
        className={`pages__row pages__row--note${
          note.id === kept ? " is-on" : ""
        }${drag?.key === note.id ? " is-lifted" : ""}`}
        style={{ "--depth": depth } as CSSProperties}
        onPointerDown={(e) => lift(e, "note", note.id, label)}
      >
        <button className="pages__open" onClick={() => onKept(note.id)}>
          <span className="pages__lead">
            {note.id === kept ? (
              <i className="pages__dot" />
            ) : note.pinned ? (
              <Pin size={11} />
            ) : null}
          </span>
          <span className="pages__label">{label}</span>
        </button>

        <span className="pages__actions">
          {/* Armed, the confirmation needs the whole row — there isn't
              190px of room for a question and a pin both. */}
          {!isArmed && (
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
              isArmed ? " is-armed" : ""
            }`}
            title={isArmed ? "Click again to delete" : "Delete"}
            aria-label={isArmed ? "Confirm delete" : "Delete note"}
            onClick={() => drop(note)}
          >
            <Trash2 size={isArmed ? 12 : 13} />
            {isArmed && "Delete?"}
          </button>
        </span>
      </div>
    );
  }

  function folderRows(node: FolderNode): React.ReactNode[] {
    const isArmed = armed === `folder:${node.path}`;
    const inside = isArmed
      ? folderContents(notes.notes, notes.folders, node.path).notes.length
      : 0;

    const row = (
      <div
        key={`f:${node.path}`}
        data-drop={node.path}
        data-row={node.name}
        className={`pages__row pages__row--folder${
          drag?.over === node.path ? " is-drop" : ""
        }${drag?.key === node.path ? " is-lifted" : ""}`}
        style={{ "--depth": node.depth } as CSSProperties}
        onPointerDown={(e) => lift(e, "folder", node.path, node.name)}
      >
        {renaming === node.path ? (
          <input
            className="pages__rename"
            aria-label="Folder name"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => commitRename(node.path)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename(node.path);
              if (e.key === "Escape") setRenaming(null);
            }}
          />
        ) : (
          <button
            className="pages__open"
            title="Double-click to rename"
            onClick={() => notes.setCollapsed(node.path, !node.collapsed)}
            onDoubleClick={() => {
              setRenaming(node.path);
              setDraft(node.name);
            }}
          >
            <span className="pages__lead">
              <ChevronRight
                className={`chevron${node.collapsed ? "" : " is-open"}`}
                size={12}
                strokeWidth={2.5}
              />
            </span>
            {node.collapsed ? <Folder size={13} /> : <FolderOpen size={13} />}
            <span className="pages__label">{node.name}</span>
          </button>
        )}

        <span className="pages__actions">
          {!isArmed && (
            <>
              <button
                className="icon-btn icon-btn--sm"
                title="New note here"
                aria-label={`New note in ${node.name}`}
                onClick={() => newKept(node.path)}
              >
                <FilePlus size={13} />
              </button>
              <button
                className="icon-btn icon-btn--sm"
                title="New folder inside"
                aria-label={`New folder in ${node.name}`}
                onClick={() => newFolder(node.path)}
              >
                <FolderPlus size={13} />
              </button>
            </>
          )}
          <button
            className={`icon-btn icon-btn--sm icon-btn--danger${
              isArmed ? " is-armed" : ""
            }`}
            title={isArmed ? "Click again to delete" : "Delete"}
            aria-label={isArmed ? "Confirm delete" : "Delete folder"}
            onClick={() => dropFolder(node)}
          >
            <Trash2 size={isArmed ? 12 : 13} />
            {isArmed &&
              (inside === 0
                ? "Delete?"
                : `Delete ${inside} note${inside === 1 ? "" : "s"}?`)}
          </button>
        </span>
      </div>
    );

    if (node.collapsed) return [row];
    return [
      row,
      ...node.children.flatMap(folderRows),
      ...node.notes.map((n) => noteRow(n, node.depth + 1)),
    ];
  }

  // --- The page ---

  const body = open === null ? (dayPage(notes.notes, day)?.body ?? "") : open.body;
  const write = (value: string) =>
    open === null ? notes.writeDay(day, value) : notes.write(open.id, value);
  /** Nothing written has nothing to read — a blank read view is a dead end. */
  const reading = view.mode === "read" && body.trim() !== "";

  if (!notes.loaded) return <div className="notes notes--waiting" />;

  return (
    <div
      className={`notes${view.hidden ? " is-alone" : ""}`}
      style={{ "--pages": `${pages}px` } as CSSProperties}
    >
      {/* Anything in the list that isn't a folder drops to the root. */}
      {!view.hidden && (
        <aside
          className={`pages${drag?.over === ROOT ? " is-drop" : ""}`}
          data-drop={ROOT}
        >
          {days.map((d) => (
            <div
              key={d}
              className={`pages__row${
                open === null && d === day ? " is-on" : ""
              }`}
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

          {/* These two stay visible: they're the only way to a first note. */}
          <div className="pages__rule">
            kept
            <span className="pages__make">
              <button
                className="icon-btn icon-btn--sm"
                title="New folder"
                aria-label="New folder"
                onClick={() => newFolder(null)}
              >
                <FolderPlus size={15} />
              </button>
              <button
                className="icon-btn icon-btn--sm"
                title="New kept note"
                aria-label="New kept note"
                onClick={() => newKept()}
              >
                <Plus size={15} />
              </button>
            </span>
          </div>

          {tree.length === 0 && loose.length === 0 && (
            <p className="pages__empty">Nothing yet.</p>
          )}

          {tree.flatMap(folderRows)}
          {loose.map((n) => noteRow(n, 0))}
        </aside>
      )}

      {!view.hidden && (
        <div
          className="notes__grip"
          role="separator"
          aria-label="Resize the page list"
          onPointerDown={pull}
        />
      )}

      <section className="page">
        <div className="page__head">
          <button
            className={`icon-btn${view.hidden ? "" : " is-on"}`}
            title={view.hidden ? "Show pages  ⌘\\" : "Hide pages  ⌘\\"}
            aria-label={view.hidden ? "Show pages" : "Hide pages"}
            onClick={() => setView({ hidden: !view.hidden })}
          >
            <PanelLeft size={17} />
          </button>

          {open === null ? (
            <h1 className="page__title">{formatDate(day)}</h1>
          ) : (
            <input
              ref={name}
              className="page__name"
              aria-label="Note name"
              placeholder="Untitled note"
              value={titling ?? open.title}
              onChange={(e) => setTitling(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") setTitling(null);
              }}
            />
          )}

          <div className="page__view" role="radiogroup" aria-label="View mode">
            {MODES.map(({ id, label, Icon }) => (
              <button
                key={id}
                role="radio"
                aria-checked={view.mode === id}
                className={`page__mode${view.mode === id ? " is-on" : ""}`}
                onClick={() => setView({ mode: id })}
              >
                <Icon size={13} />
                <span>{label}</span>
              </button>
            ))}
            <kbd className="page__key">⌘E</kbd>
          </div>
        </div>

        {open === null && (
          <Tracked
            api={api}
            now={now}
            day={day}
            label={formatDay(day, now)}
            onOpen={onOpenTimer}
          />
        )}

        {reading ? (
          <div className="page__pane page__read">
            <Markdown body={body} />
          </div>
        ) : (
          <textarea
            className="page__pane page__body"
            aria-label="Note"
            placeholder={
              open === null
                ? `Notes for ${formatDate(day)}…`
                : "Whatever you keep coming back to…"
            }
            value={body}
            onChange={(e) => write(e.target.value)}
          />
        )}
      </section>

      {drag !== null && (
        <span
          className="pages__ghost"
          style={{ left: drag.x / ZOOM, top: drag.y / ZOOM } as CSSProperties}
        >
          {drag.label}
        </span>
      )}
    </div>
  );
}

type Held = "note" | "folder";

interface Drag {
  kind: Held;
  key: string;
  label: string;
  x: number;
  y: number;
  /** Folder under the cursor, `""` for the root, `null` for nowhere. */
  over: string | null;
}

/** Matches the `zoom` on `.app`: a client x is that many px too many. */
const ZOOM = 1.15;

const swallow = (e: MouseEvent) => {
  e.stopPropagation();
  e.preventDefault();
};

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
          className="dot dot--sm"
          style={{ background: `var(--group-${groupTone(group)})` }}
        />
      ))}
      <span className="page__count">{taskCount(tasks.length)}</span>
    </button>
  );
}
