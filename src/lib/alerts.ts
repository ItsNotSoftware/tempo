import { useEffect, useRef } from "react";
import { isTauri } from "@tauri-apps/api/core";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import {
  elapsedMs,
  groupMeta,
  taskStatus,
  type Groups,
  type Task,
} from "./tasks";
import { formatDurationShort } from "./time";

/** Which alerts have already fired, so a restart doesn't repeat them. */
const ALERTS_KEY = "tempo.alerts.v1";

function readFired(): Set<string> {
  try {
    const raw = localStorage.getItem(ALERTS_KEY);
    if (raw === null) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? (parsed as string[]) : []);
  } catch {
    return new Set();
  }
}

function writeFired(fired: Set<string>) {
  localStorage.setItem(ALERTS_KEY, JSON.stringify([...fired]));
}

/**
 * Says something the one time it's worth interrupting for: the task you're on
 * has passed the estimate you set for it.
 *
 * Only the running task and its group are ever checked — an estimate can only
 * be crossed while the clock is moving — so this is two comparisons a tick.
 */
export function useEstimateAlerts(tasks: Task[], groups: Groups, now: number) {
  // Read once, then kept in memory — this runs every tick.
  const fired = useRef<Set<string> | null>(null);
  fired.current ??= readFired();

  useEffect(() => {
    if (!isTauri()) return;

    const current = tasks.find((t) => taskStatus(t) === "running") ?? null;
    if (current === null || fired.current === null) return;

    // Estimates read against the total, not the day, same as the row's bar.
    const spent = elapsedMs(current, now);
    check(
      fired.current,
      `task:${current.id}`,
      current.estimateMs,
      spent,
      "Over estimate",
      taskLabel(current),
    );

    // Only groups with an estimate of their own. Without one a group's expected
    // time is just the sum of its tasks' estimates, and those alert on their
    // own — a group alert there would only say it twice.
    if (current.group !== null) {
      const group = current.group;
      const estimate = groupMeta(groups, group).estimateMs;
      const groupSpent = tasks
        .filter((t) => t.group === group)
        .reduce((sum, t) => sum + elapsedMs(t, now), 0);
      check(
        fired.current,
        `group:${group}`,
        estimate,
        groupSpent,
        "Group over estimate",
        group,
      );
    }
  }, [tasks, groups, now]);
}

/**
 * Fire once on the way over, and re-arm on the way back under — so raising an
 * estimate past what's been spent means the new one can alert in its turn.
 */
function check(
  fired: Set<string>,
  key: string,
  estimateMs: number | null,
  spent: number,
  title: string,
  subject: string,
) {
  const over = estimateMs !== null && spent > estimateMs;

  if (!over) {
    if (fired.delete(key)) writeFired(fired);
    return;
  }
  if (fired.has(key)) return;

  fired.add(key);
  writeFired(fired);
  void notify(
    title,
    `${subject} — ${formatDurationShort(spent)} of ~${formatDurationShort(estimateMs)}`,
  );
}

/** Asked for at the first alert, so the prompt arrives with a reason attached. */
async function notify(title: string, body: string) {
  try {
    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === "granted";
    if (granted) sendNotification({ title, body });
  } catch {
    // No notifications available; nothing worth breaking the timer over.
  }
}

function taskLabel(task: Task): string {
  const name = task.name.trim() === "" ? "Untitled" : task.name.trim();
  return task.group === null ? name : `${task.group} · ${name}`;
}
