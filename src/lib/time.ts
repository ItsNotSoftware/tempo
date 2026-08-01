const HOUR = 3_600_000;
const MINUTE = 60_000;
const SECOND = 1000;

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
