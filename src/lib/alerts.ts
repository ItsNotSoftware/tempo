import { useEffect, useRef } from "react";
import { isTauri } from "@tauri-apps/api/core";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import {
  estimates,
  taskStatus,
  type Estimate,
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

    // The same rule the tray paints on, so the menu bar and the notification
    // can never disagree about what "over" means.
    for (const estimate of estimates(current, tasks, groups, now)) {
      check(fired.current, estimate);
    }
  }, [tasks, groups, now]);
}

/**
 * Fire once on the way over, and re-arm on the way back under — so raising an
 * estimate past what's been spent means the new one can alert in its turn.
 */
function check(fired: Set<string>, estimate: Estimate) {
  const { key, spentMs, estimateMs } = estimate;

  if (!estimate.over) {
    if (fired.delete(key)) writeFired(fired);
    return;
  }
  if (fired.has(key)) return;

  fired.add(key);
  writeFired(fired);
  void notify(
    estimate.scope === "task" ? "Over estimate" : "Group over estimate",
    // `over` doesn't narrow the estimate for TypeScript, but it can't be null
    // here — nothing without an estimate is ever over one.
    `${estimate.subject} — ${formatDurationShort(spentMs)} of ~${formatDurationShort(estimateMs ?? 0)}`,
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
