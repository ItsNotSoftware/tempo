const HOUR = 3_600_000;
const MINUTE = 60_000;
const SECOND = 1000;

/** Midnight at the top of `ts`'s day, in local time. */
export function startOfDay(ts: number): number {
  const day = new Date(ts);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

/**
 * Walk whole days from a midnight. Done through `Date` rather than ±86400000
 * so the clocks changing doesn't drift the boundary off midnight.
 */
export function addDays(dayStart: number, days: number): number {
  const day = new Date(dayStart);
  day.setDate(day.getDate() + days);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

/** `Today` / `Yesterday` / `Fri 1 Aug` for the day nav. */
export function formatDay(dayStart: number, now: number): string {
  const back = Math.round((startOfDay(now) - dayStart) / 86_400_000);
  if (back === 0) return "Today";
  if (back === 1) return "Yesterday";
  return new Date(dayStart).toLocaleDateString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/** `1h 30m`, `45m`, `2h`, `90` — round-trips whatever `formatDurationShort` writes. */
const ESTIMATE = /^\s*(?:(\d+)\s*h)?\s*(?:(\d+)\s*m?)?\s*$/i;

export function parseEstimate(text: string): number | null {
  const match = ESTIMATE.exec(text.replace(/^\s*~/, ""));
  if (match === null) return null;
  const [, hours, minutes] = match;
  if (hours === undefined && minutes === undefined) return null;
  const ms = Number(hours ?? 0) * HOUR + Number(minutes ?? 0) * MINUTE;
  return ms > 0 ? ms : null;
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

/** `HH:MM:SS`, always with at least two hour digits. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / SECOND));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

/** `HH:MM` and `:SS` apart, so a big clock can dim its ticking seconds. */
export function splitClock(ms: number): [string, string] {
  const clock = formatDuration(ms);
  const split = clock.lastIndexOf(":");
  return [clock.slice(0, split), clock.slice(split)];
}

/** `HH:MM` — for the menu bar, where a seconds digit is just twitch. */
export function formatClock(ms: number): string {
  return splitClock(ms)[0];
}

/** Wall-clock `14:02`, in whatever form the user's locale writes it. */
export function formatTimeOfDay(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Compact, human form for summaries: `2h 14m`, `14m`, `< 1m`, `0m`. */
export function formatDurationShort(ms: number): string {
  if (ms <= 0) return "0m";
  if (ms < MINUTE) return "< 1m";
  const hours = Math.floor(ms / HOUR);
  const minutes = Math.floor((ms % HOUR) / MINUTE);
  if (hours === 0) return `${minutes}m`;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}
