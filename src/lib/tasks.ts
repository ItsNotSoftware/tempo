import { useEffect, useState } from "react";

export interface Task {
  id: string;
  name: string;
  notes: string;
  /** Milliseconds banked from run segments that have already ended. */
  accumulatedMs: number;
  /** Epoch ms the current run segment began; `null` when not running. */
  startedAt: number | null;
  /** Epoch ms the task was marked done; `null` while still open. */
  completedAt: number | null;
}

export type TaskStatus = "idle" | "running" | "done";

export function taskStatus(task: Task): TaskStatus {
  if (task.completedAt !== null) return "done";
  return task.startedAt !== null ? "running" : "idle";
}

/** Total tracked time, including the in-flight segment when running. */
export function elapsedMs(task: Task, now: number): number {
  if (task.startedAt === null) return task.accumulatedMs;
  return task.accumulatedMs + Math.max(0, now - task.startedAt);
}

/** Bank the running segment, if any, and clear the start marker. */
function stopped(task: Task, at: number): Task {
  if (task.startedAt === null) return task;
  return {
    ...task,
    accumulatedMs: task.accumulatedMs + Math.max(0, at - task.startedAt),
    startedAt: null,
  };
}

const STORAGE_KEY = "tempo.tasks.v1";

function load(): Task[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Task[]) : [];
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

    /** Newest first, and already running — you type a task to start it. */
    add(name: string) {
      setTasks((current) => {
        const at = Date.now();
        return [
          {
            id: crypto.randomUUID(),
            name,
            notes: "",
            accumulatedMs: 0,
            startedAt: at,
            completedAt: null,
          },
          ...current.map((t) => stopped(t, at)),
        ];
      });
    },

    rename: (id: string, name: string) => update(id, (t) => ({ ...t, name })),

    setNotes: (id: string, notes: string) =>
      update(id, (t) => ({ ...t, notes })),

    /** Exclusive: whatever else was running banks its time and stops. */
    start: (id: string) =>
      setTasks((current) => {
        const at = Date.now();
        return current.map((t) =>
          t.id === id
            ? { ...t, startedAt: t.startedAt ?? at, completedAt: null }
            : stopped(t, at),
        );
      }),

    stop: (id: string) => update(id, (t) => stopped(t, Date.now())),

    finish: (id: string) =>
      update(id, (t) => {
        const at = Date.now();
        return { ...stopped(t, at), completedAt: at };
      }),

    reopen: (id: string) => update(id, (t) => ({ ...t, completedAt: null })),

    remove: (id: string) =>
      setTasks((current) => current.filter((t) => t.id !== id)),
  };
}
