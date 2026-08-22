import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { inTauri } from "./vault";
import { parseEstimate } from "./time";

export interface Segment {
  start: number;
  /** `null` while the segment is still running. */
  end: number | null;
}

export interface Task {
  id: string;
  /** The group this belongs to; `null` when it stands on its own. */
  group: string | null;
  name: string;
  notes: string;
  estimateMs: number | null;
  /** Every run of this task, oldest first. The last one is open while it runs. */
  segments: Segment[];
  createdAt: number;
  completedAt: number | null;
}

/** What a group carries beyond its tasks. Keyed by name — groups have no id. */
export interface Group {
  estimateMs: number | null;
  notes: string;
}

export type Groups = Record<string, Group>;

export const EMPTY_GROUP: Group = { estimateMs: null, notes: "" };

export type TaskStatus = "idle" | "running" | "done";

/**
 * A leading `TEMPO-42 ` claims the rest of the line as its task. Deliberately
 * only the ticket shape — a looser rule would split every two-word task in half.
 * Any other name (`Workouts`, `Admin`) is made with the picker instead.
 */
export const GROUP_KEY = /^([a-z][a-z0-9]*-\d+)\s+/i;

/** A trailing `~45m` / `~1h30m` sets the estimate. */
const ESTIMATE_SUFFIX = /\s+~\s*([\dhm\s]*)$/i;

/** Ticket-shaped names go uppercase so `tempo-42` and `TEMPO-42` are one group.
 *  Anything else keeps the case you typed — `Workouts` shouldn't shout. */
export function normalizeGroup(name: string): string {
  const trimmed = name.trim();
  return /^[a-z][a-z0-9]*-\d+$/i.test(trimmed) ? trimmed.toUpperCase() : trimmed;
}

export interface Entry {
  group: string | null;
  name: string;
  estimateMs: number | null;
}

/** Split a typed line into the group, the task and the estimate. */
export function parseEntry(text: string): Entry {
  let name = text.trim();

  let estimateMs: number | null = null;
  const estimate = ESTIMATE_SUFFIX.exec(name);
  if (estimate !== null) {
    estimateMs = parseEstimate(estimate[1]);
    // Only claim the suffix if it parsed — a bare `~` stays part of the name.
    if (estimateMs !== null) name = name.slice(0, estimate.index).trim();
  }

  let group: string | null = null;
  const key = GROUP_KEY.exec(name);
  if (key !== null) {
    group = key[1].toUpperCase();
    name = name.slice(key[0].length).trim();
  }

  return { group, name, estimateMs };
}

/** `1 task` / `3 tasks` — said in a few places, always the same way. */
export function taskCount(n: number): string {
  return `${n} task${n === 1 ? "" : "s"}`;
}

/**
 * The groups among these tasks, the one you touched most recently first. Fed
 * the day in view, so the picker is only ever as long as the day itself — last
 * week's groups aren't choices, they're history.
 */
export function knownGroups(tasks: Task[]): string[] {
  const latest = new Map<string, number>();
  for (const task of tasks) {
    if (task.group === null) continue;
    latest.set(task.group, Math.max(latest.get(task.group) ?? 0, task.createdAt));
  }
  return [...latest].sort((a, b) => b[1] - a[1]).map(([group]) => group);
}

/** Stable 1–6 bucket, so a group keeps the same colour run to run. */
export function groupTone(group: string): number {
  let hash = 0;
  for (let i = 0; i < group.length; i++) {
    hash = (hash * 31 + group.charCodeAt(i)) | 0;
  }
  return (Math.abs(hash) % 6) + 1;
}

function openSegment(task: Task): Segment | null {
  const last = task.segments[task.segments.length - 1];
  return last !== undefined && last.end === null ? last : null;
}

/** When the current run began; `null` when the task isn't running. */
export function startedAt(task: Task): number | null {
  return openSegment(task)?.start ?? null;
}

export function taskStatus(task: Task): TaskStatus {
  if (task.completedAt !== null) return "done";
  return openSegment(task) !== null ? "running" : "idle";
}

/**
 * How much of the task's tracked time falls inside `[from, to)`. Clamping each
 * segment on its own is what lets a run across midnight count on both days.
 */
export function elapsedBetween(
  task: Task,
  from: number,
  to: number,
  now: number,
): number {
  return task.segments.reduce((sum, segment) => {
    const end = segment.end ?? now;
    return sum + Math.max(0, Math.min(end, to) - Math.max(segment.start, from));
  }, 0);
}

