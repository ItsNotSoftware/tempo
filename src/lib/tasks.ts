import { useEffect, useState } from "react";
import { parseEstimate } from "./time";

export interface Segment {
  start: number;
  /** `null` while the segment is still running. */
  end: number | null;
}

export interface Task {
  id: string;
  /** Story key like `TEMPO-42`, uppercased; `null` when the name carried none. */
  story: string | null;
  name: string;
  notes: string;
  estimateMs: number | null;
  /** Every run of this task, oldest first. The last one is open while it runs. */
  segments: Segment[];
  createdAt: number;
  completedAt: number | null;
}

export type TaskStatus = "idle" | "running" | "done";

/** A leading `TEMPO-42 ` claims the rest of the line as its task. */
export const STORY_KEY = /^([a-z][a-z0-9]*-\d+)\s+/i;

/** A trailing `~45m` / `~1h30m` sets the estimate. */
const ESTIMATE_SUFFIX = /\s+~\s*([\dhm\s]*)$/i;

export interface Entry {
  story: string | null;
  name: string;
  estimateMs: number | null;
}

/** Split a typed line into the story, the task and the estimate. */
export function parseEntry(text: string): Entry {
  let name = text.trim();

  let estimateMs: number | null = null;
  const estimate = ESTIMATE_SUFFIX.exec(name);
  if (estimate !== null) {
    estimateMs = parseEstimate(estimate[1]);
    // Only claim the suffix if it parsed — a bare `~` stays part of the name.
    if (estimateMs !== null) name = name.slice(0, estimate.index).trim();
  }

  let story: string | null = null;
  const key = STORY_KEY.exec(name);
  if (key !== null) {
    story = key[1].toUpperCase();
    name = name.slice(key[0].length).trim();
  }

  return { story, name, estimateMs };
}

/** Every story in use, the one you touched most recently first. */
export function knownStories(tasks: Task[]): string[] {
  const latest = new Map<string, number>();
  for (const task of tasks) {
    if (task.story === null) continue;
    latest.set(task.story, Math.max(latest.get(task.story) ?? 0, task.createdAt));
  }
  return [...latest]
    .sort((a, b) => b[1] - a[1])
    .map(([story]) => story);
}

/** Stable 1–6 bucket, so a story keeps the same colour run to run. */
export function storyTone(story: string): number {
  let hash = 0;
  for (let i = 0; i < story.length; i++) {
    hash = (hash * 31 + story.charCodeAt(i)) | 0;
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
  return task.segments.some(
    (s) => s.start < to && (s.end ?? Infinity) >= from,
  );
}

/** Lined up but never started — the queue, which carries across days. */
export function isQueued(task: Task): boolean {
  return task.segments.length === 0 && task.completedAt === null;
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

const STORAGE_KEY = "tempo.tasks.v2";
const LEGACY_KEY = "tempo.tasks.v1";

interface LegacyTask {
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
function migrate(legacy: LegacyTask[], at: number): Task[] {
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

    const { story, name, estimateMs } = parseEntry(old.name ?? "");
    return {
      id: old.id ?? crypto.randomUUID(),
      story,
      name,
      notes: old.notes ?? "",
      estimateMs,
      segments,
      createdAt: segments[0]?.start ?? completedAt ?? at,
      completedAt,
    };
  });
}

function load(): Task[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as Task[]) : [];
    }

    // First run on v2 — bring v1 across, leaving it in place for a rollback.
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy === null) return [];
    const parsed: unknown = JSON.parse(legacy);
    return Array.isArray(parsed)
      ? migrate(parsed as LegacyTask[], Date.now())
      : [];
  } catch {
    return [];
  }
}

export type TasksApi = ReturnType<typeof useTasks>;

/** Owns the task list: hydrates from localStorage, persists on every change. */
export function useTasks() {
  const [tasks, setTasks] = useState<Task[]>(load);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  }, [tasks]);

  const update = (id: string, change: (task: Task) => Task) =>
    setTasks((current) => current.map((t) => (t.id === id ? change(t) : t)));

  return {
    tasks,

    /**
     * Idle, in the order typed — you often line a few up before starting any.
     * `story` is whatever the composer's picker has selected; a key typed into
     * the text itself is more explicit, so it wins.
     */
    add(text: string, story: string | null = null) {
      const entry = parseEntry(text);
      const { name, estimateMs } = entry;
      setTasks((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          story: entry.story ?? story,
          name,
          notes: "",
          estimateMs,
          segments: [],
          createdAt: Date.now(),
          completedAt: null,
        },
      ]);
    },

    /**
     * Typing `TEMPO-51 ` in front of a name moves the task to that story. Typing
     * no key leaves the story alone — only the group header can clear one.
     */
    rename: (id: string, text: string) =>
      update(id, (t) => {
        const key = STORY_KEY.exec(text);
        if (key === null) return { ...t, name: text };
        return {
          ...t,
          story: key[1].toUpperCase(),
          name: text.slice(key[0].length),
        };
      }),

    /** Rewrites every member at once; `null` drops them back to no story. */
    renameStory: (from: string, to: string | null) =>
      setTasks((current) =>
        current.map((t) => (t.story === from ? { ...t, story: to } : t)),
      ),

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

    remove: (id: string) =>
      setTasks((current) => current.filter((t) => t.id !== id)),
  };
}
