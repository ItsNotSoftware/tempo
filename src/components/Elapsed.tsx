import { useState } from "react";
import { formatDuration, parseDuration, splitClock } from "../lib/time";
import "./Elapsed.css";

interface ElapsedProps {
  ms: number;
  /** What the figure means, spelled out on hover. */
  title: string;
  /** The hero clock on the now panel rather than a row's. */
  large?: boolean;
  /** A past day is a record — there the clock is just a number. */
  readOnly?: boolean;
  onCommit: (ms: number) => void;
}

/**
 * A tracked figure, and the way to correct it. Click and type what the clock
 * should say — the runs behind it follow. Both places a running task's time is
 * shown use this, so correcting it in the row and correcting it in the hero
 * are the same gesture rather than two half-answers.
 */
export function Elapsed({
  ms,
  title,
  large = false,
  readOnly = false,
  onCommit,
}: ElapsedProps) {
  const [editing, setEditing] = useState(false);
  const kind = large ? "elapsed--lg" : "elapsed--sm";

  function commit(value: string) {
    const typed = parseDuration(value);
    // Garbage leaves the measurement alone rather than guessing at it.
    if (typed !== null) onCommit(typed);
    setEditing(false);
  }

  if (editing) {
    return (
      <input
        className={`elapsed__field ${kind}`}
        defaultValue={formatDuration(ms)}
        placeholder="1:00"
        aria-label="Adjust tracked time"
        spellCheck={false}
        autoFocus
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => commit(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") setEditing(false);
        }}
      />
    );
  }

  if (readOnly) {
    return (
      <time className={`elapsed ${kind}`} title={title}>
        {large ? <Split ms={ms} /> : formatDuration(ms)}
      </time>
    );
  }

  return (
    <button
      className={`elapsed elapsed--open ${kind}`}
      title={`${title} — click to adjust`}
      aria-label="Adjust tracked time"
      onClick={() => setEditing(true)}
    >
      {large ? <Split ms={ms} /> : formatDuration(ms)}
    </button>
  );
}

/** The hero clock dims its ticking seconds; a row's is small enough not to. */
function Split({ ms }: { ms: number }) {
  const [clock, seconds] = splitClock(ms);
  return (
    <>
      {clock}
      <span className="elapsed__seconds">{seconds}</span>
    </>
  );
}