/** Total tracked time, including the in-flight segment when running. */
export function elapsedMs(task: Task, now: number): number {
  return elapsedBetween(task, 0, Infinity, now);
}

/** Did any of this task happen on the day `[from, to)` — or finish there? */
export function touchesDay(task: Task, from: number, to: number): boolean {
  if (
    task.completedAt !== null &&
    task.completedAt >= from &&
    task.completedAt < to
  ) {
    return true;
  }
  return task.segments.some((s) => s.start < to && (s.end ?? Infinity) >= from);
}

/** Lined up but never started — the queue, which carries across days. */
export function isQueued(task: Task): boolean {
  return task.segments.length === 0 && task.completedAt === null;
}

/** `TEMPO-42 · fix the parser` — what a task is called away from its own row. */
export function taskLabel(task: Task): string {
  const name = task.name.trim() === "" ? "Untitled" : task.name.trim();
  return task.group === null ? name : `${task.group} · ${name}`;
}

/** A clock measured against an estimate. Without one, nothing is ever over. */
export interface Estimate {
  scope: "task" | "group";
  /** Stable per subject, so an alert can remember having fired for it. */
  key: string;
  /** The subject, named the way a person would say it. */
  subject: string;
  estimateMs: number | null;
  spentMs: number;
  over: boolean;
}

/**
 * What the running task is measured against right now: its own estimate, and
 * its group's when the group carries one of its own. A group without one says
 * nothing — its expected time is just the sum of its tasks', and those answer
 * for themselves.
 *
 * Estimates read against the total, not the day, same as the row's bar. The
 * notification fires on this and the tray paints on it, so there is one rule
 * rather than two that can drift apart.
 */
/**
 * What a group has had spent on it: every task carrying its name, all-time.
 *
 * All-time and not the day in view, because a group's expected time is for the
 * whole of it — measuring today's slice against a whole-group budget reads
 * under from the second day on. The header bar and the alert both come through
 * here so they can't disagree, same as `estimates()` is one rule for "over".
 */
export function groupSpent(tasks: Task[], group: string, now: number): number {
  return tasks
    .filter((t) => t.group === group)
    .reduce((sum, t) => sum + elapsedMs(t, now), 0);
}

export function estimates(
  running: Task,
  tasks: Task[],
  groups: Groups,
  now: number,
): Estimate[] {
  const measured: Estimate[] = [
    measure(
      "task",
      `task:${running.id}`,
      taskLabel(running),
      running.estimateMs,
      elapsedMs(running, now),
    ),
  ];

  if (running.group !== null) {
    const group = running.group;
    measured.push(
      measure(
        "group",
        `group:${group}`,
        group,
        groupMeta(groups, group).estimateMs,
        groupSpent(tasks, group, now),
      ),
    );
  }

  return measured;
}

function measure(
  scope: Estimate["scope"],
  key: string,
  subject: string,
  estimateMs: number | null,
  spentMs: number,
): Estimate {
  return {
    scope,
    key,
    subject,
    estimateMs,
    spentMs,
    over: estimateMs !== null && spentMs > estimateMs,
  };
}

/**
 * Put a rewritten list of runs back into the shape the rest of the file
 * assumes: nothing ends before it starts or after now — you can't bank time
 * that hasn't passed — finished runs in the order they happened, and the one
 * still going, if there is one, last.
 */
function normalizeSegments(segments: Segment[], now: number): Segment[] {
  const closedRuns: Segment[] = [];
  let open: Segment | null = null;

  for (const segment of segments) {
    const start = Math.min(segment.start, now);
    if (segment.end === null) {
      // Only one run can be in flight; a second would make two clocks.
      if (open === null) open = { start, end: null };
      else closedRuns.push({ start, end: Math.max(start, now) });
      continue;
    }
    closedRuns.push({ start, end: Math.min(Math.max(start, segment.end), now) });
  }

  closedRuns.sort((a, b) => a.start - b.start);
  return open === null ? closedRuns : [...closedRuns, open];
}

/**
 * Rework a task's runs so its `[from, to)` clock reads `target`.
 *
 * All time derives from the runs, so "take an hour off" has to land on one of
 * them. The day's newest run absorbs the change — that's the one you got wrong,
 * because it's the one you forgot to stop — and a shortfall carries back into
 * the run before it. Trimming the run still going moves its start rather than
 * its end, so it keeps counting from a corrected figure.
 */
