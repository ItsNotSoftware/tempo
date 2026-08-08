import { Check, Pause } from "lucide-react";
import {
  elapsedBetween,
  startedAt,
  groupTone,
  type Task,
  type TasksApi,
} from "../lib/tasks";
import { formatTimeOfDay, splitClock } from "../lib/time";
import "./NowPanel.css";

interface NowPanelProps {
  task: Task;
  now: number;
  /** Today, so the clock agrees with the row underneath it. */
  from: number;
  to: number;
  api: TasksApi;
}

/** The running task, front and centre: what it is and how long it's been. */
export function NowPanel({ task, now, from, to, api }: NowPanelProps) {
  const [clock, seconds] = splitClock(elapsedBetween(task, from, to, now));
  const since = startedAt(task);

  return (
    <section className="now" aria-label="Currently tracking">
      <div className="now__meta">
        <span className="now__badge">
          <i className="pulse" />
          Tracking
        </span>
        {since !== null && (
          <span className="now__since">since {formatTimeOfDay(since)}</span>
        )}
      </div>

      <h2 className="now__name" title={task.name}>
        {task.group !== null && (
          <span
            className="now__group"
            style={{ color: `var(--group-${groupTone(task.group)})` }}
          >
            {task.group}
          </span>
        )}
        {task.name.trim() || "Untitled"}
      </h2>

      <div className="now__foot">
        <time className="now__clock">
          {clock}
          <span className="now__seconds">{seconds}</span>
        </time>

        <div className="now__actions">
          <button className="btn btn--ghost" onClick={() => api.stop(task.id)}>
            <Pause size={15} strokeWidth={2.25} fill="currentColor" />
            Pause
          </button>
          <button
            className="btn btn--success"
            onClick={() => api.finish(task.id)}
          >
            <Check size={16} strokeWidth={2.5} />
            Finish
          </button>
        </div>
      </div>
    </section>
  );
}
