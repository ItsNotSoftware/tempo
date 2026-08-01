import { Check, Pause } from "lucide-react";
import { elapsedMs, type Task, type TasksApi } from "../lib/tasks";
import { formatTimeOfDay, splitClock } from "../lib/time";

interface NowPanelProps {
  task: Task;
  now: number;
  api: TasksApi;
}

/** The running task, front and centre: what it is and how long it's been. */
export function NowPanel({ task, now, api }: NowPanelProps) {
  const [clock, seconds] = splitClock(elapsedMs(task, now));

  return (
    <section className="now" aria-label="Currently tracking">
      <div className="now__meta">
        <span className="now__badge">
          <i className="pulse" />
          Tracking
        </span>
        {task.startedAt !== null && (
          <span className="now__since">
            since {formatTimeOfDay(task.startedAt)}
          </span>
        )}
      </div>

      <h2 className="now__name" title={task.name}>
        {task.name.trim() || "Untitled"}
      </h2>

      <div className="now__foot">
        <time className="now__clock">
          {clock}
          <span className="now__seconds">{seconds}</span>
        </time>

        <div className="now__actions">
          <button className="btn btn--ghost" onClick={() => api.stop(task.id)}>
            <Pause size={14} strokeWidth={2.25} fill="currentColor" />
            Pause
          </button>
          <button
            className="btn btn--success"
            onClick={() => api.finish(task.id)}
          >
            <Check size={15} strokeWidth={2.5} />
            Finish
          </button>
        </div>
      </div>
    </section>
  );
}