function retimed(
  segments: Segment[],
  from: number,
  to: number,
  now: number,
  target: number,
): Segment[] {
  const slice = (s: Segment) =>
    Math.max(0, Math.min(s.end ?? now, to) - Math.max(s.start, from));

  let delta = target - segments.reduce((sum, s) => sum + slice(s), 0);
  if (delta === 0) return segments;

  const next = segments.map((s) => ({ ...s }));
  const onDay = next.filter((s) => s.start < to && (s.end ?? now) > from);
  /** Nothing on this day can reach past now, or past the day itself. */
  const cap = Math.min(now, to);

  if (delta < 0) {
    for (let i = onDay.length - 1; i >= 0 && delta < 0; i--) {
      const run = onDay[i];
      const take = Math.min(slice(run), -delta);
      if (take <= 0) continue;
      if (run.end === null) run.start += take;
      else run.end -= take;
      delta += take;
    }
    // A finished run trimmed to nothing isn't a run any more. Only the ones
    // this touched — an empty run recorded on some other day is its business.
    const trimmed = new Set(onDay);
    return next.filter(
      (s) => s.end === null || s.end > s.start || !trimmed.has(s),
    );
  }

  const last = onDay[onDay.length - 1];
  // Never started, and you're telling it how long it took: that's one run.
  if (last === undefined) {
    return [...next, { start: Math.max(from, cap - delta), end: cap }];
  }

  if (last.end !== null) {
    // You stopped later than it recorded — grow the end first.
    const room = Math.max(0, cap - last.end);
    const add = Math.min(room, delta);
    last.end += add;
    delta -= add;
  }
  if (delta > 0) {
    // Then backwards, as far as the day and the run before it allow.
    const previous = onDay[onDay.length - 2];
    const floor = Math.max(from, previous?.end ?? from);
    last.start -= Math.min(Math.max(0, last.start - floor), delta);
  }

  return next;
}

/**
 * The whole of `setDayTotal`, as a function of its inputs: rework the runs so
 * the `[from, to)` clock reads `targetMs`, then put them back in shape.
 *
 * The seam the rule is tested through — `retimed` and `normalizeSegments` are
 * only ever reached from here.
 */
export function retimedDay(
  segments: Segment[],
  from: number,
  to: number,
  now: number,
  targetMs: number,
): Segment[] {
  return normalizeSegments(
    retimed(segments, from, to, now, Math.max(0, targetMs)),
    now,
  );
}

/**
 * Put a window that already happened onto the books: append `[from, to)` as a
 * closed run, close any run still open first — logging a meeting is what
 * marks the task done, so nothing can be left counting behind it — and put
 * the result back in shape through the same seam `retimedDay` uses.
 *
 * The mirror of `retimedDay`: that rule corrects a run already on the books,
 * this adds one that never made it on. `record` is the only caller.
 */
export function recorded(
  segments: Segment[],
  from: number,
  to: number,
  now: number,
): Segment[] {
  const stopped = segments.map((s) =>
    s.end === null ? { start: s.start, end: Math.max(s.start, now) } : s,
  );
  return normalizeSegments([...stopped, { start: from, end: to }], now);
}

/** Close the open segment, if there is one. */
function closed(task: Task, at: number): Task {
  const last = task.segments[task.segments.length - 1];
  if (last === undefined || last.end !== null) return task;
  return {
    ...task,
    segments: [
      ...task.segments.slice(0, -1),
      { start: last.start, end: Math.max(last.start, at) },
    ],
  };
}

const TASKS_KEY = "tempo.tasks.v3";
const GROUPS_KEY = "tempo.groups.v1";
const V2_KEY = "tempo.tasks.v2";
const V1_KEY = "tempo.tasks.v1";

interface V2Task extends Omit<Task, "group"> {
  story?: string | null;
}

interface V1Task {
  id?: string;
  name?: string;
  notes?: string;
  accumulatedMs?: number;
  startedAt?: number | null;
  completedAt?: number | null;
}

/**
 * v1 kept one `accumulatedMs` counter and no history at all. Back-dating a
 * single segment by that counter makes `elapsedMs` come out to exactly the old
 * figure — and for a task that was running, keeps its clock running across the
 * upgrade. The day that time lands on is a guess; it was never recorded.
 */
