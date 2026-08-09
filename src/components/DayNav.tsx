import { ChevronLeft, ChevronRight } from "lucide-react";
import { addDays, formatDay, startOfDay } from "../lib/time";
import "./DayNav.css";

interface DayNavProps {
  /** Midnight of the day in view. */
  day: number;
  now: number;
  onDay: (dayStart: number) => void;
  /**
   * Whether tomorrow is somewhere worth going. Only the schedule says yes: the
   * rest of the app measures time that has passed, and there is nothing to see
   * ahead of now.
   */
  forward?: boolean;
}

/** Step a day at a time, or jump back to today. */
export function DayNav({ day, now, onDay, forward = false }: DayNavProps) {
  const today = startOfDay(now);

  return (
    <div className="days">
      <button
        className="icon-btn"
        title="Previous day"
        aria-label="Previous day"
        onClick={() => onDay(addDays(day, -1))}
      >
        <ChevronLeft size={17} />
      </button>

      <button
        className="days__day"
        disabled={day === today}
        title={day === today ? undefined : "Back to today"}
        onClick={() => onDay(today)}
      >
        {formatDay(day, now)}
      </button>

      <button
        className="icon-btn"
        title="Next day"
        aria-label="Next day"
        disabled={!forward && day >= today}
        onClick={() => onDay(addDays(day, 1))}
      >
        <ChevronRight size={17} />
      </button>
    </div>
  );
}