function fromV1(legacy: V1Task[], at: number): Task[] {
  return legacy.map((old) => {
    const banked = Math.max(0, old.accumulatedMs ?? 0);
    const completedAt = old.completedAt ?? null;

    let segments: Segment[] = [];
    if (old.startedAt !== null && old.startedAt !== undefined) {
      segments = [{ start: old.startedAt - banked, end: null }];
    } else if (banked > 0) {
      const end = completedAt ?? at;
      segments = [{ start: end - banked, end }];
    }

    const { group, name, estimateMs } = parseEntry(old.name ?? "");
    return {
      id: old.id ?? crypto.randomUUID(),
      group,
      name,
      notes: old.notes ?? "",
      estimateMs,
      segments,
      createdAt: segments[0]?.start ?? completedAt ?? at,
      completedAt,
    };
  });
}

/** v2 called it `story`; nothing else about a task changed. */
function fromV2(old: V2Task[]): Task[] {
  return old.map(({ story, ...task }) => ({ ...task, group: story ?? null }));
}

function readTasks(): Task[] {
  try {
    const raw = localStorage.getItem(TASKS_KEY);
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as Task[]) : [];
    }

    // Each older key is read once and left in place, so a rollback still works.
    const v2 = localStorage.getItem(V2_KEY);
    if (v2 !== null) {
      const parsed: unknown = JSON.parse(v2);
      return Array.isArray(parsed) ? fromV2(parsed as V2Task[]) : [];
    }

    const v1 = localStorage.getItem(V1_KEY);
    if (v1 === null) return [];
    const parsed: unknown = JSON.parse(v1);
    return Array.isArray(parsed) ? fromV1(parsed as V1Task[], Date.now()) : [];
  } catch {
    return [];
  }
}

function readGroups(): Groups {
  try {
    const raw = localStorage.getItem(GROUPS_KEY);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Groups)
      : {};
  } catch {
    return {};
  }
}

/** What a group carries, with the blanks filled in. */
export function groupMeta(groups: Groups, name: string): Group {
  return groups[name] ?? EMPTY_GROUP;
}

/** The disk copy. A no-op in a plain browser, which has no shell to ask. */
async function mirror(tasks: Task[], groups: Groups) {
  if (!inTauri) return;
  try {
    await invoke("save_state", { json: JSON.stringify({ tasks, groups }) });
  } catch {
    // localStorage still has it; a failed mirror isn't worth interrupting for.
  }
}

async function loadMirror(): Promise<{ tasks: Task[]; groups: Groups } | null> {
  if (!inTauri) return null;
  try {
    const raw = await invoke<string | null>("load_state");
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as { tasks?: Task[]; groups?: Groups };
    if (!Array.isArray(parsed.tasks)) return null;
    return { tasks: parsed.tasks, groups: parsed.groups ?? {} };
  } catch {
    return null;
  }
}

export type TasksApi = ReturnType<typeof useTasks>;

/**
 * Owns the task list. localStorage stays the read path so the tray and the
 * alerts have state on the first frame; a file alongside it is the copy that
 * survives the webview's storage being cleared.
 */
export function useTasks() {
  const [tasks, setTasks] = useState<Task[]>(readTasks);
  const [groups, setGroups] = useState<Groups>(readGroups);
  const restored = useRef(false);

  useEffect(() => {
    localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
    void mirror(tasks, groups);
    // Only tasks drive the mirror; groups ride along on the same write.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks]);

  useEffect(() => {
    localStorage.setItem(GROUPS_KEY, JSON.stringify(groups));
    void mirror(tasks, groups);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups]);

  // A fresh profile with a file behind it: take the file rather than start
  // empty. Anything already in localStorage wins, so this can't undo an edit.
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    if (localStorage.getItem(TASKS_KEY) !== null) return;
    void loadMirror().then((saved) => {
      if (saved === null) return;
      setTasks(saved.tasks);
      setGroups(saved.groups);
    });
  }, []);

  const update = (id: string, change: (task: Task) => Task) =>
    setTasks((current) => current.map((t) => (t.id === id ? change(t) : t)));

  const editGroup = (name: string, change: (group: Group) => Group) =>
    setGroups((current) => ({
      ...current,
      [name]: change(current[name] ?? EMPTY_GROUP),
    }));

  return {
    tasks,
    groups,

    /**
     * Idle, in the order typed — you often line a few up before starting any.
     * `group` is whatever the composer's picker has selected; a key typed into
     * the text itself is more explicit, so it wins.
     */
    add(text: string, group: string | null = null): string {
      const entry = parseEntry(text);
      const { name, estimateMs } = entry;
      // Made here rather than inside the updater so the caller can act on the
      // task it just asked for — booking a meeting starts the one it made.
      const id = crypto.randomUUID();
      setTasks((current) => [
        ...current,
        {
          id,
          group: entry.group ?? group,
          name,
          notes: "",
          estimateMs,
          segments: [],
          createdAt: Date.now(),
          completedAt: null,
        },
      ]);
      return id;
    },

    /**
     * Typing `TEMPO-51 ` in front of a name moves the task to that group. Typing
     * no key leaves the group alone — only the group header can clear one.
     */
    rename: (id: string, text: string) =>
      update(id, (t) => {
        const key = GROUP_KEY.exec(text);
        if (key === null) return { ...t, name: text };
        return {
          ...t,
          group: key[1].toUpperCase(),
          name: text.slice(key[0].length),
        };
      }),

    /** Files an existing task under a group by drag — sets the field
     *  directly, unlike `rename`, which only moves it on a typed key. */
    setGroup: (id: string, group: string | null) =>
      update(id, (t) => ({ ...t, group })),

    /** Rewrites every member at once; `null` drops them back to no group. */
    renameGroup: (from: string, to: string | null) => {
      setTasks((current) =>
        current.map((t) => (t.group === from ? { ...t, group: to } : t)),
      );
      // The estimate and notes belong to the name, so they move with it.
      setGroups((current) => {
        const { [from]: meta, ...rest } = current;
        if (meta === undefined) return current;
        if (to === null) return rest;
        return { ...rest, [to]: { ...(current[to] ?? EMPTY_GROUP), ...meta } };
      });
    },

    /**
     * Throws a group away with the tasks under it. `ids` is the block on screen,
     * never the whole name: an earlier day is a record and deleting from today
     * must not rewrite it. The metadata is keyed by the name, so it only goes
     * once no task carries it.
     */
    removeGroup: (name: string, ids: string[]) => {
      const gone = new Set(ids);
      setTasks((current) => current.filter((t) => !gone.has(t.id)));
      if (tasks.some((t) => t.group === name && !gone.has(t.id))) return;
      setGroups((current) => {
        const { [name]: dropped, ...rest } = current;
        return dropped === undefined ? current : rest;
      });
    },

    setGroupEstimate: (name: string, estimateMs: number | null) =>
      editGroup(name, (g) => ({ ...g, estimateMs })),

    setGroupNotes: (name: string, notes: string) =>
      editGroup(name, (g) => ({ ...g, notes })),

    setNotes: (id: string, notes: string) =>
      update(id, (t) => ({ ...t, notes })),

    setEstimate: (id: string, estimateMs: number | null) =>
      update(id, (t) => ({ ...t, estimateMs })),

    /** Exclusive: whatever else was running closes its segment and stops. */
    start: (id: string) =>
      setTasks((current) => {
        const at = Date.now();
        return current.map((t) => {
          if (t.id !== id) return closed(t, at);
          return {
            ...t,
            completedAt: null,
            // Already running? Leave the open segment be, don't restart it.
            segments:
              openSegment(t) !== null
                ? t.segments
                : [...t.segments, { start: at, end: null }],
          };
        });
      }),

    stop: (id: string) => update(id, (t) => closed(t, Date.now())),

    finish: (id: string) =>
      update(id, (t) => {
        const at = Date.now();
        return { ...closed(t, at), completedAt: at };
      }),

    reopen: (id: string) => update(id, (t) => ({ ...t, completedAt: null })),

    /**
     * Say what this task's clock should read for a day, and let the runs behind
     * it follow. The only place a recorded time is ever changed — a measurement
     * that came out wrong is worth correcting, and an hour you spent not
     * working is corrected by saying what the hour should have been.
     */
    setDayTotal: (id: string, from: number, to: number, targetMs: number) =>
      update(id, (t) => {
        const at = Date.now();
        return { ...t, segments: retimedDay(t.segments, from, to, at, targetMs) };
      }),

    /**
     * Log a run that already happened, the mirror of `start`: that puts the
     * clock on now, this puts a finished window on the books. `completedAt`
     * lands on `to`, the event's own end, not on whenever you got round to
     * logging it — `touchesDay` reads `completedAt`, and completing at
     * `Date.now()` would file yesterday's meeting onto today's task list
     * showing 0m, with its actual time sitting on yesterday.
     */
    record: (id: string, from: number, to: number) =>
      update(id, (t) => {
        const at = Date.now();
        return { ...t, segments: recorded(t.segments, from, to, at), completedAt: to };
      }),

    remove: (id: string) =>
      setTasks((current) => current.filter((t) => t.id !== id)),
  };
}
